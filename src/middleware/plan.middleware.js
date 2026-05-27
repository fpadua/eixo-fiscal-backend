const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function planGuard(req, res, next) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const now = new Date();
    const mesAtual = new Date(now.getFullYear(), now.getMonth(), 1);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { plan: true },
    });

    if (tenant?.plan && tenant.plan.limiteNotas > 0) {
      const notasMes = await prisma.invoice.count({
        where: { tenantId, createdAt: { gte: mesAtual }, status: { not: 'rascunho' } },
      });

      if (notasMes >= tenant.plan.limiteNotas) {
        return res.status(403).json({
          erro: 'Limite de notas do plano atingido',
          code: 'PLAN_LIMIT_EXCEEDED',
          plano: tenant.plan.nome,
          limite: tenant.plan.limiteNotas,
          utilizadas: notasMes,
        });
      }
    }

    next();
  } catch (error) {
    console.error('[PLAN_GUARD] Error:', error);
    next();
  }
}

function requirePermissao(permissao) {
  return async (req, res, next) => {
    try {
      const tenantId = req.tenantId || 'default-tenant-id';

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { plan: true },
      });

      const permissoes = tenant?.plan?.permissoes || {};

      if (permissoes[permissao] !== true) {
        return res.status(403).json({
          erro: 'Seu plano não tem permissão para esta funcionalidade',
          code: 'PLAN_PERMISSION_DENIED',
          permissao,
          plano: tenant?.plan?.nome || 'Sem plano',
        });
      }

      next();
    } catch (error) {
      console.error('[REQUIRE_PERMISSAO] Error:', error);
      next();
    }
  };
}

module.exports = { planGuard, requirePermissao };