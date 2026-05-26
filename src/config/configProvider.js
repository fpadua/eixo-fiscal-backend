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

    const ambiente = settings.ambiente || 'homologacao';
    const isMock = !settings.certificateContent;
    const version = settings.nfseVersion || 'v2';

    const endereco = tenant.endereco && typeof tenant.endereco === 'object' ? tenant.endereco : {};
    const razaoSocial = (tenant.razaoSocial || '').trim() || `EMPRESA ${tenant.cnpj || 'CNPJ'}`;
    const config = {
      prestador: {
        cnpj: tenant.cnpj,
        inscricaoMunicipal: tenant.inscricaoMunicipal,
        razaoSocial,
        xNome: razaoSocial,
        endereco: {
          logradouro: endereco.logradouro || endereco.xLgr || 'Sem Logradouro',
          numero: endereco.numero || endereco.nro || 'S/N',
          complemento: endereco.complemento || endereco.xCpl || '',
          bairro: endereco.bairro || endereco.xBairro || 'Sem Bairro',
          codigoMunicipio: endereco.codigoMunicipio || endereco.cMun || '',
          cep: endereco.cep || endereco.CEP || '00000000',
        },
        fone: tenant.telefone || '00000000000',
        telefone: tenant.telefone || '00000000000',
        email: tenant.email || 'sem@email.com',
      },
      certificado: settings.certificateContent || null,
      senhaCertificado: settings.certificatePassword || null,
      cert: {
        path: process.env.CERT_PATH || null,
        password: settings.certificatePassword || null,
      },
      ambiente,
      isMock,
      version,
      homologacao: ambiente === 'homologacao',
      namespace: process.env.WEBSERVICE_NAMESPACE || (version === 'v1'
        ? 'http://nfse.abrasf.org.br'
        : 'http://www.sped.fazenda.gov.br/nfse'),
      endpoint: process.env.WEBSERVICE || '',
      tpAmb: ambiente === 'producao' ? '1' : '2',
      port: parseInt(process.env.PORT, 10) || 3001,
      frontendUrl: process.env.FRONTEND_URL || '',
      codigoMunicipioNacional: tenant.endereco?.codigoMunicipio || process.env.CODIGO_MUNICIPIO_NACIONAL || '5208707',
      codigoMunicipioGoiania: tenant.endereco?.codigoMunicipio || process.env.CODIGO_MUNICIPIO_GOIANIA || '5208707',
    };

    return config;
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { getConfig };
