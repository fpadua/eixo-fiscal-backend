const { PrismaClient } = require('@prisma/client');
const { calcularPrecos, validarBillingCycle } = require('../utils/planoPrecos');
const prisma = new PrismaClient();
const { MercadoPagoConfig, Preference } = require('mercadopago');

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

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
    const billingCycle = validarBillingCycle(req.body?.billingCycle);

    const plano = await prisma.plan.findUnique({ where: { id } });
    if (!plano) {
      return res.status(404).json({ erro: 'Plano não encontrado' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

    // Se o tenant já tem um plano ativo, atualiza direto (upgrade/downgrade)
    if (tenant && tenant.planStatus === 'active' && tenant.planId) {
      const data = {
        planId: plano.id,
        billingCycle,
        planInicio: new Date(),
      };
      const updated = await prisma.tenant.update({
        where: { id: tenantId },
        data,
        include: { plan: true },
      });
      const precos = calcularPrecos(plano, billingCycle);
      return res.json({
        message: `Plano alterado para ${plano.nome} com sucesso!`,
        plano,
        billingCycle,
        precos,
      });
    }

    // Calcula o preço correto conforme o ciclo de faturamento
    const precos = calcularPrecos(plano, billingCycle);
    const precoCobrado = billingCycle === 'annual'
      ? Number(precos.equivalenteMensal)
      : Number(precos.mensal);
    const precoFormatado = Number(precoCobrado.toFixed(2));

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [
          {
            id: plano.id,
            title: `Plano ${plano.nome}${billingCycle === 'annual' ? ' (Anual)' : ''}`,
            unit_price: precoFormatado,
            quantity: 1,
            currency_id: 'BRL',
          },
        ],
        back_urls: {
          success: `${process.env.FRONTEND_URL}/pagamento/sucesso`,
          failure: `${process.env.FRONTEND_URL}/pagamento/erro`,
          pending: `${process.env.FRONTEND_URL}/pagamento/pendente`,
        },
        external_reference: tenantId,
      },
    });

    // Marca o plano como pendente de pagamento
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        planId: plano.id,
        planStatus: 'pendente',
        billingCycle,
      },
    });

    res.json({
      id: result.id,
      urlCheckout: result.init_point,
      mpPublicKey: process.env.MP_PUBLIC_KEY,
      amount: precoFormatado,
    });
  } catch (error) {
    console.error('[PLANO] Subscribe error:', error);
    res.status(500).json({ erro: error.message });
  }
}

module.exports = { listar, assinar };