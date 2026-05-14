const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listar(req, res) {
  try {
    const planos = await prisma.plan.findMany({
      where: { ativo: true },
      orderBy: { precoMensal: 'asc' },
    });
    res.json(planos);
  } catch (error) {
    console.error('[PLANO] List error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function assinar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const { id } = req.params;

    const plano = await prisma.plan.findUnique({ where: { id } });
    if (!plano) {
      return res.status(404).json({ erro: 'Plano não encontrado' });
    }

    const now = new Date();
    const mesAtual = new Date(now.getFullYear(), now.getMonth(), 1);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });

    if (plano.limiteNotas > 0) {
      const notasMes = await prisma.invoice.count({
        where: { tenantId, createdAt: { gte: mesAtual }, status: { not: 'rascunho' } },
      });
      if (notasMes > plano.limiteNotas) {
        return res.status(400).json({
          erro: `Seu plano atual já possui ${notasMes} notas emitidas, que excede o limite de ${plano.limiteNotas} do novo plano. Reduza ou aguarde o próximo mês.`,
          code: 'PLAN_DOWNGRADE_EXCEEDED',
        });
      }
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { planId: plano.id, planStatus: 'active', planInicio: new Date() },
    });

    res.json({
      success: true,
      message: `Plano alterado para ${plano.nome} com sucesso!`,
      plano: { id: plano.id, nome: plano.nome, slug: plano.slug, precoMensal: plano.precoMensal, limiteNotas: plano.limiteNotas },
    });
  } catch (error) {
    console.error('[PLANO] Subscribe error:', error);
    res.status(500).json({ erro: error.message });
  }
}

module.exports = { listar, assinar };