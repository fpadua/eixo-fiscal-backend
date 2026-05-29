const { z } = require('zod');
const uiConfigService = require('../services/ui-config.service');

async function getConfig(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const config = await uiConfigService.getUiConfig(tenantId);
    res.json(config);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

async function updateConfig(req, res) {
  const schema = z.object({
    nfseVersion: z.enum(['v1', 'v2']).optional(),
    ambiente: z.enum(['homologacao', 'producao']).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  if (parse.data.nfseVersion || parse.data.ambiente) {
    return res.status(403).json({
      erro: 'Versão e ambiente só podem ser alterados pelo administrador master no painel administrativo',
      code: 'MASTER_ADMIN_REQUIRED',
    });
  }

  res.json(await uiConfigService.getUiConfig(req.tenantId || 'default-tenant-id'));
}

module.exports = {
  getConfig,
  updateConfig,
};