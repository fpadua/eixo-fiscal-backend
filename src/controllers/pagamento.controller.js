const { MercadoPagoConfig, Payment } = require('mercadopago');
const prisma = require('../lib/prisma');

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

async function webhook(req, res) {
  try {
    const { action, data } = req.body;

    if (action === 'payment.updated' || action === 'payment.created') {
      const mpPayment = new Payment(client);
      const result = await mpPayment.get({ id: data.id });

      const status = result.status;
      const tenantId = result.external_reference;

      if (tenantId) {
        await prisma.payment.updateMany({
          where: { mpPaymentId: String(data.id) },
          data: {
            status,
            statusDetail: result.status_detail,
            paidAt: status === 'approved' ? new Date() : undefined,
            mpRawResponse: result,
          },
        });

        if (status === 'approved') {
          await prisma.tenant.update({
            where: { id: tenantId },
            data: {
              planStatus: 'active',
              planInicio: new Date(),
            },
          });
          console.log(`[WEBHOOK] Pagamento ${data.id} aprovado para tenant ${tenantId}`);
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('[WEBHOOK] Error:', error);
    res.sendStatus(200);
  }
}

async function criar(req, res) {
  try {
    const { formData, preferenceId } = req.body;
    const tenantId = req.tenantId;

    if (!formData?.transaction_amount || !formData?.payment_method_id) {
      return res.status(400).json({ erro: 'Dados de pagamento inválidos', code: 'INVALID_PAYMENT_DATA' });
    }

    // Cria registro do pagamento ANTES de chamar o MP para rastrear falhas
    const paymentRecord = await prisma.payment.create({
      data: {
        tenantId,
        mpPreferenceId: preferenceId || null,
        status: 'processing',
        transactionAmount: Number(Number(formData.transaction_amount).toFixed(2)),
        paymentMethodId: formData.payment_method_id,
        paymentTypeId: null,
        installments: Number(formData.installments) || 1,
        description: formData.description || 'Assinatura de plano',
        payerEmail: formData.payer?.email || req.user?.email || null,
        payerName: [formData.payer?.first_name, formData.payer?.last_name].filter(Boolean).join(' ') || null,
        payerDocument: formData.payer?.identification?.number || null,
        billingCycle: null,
      },
    });

    try {
      const paymentBody = {
        transaction_amount: Number(Number(formData.transaction_amount).toFixed(2)),
        description: formData.description || 'Assinatura de plano',
        payment_method_id: formData.payment_method_id,
        binary_mode: true,
        payer: {
          email: formData.payer?.email || req.user?.email || '',
        },
      };

      if (formData.payer?.identification) {
        paymentBody.payer.identification = formData.payer.identification;
      }
      if (formData.payer?.first_name) {
        paymentBody.payer.first_name = formData.payer.first_name;
      }
      if (formData.payer?.last_name) {
        paymentBody.payer.last_name = formData.payer.last_name;
      }

      if (formData.token) {
        paymentBody.token = formData.token;
        paymentBody.installments = Number(formData.installments) || 1;
        paymentBody.issuer_id = formData.issuer_id;
      }

      const mpPayment = new Payment(client);
      const result = await mpPayment.create({ body: paymentBody });

      // Atualiza registro com dados do MP
      const updateData = {
        mpPaymentId: String(result.id),
        status: result.status,
        statusDetail: result.status_detail,
        paymentTypeId: result.payment_type_id || null,
        netReceivedAmount: result.transaction_details?.net_received_amount
          ? Number(result.transaction_details.net_received_amount)
          : null,
        paidAt: result.status === 'approved' ? new Date() : null,
        mpRawResponse: result,
      };

      await prisma.payment.update({
        where: { id: paymentRecord.id },
        data: updateData,
      });

      if (result.status === 'approved') {
        if (tenantId) {
          await prisma.tenant.update({
            where: { id: tenantId },
            data: { planStatus: 'active', planInicio: new Date() },
          });
        }
      }

      res.json({
        status: result.status,
        id: result.id,
        paymentId: paymentRecord.id,
        pixData: result.point_of_interaction?.transaction_data
          ? {
              qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64 || null,
              qrCode: result.point_of_interaction.transaction_data.qr_code || null,
              ticketUrl: result.point_of_interaction.transaction_data.ticket_url || null,
            }
          : null,
      });
    } catch (mpError) {
      // Marca pagamento como falha
      await prisma.payment.update({
        where: { id: paymentRecord.id },
        data: { status: 'failed', mpRawResponse: mpError },
      });
      throw mpError;
    }
  } catch (error) {
    console.error('[PAGAMENTO] Criar error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    if (error.cause) console.error('[PAGAMENTO] Cause:', error.cause);
    res.status(500).json({ erro: 'Erro ao processar pagamento', code: 'PAYMENT_CREATE_ERROR' });
  }
}

async function enviarPixEmail(req, res) {
  try {
    const { paymentId } = req.body;
    if (!paymentId) {
      return res.status(400).json({ erro: 'paymentId é obrigatório' });
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { tenant: true },
    });

    if (!payment || !payment.mpRawResponse) {
      return res.status(404).json({ erro: 'Pagamento ou dados PIX não encontrados' });
    }

    const pixData = payment.mpRawResponse?.point_of_interaction?.transaction_data;
    if (!pixData) {
      return res.status(400).json({ erro: 'Dados PIX não disponíveis para este pagamento' });
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return res.status(500).json({ erro: 'Resend não configurado' });
    }

    const { Resend } = require('resend');
    const resend = new Resend(resendKey);

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a2e;">Pagamento via PIX</h2>
        <p>Olá!</p>
        <p>Você iniciou um pagamento via PIX no valor de <strong>R$ ${Number(payment.transactionAmount).toFixed(2)}</strong>.</p>
        <p>Escaneie o QR Code abaixo ou copie o código PIX para pagar:</p>
        ${pixData.qr_code_base64 ? `<img src="data:image/png;base64,${pixData.qr_code_base64}" alt="QR Code PIX" style="display: block; margin: 20px auto; width: 200px; height: 200px;" />` : ''}
        <div style="background: #f5f5f5; padding: 12px; border-radius: 8px; margin: 16px 0; word-break: break-all; font-family: monospace; font-size: 12px;">
          ${pixData.qr_code || ''}
        </div>
        <p style="color: #666; font-size: 14px;">Após o pagamento, a confirmação pode levar alguns segundos.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">Se você não solicitou este pagamento, ignore este e-mail.</p>
      </div>
    `;

    const fromAddr = process.env.EMAIL_FROM || 'onboarding@resend.dev';
    const emailResp = await resend.emails.send({
      from: fromAddr,
      to: payment.payerEmail,
      subject: `Pagamento PIX - R$ ${Number(payment.transactionAmount).toFixed(2)}`,
      html,
    });

    console.log('[PIX EMAIL] Enviado:', emailResp);
    res.json({ success: true, message: 'E-mail enviado com sucesso' });
  } catch (error) {
    console.error('[PIX EMAIL] Error:', error);
    res.status(500).json({ erro: 'Erro ao enviar e-mail' });
  }
}

module.exports = { webhook, criar, enviarPixEmail };
