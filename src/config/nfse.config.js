require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Determina ambiente a partir de .env ou do JSON
const UI_CONFIG_PATH = path.resolve(__dirname, '../../../config/nfse-ui.json');
function _readUiConfig(){
  try { return JSON.parse(fs.readFileSync(UI_CONFIG_PATH,'utf-8')); } catch(e){return {};}
}
function _resolveMode(){
  const ui = _readUiConfig();
  if(process.env.NFSE_HOMOLOGACAO!==undefined){
    return process.env.NFSE_HOMOLOGACAO==='true' ? 'homologacao' : 'producao';
  }
  return ui.ambiente || 'homologacao';
}
const mode = _resolveMode();
const homologacao = mode === 'homologacao';

// Configurações por versão
// v1: ABRASF 2.04 (Legado ISSNet)
// v2: NFS-e Nacional / DPS (Padrão Nacional SPED)
const versionConfigs = {
  v1: {
    endpoint: 'https://www.issnetonline.com.br/homologaabrasf/webservicenfse204/goiania/nfse.asmx',
    wsdl: 'https://www.issnetonline.com.br/homologaabrasf/webservicenfse204/goiania/nfse.asmx?wsdl',
    namespace: 'http://nfse.abrasf.org.br'
  },
  v2: {
    endpoint: 'https://nfse.issnetonline.com.br/wsnfsenacional/homologacao/nfse.asmx',
    wsdl: 'https://nfse.issnetonline.com.br/wsnfsenacional/homologacao/nfse.asmx?wsdl',
    namespace: 'http://www.sped.fazenda.gov.br/nfse'
  },
};

function _readUiVersion() {
  try {
    const raw = fs.readFileSync(UI_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed?.nfseVersion;
  } catch {
    return null;
  }
}

function _resolveVersion(explicitVersion) {
  const version = explicitVersion || _readUiVersion() || process.env.NFSE_VERSION || 'v2';
  return versionConfigs[version] ? version : 'v2';
}

function getConfig(explicitVersion) {
  const ui = _readUiConfig();
  const mode = _resolveMode(); // 'homologacao' ou 'producao'
  const version = _resolveVersion(explicitVersion);
  const defaults = versionConfigs[version] || versionConfigs.v2;
  const envOverrides = ui[mode] || {};

  return {
    version,
    // Endpoint do WebService NFS-e - pode ser sobrescrito por .env ou UI config
    endpoint: process.env.NFSE_ENDPOINT || envOverrides.NFSE_ENDPOINT || defaults.endpoint,
    wsdl: process.env.NFSE_WSDL || envOverrides.NFSE_WSDL || defaults.wsdl,

    // Ambiente: true = Homologação (tpAmb=2), false = Produção (tpAmb=1)
    homologacao: mode === 'homologacao',
    tpAmb: mode === 'homologacao' ? 2 : 1,

    // Namespace permanece conforme versão
    namespace: defaults.namespace,

    prestador: {
      inscricaoMunicipal: process.env.INSCRICAO_MUNICIPAL || '',
      cnpj: process.env.CNPJ_PRESTADOR || '',
      razaoSocial: process.env.RAZAO_SOCIAL || '',
      fone: process.env.FONE_PRESTADOR || '',
      email: process.env.EMAIL_PRESTADOR || '',
      endereco: {
        logradouro: process.env.PRESTADOR_LOGRADOURO || '',
        numero: process.env.PRESTADOR_NUMERO || '',
        complemento: process.env.PRESTADOR_COMPLEMENTO || '',
        bairro: process.env.PRESTADOR_BAIRRO || '',
        codigoMunicipio: process.env.PRESTADOR_CODIGO_MUNICIPIO || '',
        cep: process.env.PRESTADOR_CEP || '',
      },
    },

    cert: {
      path: process.env.CERT_PATH || './certs/',
      password: process.env.CERT_PASSWORD || '',
    },

    port: parseInt(process.env.PORT || '3001', 10),
    frontendUrl: process.env.FRONTEND_URL || envOverrides.FRONTEND_URL || 'http://localhost:3000',
    isMock: process.env.NFSE_MOCK === 'true',
    _debug: {
      NFSE_VERSION_ENV: process.env.NFSE_VERSION,
      NFSE_VERSION_UI: _readUiVersion(),
      NFSE_MOCK: process.env.NFSE_MOCK,
      CERT_PATH: process.env.CERT_PATH,
      NFSE_HOMOLOGACAO: process.env.NFSE_HOMOLOGACAO,
      AMBIENTE_RESOLVIDO: mode,
    },

    // Código IBGE de Goiânia
    codigoMunicipioNacional: process.env.CODIGO_MUNICIPIO_NACIONAL || '5002704',
    codigoMunicipioCampoGrande: '5002704',
    codigoMunicipioGoiania: '5208707',
  };
}

const configProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === 'getConfig') return getConfig;
      return getConfig()[prop];
    },
  }
);

module.exports = configProxy;

const initial = getConfig();
console.log('[NFSE CONFIG]', {
  version: initial.version,
  endpoint: initial.endpoint,
  namespace: initial.namespace,
});
