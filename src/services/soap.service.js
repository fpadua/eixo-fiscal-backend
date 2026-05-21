const axios = require('axios');
const forge = require('node-forge');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('../config/nfse.config');

const soapActionNamespace = config.version === 'v1'
  ? 'http://nfse.abrasf.org.br'
  : 'http://www.sped.fazenda.gov.br/nfse';
const XML_STORAGE_DIR = path.resolve('D:/Home/app-nfs/backend/storage/xml');
const NFSE_V2_VERSAO_DADOS = process.env.NFSE_V2_VERSAO_DADOS || '1.01';
const NFSE_V2_CABECALHO_XMLNS = process.env.NFSE_V2_CABECALHO_XMLNS || 'http://www.sped.fazenda.gov.br/nfse';
let lastSoapAudit = null;

function _salvarXmlAuditoria(nomeArquivo, conteudo) {
  if (!conteudo) return null;
  if (!fs.existsSync(XML_STORAGE_DIR)) fs.mkdirSync(XML_STORAGE_DIR, { recursive: true });

  const filePath = path.join(XML_STORAGE_DIR, nomeArquivo);
  fs.writeFileSync(filePath, conteudo, 'utf8');
  return filePath;
}

/**
 * Extrai corretamente o certificado TITULAR do .pfx
 * comparando a chave pública do cert com a chave privada extraída.
 * Evita o erro: key values mismatch
 */
function _getHttpsAgent() {
  const options = {
    keepAlive: true,
    timeout: 60000,
    rejectUnauthorized: false,
  };

  if (!config.cert?.path || !fs.existsSync(config.cert.path)) {
    // Se o caminho não existir, aborta sem tentar renomear
    return new https.Agent(options);
  }

  // Verifica se o diretório pai contém apenas dígitos (CNPJ ou CPF) e tem comprimento 11 ou 14
  const certDir = require('path').dirname(config.cert.path);
  const folderName = require('path').basename(certDir);
  if (!/^(\d{11}|\d{14})$/.test(folderName)) {
    console.warn('[SOAP] Diretório do certificado não corresponde a CNPJ/CPF; usando agente padrão sem certificado');
    return new https.Agent(options);
  }

  try {
    const pfxBuffer = fs.readFileSync(config.cert.path);
    const password = config.cert.password || '';
    const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

    let privateKey = null;
    let privateKeyPem = null;
    const allCerts = [];

    for (const safeContent of p12.safeContents) {
      for (const safeBag of safeContent.safeBags) {
        if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag && safeBag.key) {
          privateKey = safeBag.key;
          privateKeyPem = forge.pki.privateKeyToPem(safeBag.key);
        }
        if (safeBag.type === forge.pki.oids.certBag && safeBag.cert) {
          allCerts.push(safeBag.cert);
        }
      }
    }

    if (!privateKey || allCerts.length === 0) {
      throw new Error('Não foi possível extrair chave/certificados do .pfx');
    }

    // Encontra o certificado que corresponde à chave privada
    const pubPemFromPrivate = forge.pki.publicKeyToPem(
      forge.pki.rsa.setPublicKey(privateKey.n, privateKey.e)
    );

    let titularCert = null;
    const caCerts = [];

    for (const cert of allCerts) {
      const pubPemFromCert = forge.pki.publicKeyToPem(cert.publicKey);
      if (pubPemFromCert === pubPemFromPrivate) {
        titularCert = cert;
      } else {
        caCerts.push(cert);
      }
    }

    if (!titularCert) {
      console.warn('[SOAP] Cert titular não encontrado por comparação — usando primeiro cert');
      titularCert = allCerts[0];
    }

    options.key = privateKeyPem;
    options.cert = forge.pki.certificateToPem(titularCert);
    if (caCerts.length > 0) {
      options.ca = caCerts.map(c => forge.pki.certificateToPem(c));
    }

    const cn = titularCert.subject.getField('CN')?.value || 'N/A';
    console.log(`[SOAP] Certificado: CN=${cn} | Válido até: ${titularCert.validity.notAfter}`);

  } catch (err) {
    console.error('[SOAP] Erro ao carregar certificado:', err.message);
  }

  return new https.Agent(options);
}

function _getHttpsAgentWithCert(pfxBuffer, password) {
  const options = {
    keepAlive: true,
    timeout: 60000,
    rejectUnauthorized: false,
  };

  try {
    const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

    let privateKey = null;
    let privateKeyPem = null;
    const allCerts = [];

    for (const safeContent of p12.safeContents) {
      for (const safeBag of safeContent.safeBags) {
        if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag && safeBag.key) {
          privateKey = safeBag.key;
          privateKeyPem = forge.pki.privateKeyToPem(safeBag.key);
        }
        if (safeBag.type === forge.pki.oids.certBag && safeBag.cert) {
          allCerts.push(safeBag.cert);
        }
      }
    }

    if (!privateKey || allCerts.length === 0) {
      throw new Error('Não foi possível extrair chave/certificados do .pfx');
    }

    const pubPemFromPrivate = forge.pki.publicKeyToPem(
      forge.pki.rsa.setPublicKey(privateKey.n, privateKey.e)
    );

    let titularCert = null;
    const caCerts = [];

    for (const cert of allCerts) {
      const pubPemFromCert = forge.pki.publicKeyToPem(cert.publicKey);
      if (pubPemFromCert === pubPemFromPrivate) {
        titularCert = cert;
      } else {
        caCerts.push(cert);
      }
    }

    if (!titularCert) {
      titularCert = allCerts[0];
    }

    options.key = privateKeyPem;
    options.cert = forge.pki.certificateToPem(titularCert);
    if (caCerts.length > 0) {
      options.ca = caCerts.map(c => forge.pki.certificateToPem(c));
    }
  } catch (error) {
    console.warn('[SOAP] Erro ao processar certificado em memória:', error.message);
  }

  return new https.Agent(options);
}

/**
 * Monta o envelope SOAP conforme manual ABRASF 2.04 seção 7.4.1
 *
 * REGRAS CRÍTICAS:
 *  1. O cabeçalho usa xmlns do SERVIÇO: http://nfse.abrasf.org.br
 *     NÃO o namespace dos dados (http://www.abrasf.org.br/nfse.xsd)
 *  2. versaoDados = "2.04" para v1, "1.01" para v2 (schema_v101)
 *  3. Ambos (cabecalho e dadosMsg) vão dentro de CDATA — sem <?xml?>
 *  4. O único <?xml?> fica na primeira linha do envelope SOAP
 */
function _montarEnvelope(operacao, xmlConteudo) {
  const xmlLimpo = xmlConteudo
    .replace(/<\?xml[^?]*\?>/gi, '')
    .trim();

  // Namespace da operação (vai variar conforme a versão)
  const nsOperacao = config.namespace;

  // Versão dos dados conforme a versão da NFSe (schema v101 exige exatamente "1.01")
  const versaoDados = config.version === 'v1' ? '2.04' : NFSE_V2_VERSAO_DADOS;
  const versaoCabecalho = config.version === 'v1' ? '2.04' : NFSE_V2_VERSAO_DADOS;
  const xmlnsCabecalho = NFSE_V2_CABECALHO_XMLNS
    ? ` xmlns="${NFSE_V2_CABECALHO_XMLNS}"`
    : '';
  const xmlCabecalho = config.version === 'v1'
    ? `<cabecalho versao="2.04"><versaoDados>${versaoDados}</versaoDados></cabecalho>`
    : `<cabecalho versao="${versaoCabecalho}"${xmlnsCabecalho}><versaoDados>${versaoDados}</versaoDados></cabecalho>`;

  // ESTA LINHA DEVE SER UMA ÚNICA LINHA, SEM QUEBRAS OU INDENTAÇÃO
  const wrapperName = operacao;
  const paramNamespace = config.version === 'v1' ? '' : ' xmlns=""';

  if (config.version === 'v2') {
    return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:nfse="${nsOperacao}"><soap:Header/><soap:Body><nfse:${wrapperName}><nfseCabecMsg>${xmlCabecalho}</nfseCabecMsg><nfseDadosMsg>${xmlLimpo}</nfseDadosMsg></nfse:${wrapperName}></soap:Body></soap:Envelope>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Header/><soap:Body><${wrapperName} xmlns="${nsOperacao}"><nfseCabecMsg${paramNamespace}><![CDATA[${xmlCabecalho}]]></nfseCabecMsg><nfseDadosMsg${paramNamespace}><![CDATA[${xmlLimpo}]]></nfseDadosMsg></${wrapperName}></soap:Body></soap:Envelope>`;
}

// Mapeamento: nome interno → método SOAP real no WSDL
const METODOS_SOAP = {
  'RecepcionarLoteRps': 'RecepcionarLoteRps',
  'RecepcionarLoteRpsSincrono': 'RecepcionarLoteRpsSincrono',
  'GerarNfse': 'GerarNfse',
  'CancelarNfse': 'CancelarNfse',
  'SubstituirNfse': 'SubstituirNfse',
  'ConsultarLoteRps': 'ConsultarLoteRps',
  'ConsultarNfsePorRps': 'ConsultarNfsePorRps',
  'ConsultarNfsePorFaixa': 'ConsultarNfsePorFaixa',
  'ConsultarSituacaoLoteRps': 'ConsultarSituacaoLoteRps',
  'ConsultarDadosCadastrais': 'ConsultarDadosCadastrais',
};

async function enviarSoap(operacao, xmlConteudo, pfxBuffer, password) {
  const metodo = METODOS_SOAP[operacao] || operacao;
  const endpoint = config.endpoint;
  const envelope = _montarEnvelope(metodo, xmlConteudo);
  const soapAction = `${soapActionNamespace}/${metodo}`;
  const soapEnvelopePath = _salvarXmlAuditoria(`${Date.now()}_${metodo}_soap_envelope.xml`, envelope);
  lastSoapAudit = { soapEnvelopePath, soapEnvelope: envelope, endpoint, soapAction };

  if (config.isMock) {
    console.log(`[MOCK] Operação: ${operacao}`);
    return _mockResponse(operacao);
  }

  console.log(`[SOAP] Enviando ${operacao} → método ${metodo}`);
  console.log('[SOAP] Envelope (500 chars):', envelope.substring(0, 500));
  console.log('[SOAP] Envelope salvo em:', soapEnvelopePath);

  try {
    const httpsAgent = pfxBuffer
      ? _getHttpsAgentWithCert(pfxBuffer, password)
      : _getHttpsAgent();

    const response = await axios.post(endpoint, envelope, {
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        'SOAPAction': `"${soapAction}"`,
      },
      timeout: 60000,
      httpsAgent,
      validateStatus: () => true,
    });

    console.log(`[SOAP] Status HTTP: ${response.status}`);
    lastSoapAudit = { ...lastSoapAudit, status: response.status };

    if (response.status >= 400) {
      lastSoapAudit = { ...lastSoapAudit, responseData: response.data };
      if (typeof response.data === 'string' && response.data.trim().startsWith('<')) {
        return response.data;
      }

      const error = new Error(`Erro do WebService (${response.status}): ${String(response.data)}`);
      error.status = response.status;
      error.responseData = response.data;
      throw error;
    }

    return response.data;
  } catch (error) {
    if (error.response) {
      lastSoapAudit = { ...lastSoapAudit, status: error.response.status, responseData: error.response.data };
      if (typeof error.response.data === 'string' && error.response.data.trim().startsWith('<')) {
        return error.response.data;
      }

      const wrapped = new Error(`Erro do WebService (${error.response.status}): ${String(error.response.data)}`);
      wrapped.status = error.response.status;
      wrapped.responseData = error.response.data;
      throw wrapped;
    }
    throw error;
  }
}

function _mockResponse(operacao) {
  const mockBodies = {
    RecepcionarLoteRps: `
      <EnviarLoteRpsResposta xmlns="http://www.abrasf.org.br/nfse.xsd">
        <NumeroLote>1</NumeroLote>
        <DataRecebimento>2025-05-09T00:00:00</DataRecebimento>
        <Protocolo>202500000001</Protocolo>
      </EnviarLoteRpsResposta>`,
    GerarNfse: `
      <GerarNfseResposta xmlns="http://www.abrasf.org.br/nfse.xsd">
        <ListaNfse>
          <CompNfse>
            <Nfse>
              <InfNfse>
                <Numero>370</Numero>
                <CodigoVerificacao>ABC123456</CodigoVerificacao>
                <DataEmissao>2025-05-09T00:00:00</DataEmissao>
              </InfNfse>
            </Nfse>
          </CompNfse>
        </ListaNfse>
      </GerarNfseResposta>`,
    CancelarNfse: `
      <CancelarNfseResposta xmlns="http://www.abrasf.org.br/nfse.xsd">
        <RetCancelamento>
          <NfseCancelamento>
            <Confirmacao><DataHora>2025-05-09T00:00:00</DataHora></Confirmacao>
          </NfseCancelamento>
        </RetCancelamento>
      </CancelarNfseResposta>`,
    ConsultarNfsePorRps: `
      <ConsultarNfseRpsResposta xmlns="http://www.abrasf.org.br/nfse.xsd">
        <CompNfse>
          <Nfse><InfNfse>
            <Numero>370</Numero>
            <CodigoVerificacao>ABC123456</CodigoVerificacao>
          </InfNfse></Nfse>
        </CompNfse>
      </ConsultarNfseRpsResposta>`,
    ConsultarNfsePorFaixa: `
      <ConsultarNfseFaixaResposta xmlns="http://www.abrasf.org.br/nfse.xsd">
        <ListaNfse>
          <CompNfse>
            <Nfse><InfNfse>
              <Numero>370</Numero>
              <CodigoVerificacao>ABC123456</CodigoVerificacao>
            </InfNfse></Nfse>
          </CompNfse>
        </ListaNfse>
      </ConsultarNfseFaixaResposta>`,
  };

  const body = mockBodies[operacao] || `<${operacao}Resposta xmlns="http://www.abrasf.org.br/nfse.xsd"><sucesso>true</sucesso></${operacao}Resposta>`;

  // ESTA LINHA DEVE SER UMA ÚNICA LINHA, SEM QUEBRAS OU INDENTAÇÃO
  return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
}

async function testarConexao() {
  try {
    const response = await axios.get(config.endpoint, {
      timeout: 15000,
      httpsAgent: _getHttpsAgent(),
      validateStatus: () => true,
    });
    return { ok: true, status: response.status };
  } catch (error) {
    return { ok: false, erro: error.message, status: error.response?.status };
  }
}

function getLastSoapAudit() {
  return lastSoapAudit;
}

module.exports = { enviarSoap, testarConexao, getLastSoapAudit };
