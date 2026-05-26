const { PrismaClient } = require('@prisma/client');

async function getConfig(tenantId) {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    if (!tenant || !settings) {
      throw new Error('Configuração do tenant não encontrada');
    }

    const config = {
      prestador: {
        cnpj: tenant.cnpj,
        inscricaoMunicipal: tenant.inscricaoMunicipal,
      },
      certificado: settings.certificateContent || null,
      senhaCertificado: settings.certificatePassword || null,
      ambiente: settings.ambiente || 'homologacao',
    };

    return config;
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { getConfig };
