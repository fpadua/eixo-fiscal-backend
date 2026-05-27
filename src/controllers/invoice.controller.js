const InvoiceRepository = require('../repositories/invoice.repository');
const ClientRepository = require('../repositories/client.repository');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const repo = new InvoiceRepository(tenantId);
    const { page = 1, limit = 20, status, dataInicio, dataFim } = req.query;
    const result = await repo.findAll({
      page: Number(page),
      limit: Number(limit),
      status,
      dataInicio,
      dataFim,
    });
    res.json(result);
  } catch (error) {
    console.error('[INVOICE] Error listing:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function buscar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const repo = new InvoiceRepository(tenantId);
    const invoice = await repo.findById(req.params.id);
    if (!invoice) return res.status(404).json({ erro: 'Nota não encontrada' });
    res.json(invoice);
  } catch (error) {
    console.error('[INVOICE] Error fetching:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function estatisticas(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const repo = new InvoiceRepository(tenantId);
    const { dataInicio, dataFim } = req.query;
    const stats = await repo.getStatistics(dataInicio, dataFim);
    res.json(stats);
  } catch (error) {
    console.error('[INVOICE] Error stats:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function planStatus(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const now = new Date();
    const mesAtual = new Date(now.getFullYear(), now.getMonth(), 1);

    const [tenant, notasMes] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { plan: true },
      }),
      prisma.invoice.count({
        where: { tenantId, createdAt: { gte: mesAtual }, status: { not: 'rascunho' } },
      }),
    ]);

    if (!tenant || !tenant.plan) {
      return res.json({ hasPlan: false });
    }

    const plan = tenant.plan;
    const limite = plan.limiteNotas;
    const percentual = limite > 0 ? Math.round((notasMes / limite) * 100) : 0;
    const excedido = limite > 0 && notasMes >= limite;

    res.json({
      hasPlan: true,
      planId: plan.id,
      planName: plan.nome,
      planSlug: plan.slug,
      limiteNotas: limite,
      maxUsuarios: plan.maxUsuarios,
      notasEmitidas: notasMes,
      percentual,
      excedido,
      planStatus: tenant.planStatus,
      proximoLimite: limite > 0 && notasMes >= Math.floor(limite * 0.8),
      permissoes: plan.permissoes || {},
    });
  } catch (error) {
    console.error('[INVOICE] Plan status error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function listarPorCliente(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const repo = new InvoiceRepository(tenantId);
    const { clientId } = req.params;
    const result = await repo.findAll({ clientId, limit: 100 });
    res.json(result);
  } catch (error) {
    console.error('[INVOICE] Error by client:', error);
    res.status(500).json({ erro: error.message });
  }
}

module.exports = { listar, buscar, estatisticas, planStatus, listarPorCliente };