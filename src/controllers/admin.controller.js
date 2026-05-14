const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function dashboard(req, res) {
  try {
    const now = new Date();
    const mesAtual = new Date(now.getFullYear(), now.getMonth(), 1);
    const mesPassado = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const inicioSemana = new Date(now); inicioSemana.setDate(now.getDate() - now.getDay());

    const [
      totalTenants, totalUsers, totalInvoicesMes, totalInvoices,
      tenantsMes, tenantsMesPassado, invoicesSemana,
      tenantsPorStatus, planos, topTenants
    ] = await Promise.all([
      prisma.tenant.count({ where: { status: 'active' } }),
      prisma.user.count({ where: { role: { not: 'master' }, status: 'active' } }),
      prisma.invoice.count({ where: { createdAt: { gte: mesAtual }, status: { not: 'rascunho' } } }),
      prisma.invoice.count({ where: { status: { not: 'rascunho' } } }),
      prisma.tenant.count({ where: { createdAt: { gte: mesAtual } } }),
      prisma.tenant.count({ where: { createdAt: { gte: mesPassado, lt: mesAtual } } }),
      prisma.invoice.count({ where: { createdAt: { gte: inicioSemana }, status: { not: 'rascunho' } } }),
      prisma.tenant.groupBy({ by: ['status'], _count: true }),
      prisma.plan.findMany({ where: { ativo: true } }),
      prisma.tenant.findMany({
        where: { status: 'active' },
        include: { plan: true, _count: { select: { invoices: { where: { createdAt: { gte: mesAtual }, status: { not: 'rascunho' } } } } } },
        orderBy: { invoices: { _count: 'desc' } },
        take: 5,
      }),
    ]);

    // MRR
    const mrr = planos.reduce((acc, p) => {
      const count = tenantsPorStatus.find(t => t.status === 'active')?._count || 0;
      return acc + Number(p.precoMensal) * count;
    }, 0);

    // Churn: tenants que saíram no mês passado
    const churn = tenantsMesPassado > 0
      ? Math.round(((tenantsMesPassado - (tenantsMes - tenantsMesPassado)) / tenantsMesPassado) * 100)
      : 0;

    // Crescimento
    const crescimento = tenantsMesPassado > 0
      ? Math.round(((tenantsMes - tenantsMesPassado) / tenantsMesPassado) * 100)
      : 100;

    // Média notas por tenant ativo
    const mediaNotasPorTenant = totalTenants > 0 ? Math.round(totalInvoicesMes / totalTenants) : 0;

    // Upsell potencial e próximos do limite — verificar TODOS os tenants ativos
    const tenantsLimite = [];
    const upsellPotencial = [];
    const todosTenants = await prisma.tenant.findMany({
      where: { status: 'active', planId: { not: null } },
      include: { plan: true },
    });
    for (const t of todosTenants) {
      if (t.plan && t.plan.limiteNotas > 0) {
        const usado = await prisma.invoice.count({
          where: { tenantId: t.id, createdAt: { gte: mesAtual }, status: { not: 'rascunho' } },
        });
        if (usado >= Math.floor(t.plan.limiteNotas * 0.9)) {
          upsellPotencial.push({ id: t.id, razaoSocial: t.razaoSocial, usado, limite: t.plan.limiteNotas });
        } else if (usado >= Math.floor(t.plan.limiteNotas * 0.8)) {
          tenantsLimite.push({ id: t.id, razaoSocial: t.razaoSocial, usado, limite: t.plan.limiteNotas });
        }
      }
    }

    // Total arrecadado (considerando MRR * tenants ativos)
    const totalArrecadado = planos.reduce((acc, p) => {
      const count = tenantsPorStatus.find(t => t.status === 'active')?._count || 0;
      return acc + Number(p.precoMensal) * count;
    }, 0);

    res.json({
      totalTenants,
      totalUsers,
      totalInvoicesMes,
      totalInvoices,
      invoicesSemana,
      mrr,
      churn,
      crescimento,
      mediaNotasPorTenant,
      totalArrecadado,
      topTenants: topTenants.map(t => ({
        id: t.id,
        razaoSocial: t.razaoSocial,
        subdomain: t.subdomain,
        plano: t.plan?.nome || '-',
        notasMes: t._count.invoices,
        status: t.status,
      })),
      tenantsLimite,
      upsellPotencial,
      statusCount: tenantsPorStatus.reduce((acc, s) => ({ ...acc, [s.status]: s._count }), {}),
    });
  } catch (error) {
    console.error('[ADMIN] Dashboard error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function listarTenants(req, res) {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const where = status ? { status } : {};
    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        skip: (page - 1) * limit,
        take: Number(limit),
        include: { plan: true, _count: { select: { users: true, invoices: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.tenant.count({ where }),
    ]);
    res.json({ tenants, total, page: Number(page), totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('[ADMIN] List tenants error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function atualizarTenant(req, res) {
  try {
    const { id } = req.params;
    const { status, planId, planStatus } = req.body;
    const data = {};
    if (status) data.status = status;
    if (planId) data.planId = planId;
    if (planStatus) data.planStatus = planStatus;

    const updated = await prisma.tenant.update({ where: { id }, data, include: { plan: true } });

    // Cascade: se o status do tenant mudou, aplicar nos usuários
    if (status) {
      const userStatus = status === 'active' ? 'active' : 'inactive';
      await prisma.user.updateMany({ where: { tenantId: id, role: { not: 'master' } }, data: { status: userStatus } });
    }

    res.json(updated);
  } catch (error) {
    console.error('[ADMIN] Update tenant error:', error);
    if (error.code === 'P2025') return res.status(404).json({ erro: 'Tenant não encontrado' });
    res.status(500).json({ erro: error.message });
  }
}

async function listarUsuarios(req, res) {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const where = { role: { not: 'master' } };
    if (search) {
      where.OR = [
        { nome: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: Number(limit),
        include: { tenant: { select: { razaoSocial: true, subdomain: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);
    res.json({ users, total, page: Number(page), totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('[ADMIN] List users error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function getConfiguracoes(req, res) {
  try {
    const config = await prisma.tenantSettings.findMany({
      include: { tenant: { select: { razaoSocial: true, subdomain: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(config);
  } catch (error) {
    console.error('[ADMIN] Config error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function relatoriosDashboard(req, res) {
  try {
    const now = new Date();
    const meses = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const fim = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const count = await prisma.invoice.count({ where: { createdAt: { gte: d, lt: fim }, status: { not: 'rascunho' } } });
      const tenantsCount = await prisma.tenant.count({ where: { createdAt: { gte: d, lt: fim } } });
      meses.push({ mes: d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }), notas: count, novosTenants: tenantsCount });
    }
    res.json(meses);
  } catch (error) {
    console.error('[ADMIN] Report error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function listarPlanos(req, res) {
  const planos = await prisma.plan.findMany({ where: { ativo: true }, orderBy: { precoMensal: 'asc' } });
  res.json(planos);
}

async function criarPlano(req, res) {
  try {
    const { nome, slug, precoMensal, limiteNotas, maxUsuarios, features } = req.body;
    const plano = await prisma.plan.create({
      data: { nome, slug, precoMensal: Number(precoMensal), limiteNotas: Number(limiteNotas || 0), maxUsuarios: Number(maxUsuarios || 1), features: features || [] },
    });
    res.status(201).json(plano);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ erro: 'Slug já existe' });
    res.status(500).json({ erro: error.message });
  }
}

async function atualizarPlano(req, res) {
  try {
    const { id } = req.params;
    const data = req.body;
    const plano = await prisma.plan.update({ where: { id }, data });
    res.json(plano);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ erro: 'Plano não encontrado' });
    res.status(500).json({ erro: error.message });
  }
}

async function deletarPlano(req, res) {
  try {
    const { id } = req.params;
    await prisma.plan.update({ where: { id }, data: { ativo: false } });
    res.json({ success: true, message: 'Plano desativado' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ erro: 'Plano não encontrado' });
    res.status(500).json({ erro: error.message });
  }
}

async function atualizarUsuario(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ erro: 'Status inválido' });
    }

    const user = await prisma.user.findUnique({ where: { id }, select: { tenantId: true } });
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' });

    await prisma.user.update({ where: { id }, data: { status } });

    // Cascade: se um usuário for bloqueado/ativado, refletir no tenant
    await prisma.tenant.update({ where: { id: user.tenantId }, data: { status } });

    res.json({ success: true, userStatus: status, tenantStatus: status });
  } catch (error) {
    console.error('[ADMIN] Update user error:', error);
    if (error.code === 'P2025') return res.status(404).json({ erro: 'Usuário não encontrado' });
    res.status(500).json({ erro: error.message });
  }
}

module.exports = { dashboard, listarTenants, atualizarTenant, listarUsuarios, atualizarUsuario, getConfiguracoes, relatoriosDashboard, listarPlanos, criarPlano, atualizarPlano, deletarPlano };