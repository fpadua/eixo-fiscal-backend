const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ALLOWED_VERSIONS = new Set(['v1', 'v2']);
const ALLOWED_AMBIENTES = new Set(['homologacao', 'producao']);

async function getUiConfig(tenantId) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
  });

  if (!settings) {
    return {
      nfseVersion: 'v2',
      ambiente: 'homologacao',
    };
  }

  return {
    nfseVersion: ALLOWED_VERSIONS.has(settings.nfseVersion) ? settings.nfseVersion : 'v2',
    ambiente: ALLOWED_AMBIENTES.has(settings.ambiente) ? settings.ambiente : 'producao',
  };
}

async function setNfseVersion(tenantId, nfseVersion) {
  if (!ALLOWED_VERSIONS.has(nfseVersion)) {
    throw new Error('Versão inválida. Use v1 ou v2.');
  }

  await prisma.tenantSettings.upsert({
    where: { tenantId },
    update: { nfseVersion },
    create: { tenantId, nfseVersion },
  });

  return { nfseVersion, ambiente: (await getUiConfig(tenantId)).ambiente };
}

async function setAmbiente(tenantId, ambiente) {
  if (!ALLOWED_AMBIENTES.has(ambiente)) {
    throw new Error('Ambiente inválido. Use homologacao ou producao.');
  }

  await prisma.tenantSettings.upsert({
    where: { tenantId },
    update: { ambiente },
    create: { tenantId, ambiente },
  });

  return { ...await getUiConfig(tenantId), ambiente };
}

module.exports = {
  getUiConfig,
  setNfseVersion,
  setAmbiente,
};
