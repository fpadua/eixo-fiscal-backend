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

  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const data = parse.data;
    let updated = await uiConfigService.getUiConfig(tenantId);

    if (data.nfseVersion) {
      updated = await uiConfigService.setNfseVersion(tenantId, data.nfseVersion);
    }
    if (data.ambiente) {
      updated = await uiConfigService.setAmbiente(tenantId, data.ambiente);
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

module.exports = {
  getConfig,
  updateConfig,
};