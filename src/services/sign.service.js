/**
 * services/sign.service.js
 *
 * Responsável por:
 *  - Carregar o certificado A1 (.pfx) do prestador
 *  - Assinar XMLs no padrão XML-DSig exigido pelo manual ABRASF 2.04
 *  - Suportar assinatura de múltiplos elementos (RPS + Lote + Cancelamento + Substituição)
 *
 * Referências:
 *  - Manual ABRASF 2.04, seção 7.3.3 (Padrão de Assinatura Digital)
 *  - Tabela XS (página 26–27) – estrutura da tag <Signature>
 *  - Observação da página 27: passos de assinatura
 *      1) Assinar cada RPS isoladamente (elemento InfDeclaracaoPrestacaoServico, Id="RPSX")
 *      2) Agrupar RPS assinados em um LoteRps
 *      3) Assinar o LoteRps (Id="LoteX")
 */

const forge = require('node-forge');
const crypto = require('xml-crypto');
const fs = require('fs');
const { getConfig } = require('../config/configProvider');

let config = {};
const _cfgReady = (async () => {
  const cfg = await getConfig('default-tenant-id');
  Object.assign(config, cfg);
})();
async function _ensureConfig() {
  await _cfgReady;
}

/**
 * Carrega o certificado A1 (.pfx) e retorna chave privada + certificado PEM.
 *
 * Aceita buffer do certificado em memória (prioritário) ou caminho em disco via config.
 *
 * @param {Buffer} [pfxBuffer] - Conteúdo do .pfx em buffer (do banco)
 * @param {string} [password] - Senha do certificado
 * @returns {{ privateKeyPem: string, certPem: string }}
 */
function _extrairCredenciaisDoPfx(buffer, pfxPwd) {
  const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(buffer));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, pfxPwd || '');

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
    throw new Error('Não foi possível extrair chave privada ou certificado do arquivo .pfx');
  }

  const pubPemFromPrivate = forge.pki.publicKeyToPem(
    forge.pki.rsa.setPublicKey(privateKey.n, privateKey.e)
  );

  let titularCert = allCerts.find(
    (cert) => forge.pki.publicKeyToPem(cert.publicKey) === pubPemFromPrivate
  );
  if (!titularCert) {
    titularCert = allCerts[0];
  }

  return {
    privateKeyPem,
    certPem: forge.pki.certificateToPem(titularCert),
  };
}

function carregarCertificado(pfxBuffer, password) {
  const pfxPath = config.cert?.path;
  const pfxPwd = password || config.cert?.password;

  let buffer = pfxBuffer;
  if (!buffer) {
    if (!pfxPath || !fs.existsSync(pfxPath)) {
      throw new Error('Arquivo de certificado .pfx não encontrado. Verifique config.cert.path');
    }
    buffer = fs.readFileSync(pfxPath);
  }

  return _extrairCredenciaisDoPfx(buffer, pfxPwd);
}

/**
 * Monta o objeto SignedXml conforme manual NFS-e Nacional v1.01 (seção 7.3.3, tabela XS).
 *
 * Padrão de assinatura:
 *  - CanonicalizationMethod Algorithm:
 *      http://www.w3.org/TR/2001/REC-xml-c14n-20010315
 *  - SignatureMethod Algorithm:
 *      http://www.w3.org/2000/09/xmldsig#rsa-sha1
 *  - DigestMethod Algorithm:
 *      http://www.w3.org/2000/09/xmldsig#sha1
 *  - Transforms:
 *      - http://www.w3.org/2000/09/xmldsig#enveloped-signature
 *      - http://www.w3.org/TR/2001/REC-xml-c14n-20010315
 *
 * @param {string} privateKeyPem
 * @param {string} certPem
 * @param {string} idElemento - valor do atributo Id do elemento a ser assinado (ex: "RPS1", "Lote123")
 * @returns {crypto.SignedXml}
 */
function _criarAssinatura(privateKeyPem, certPem, idElemento) {
  const sig = new crypto.SignedXml({
    privateKey: privateKeyPem,
    publicCert: certPem,
  });

  // Sanitizar idElemento: permitir apenas alfanumérico, : e -
  const safeId = String(idElemento).replace(/[^a-zA-Z0-9:-]/g, '');

  // Referência ao elemento com atributo Id="idElemento"
  sig.addReference({
    xpath: `//*[@Id='${safeId}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });

  sig.canonicalizationAlgorithm =
    'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  sig.signatureAlgorithm =
    'http://www.w3.org/2000/09/xmldsig#rsa-sha1';

  return sig;
}

/**
 * Assina UM elemento do XML, inserindo <Signature> imediatamente após o nó assinado.
 *
 * @param {string} xml - XML de entrada
 * @param {string} idElemento - Id do elemento a ser assinado
 * @param {{ privateKeyPem: string, certPem: string }} credenciais
 * @returns {string} XML assinado
 */
function _assinarElemento(xml, idElemento, credenciais, options = {}) {
  const { privateKeyPem, certPem } = credenciais;
  const safeId = String(idElemento).replace(/[^a-zA-Z0-9:-]/g, '');
  const sig = _criarAssinatura(privateKeyPem, certPem, safeId);

  const computeOptions = {
    location: { reference: `//*[@Id='${safeId}']`, action: options.action || 'after' },
  };
  // NFS-e Nacional v1.01: vedado prefixo de namespace na assinatura (manual 8.1 / declaração namespace)
  if (options.prefix) {
    computeOptions.prefix = options.prefix;
  }

  sig.computeSignature(xml, computeOptions);

  return sig.getSignedXml();
}

/**
 * Assina múltiplos elementos em um mesmo XML, na ordem informada.
 *
 * ATENÇÃO:
 *  - Para o fluxo ABRASF 2.04 recomendado (p.27), a ordem deve ser:
 *      1) Assinar cada RPS individualmente (InfDeclaracaoPrestacaoServico, Id="RPSX")
 *      2) Agrupar os RPS assinados no LoteRps
 *      3) Assinar o LoteRps (Id="LoteY")
 *  - No seu backend, como o Lote já é montado com RPS dentro, usamos a ordem:
 *      ['RPSX', 'LoteY']
 *
 * @param {string} xml - XML de entrada (sem assinaturas)
 * @param {string[]} ids - array de Ids na ordem em que devem ser assinados
 * @returns {string} XML assinado
 */
function assinarMultiplosElementos(xml, ids, pfxBuffer, password, options = {}) {
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Nenhum Id informado para assinatura.');
  }

  const credenciais = carregarCertificado(pfxBuffer, password);

  let xmlAssinado = xml;
  for (const id of ids) {
    xmlAssinado = _assinarElemento(xmlAssinado, id, credenciais, options);
  }

  return xmlAssinado;
}

/**
 * MODO MOCK: não realiza assinatura real, apenas insere comentários
 * indicando quais elementos seriam assinados.
 *
 * Útil para desenvolvimento quando:
 *  - config.isMock = true, ou
 *  - certificado não está disponível em config.cert.path
 *
 * @param {string} xml
 * @param {string[]} ids
 * @returns {string} XML com "assinaturas" simuladas
 */
function assinarMultiplosElementosMock(xml, ids) {
  console.warn('[MOCK] Assinatura digital simulada — sem certificado real.');
  if (!ids || !Array.isArray(ids) || ids.length === 0) return xml;

  let xmlMock = xml;

  // Inserimos um comentário perto do fechamento da tag de cada Id,
  // apenas para facilitar o debug visual. NÃO segue o padrão real
  // de assinatura, é apenas marcador de teste.
  ids.forEach((id) => {
    const tagName = id.split(':')[0]; // ex: "rps:1" → "rps"
    const closingTag = `</${tagName}>`;

    if (xmlMock.includes(closingTag)) {
      xmlMock = xmlMock.replace(
        closingTag,
        `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
  <!-- MOCK: assinatura para Id="${id}". Substituir por assinatura real em produção. -->
  <SignedInfo>
    <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
  </SignedInfo>
</Signature>
${closingTag}`
      );
    }
  });

  return xmlMock;
}

/**
 * Ponto de entrada principal para assinatura múltipla.
 *
 * Regras:
 *  - Se config.isMock = true → utiliza modo mock
 *  - Se não encontrar o arquivo .pfx → também utiliza modo mock, mas avisa no log
 *
 * @param {string} xml
 * @param {string[]} ids
 * @returns {string} XML assinado ou simulado
 */
async function assinarMultiplos(xml, ids, pfxBuffer, password, options = {}) {
  await _ensureConfig();
  const pfxPath = config.cert?.path;

  if (config.isMock || (!pfxBuffer && (!pfxPath || !fs.existsSync(pfxPath)))) {
    if (!config.isMock) {
      console.warn(
        '[SIGN] Certificado .pfx não encontrado. Usando modo MOCK de assinatura.'
      );
    }
    return assinarMultiplosElementosMock(xml, ids);
  }

  return assinarMultiplosElementos(xml, ids, pfxBuffer, password, options);
}

/**
 * Compatibilidade retroativa:
 *  - Algumas partes do código chamam signService.assinar(xml, idElemento)
 *  - Mantemos essa função, mas ela apenas delega para assinarMultiplos com um único Id
 *
 * @param {string} xml
 * @param {string} idElemento
 * @returns {string} XML assinado
 */
async function assinar(xml, idElemento, pfxBuffer, password, options = {}) {
  return assinarMultiplos(xml, [idElemento], pfxBuffer, password, options);
}

async function assinarLote(xml, idRps, idLote, pfxBuffer, password) {
  await _ensureConfig();
  const pfxPath = config.cert?.path;

  if (config.isMock || (!pfxBuffer && (!pfxPath || !fs.existsSync(pfxPath)))) {
    return assinarMultiplosElementosMock(xml, [idRps, idLote]);
  }

  const { privateKeyPem, certPem } = carregarCertificado(pfxBuffer, password);

  // 1ª assinatura: InfDeclaracaoPrestacaoServico (Id="rps:X")
  const sig1 = new crypto.SignedXml({ privateKey: privateKeyPem, publicCert: certPem });
  sig1.addReference({
    xpath: `//*[@Id='${idRps}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig1.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  sig1.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
  sig1.computeSignature(xml, {
    location: { reference: `//*[@Id='${idRps}']`, action: 'after' },
    prefix: 'dsig',
  });
  const xmlComSig1 = sig1.getSignedXml();

  // 2ª assinatura: LoteRps (Id="lote:X")
  const sig2 = new crypto.SignedXml({ privateKey: privateKeyPem, publicCert: certPem });
  sig2.addReference({
    xpath: `//*[@Id='${idLote}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig2.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  sig2.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
  sig2.computeSignature(xmlComSig1, {
    location: { reference: `//*[@Id='${idLote}']`, action: 'after' },
    prefix: 'dsig',
  });

  return sig2.getSignedXml();
}

module.exports = {
  carregarCertificado,
  assinarMultiplosElementos,
  assinarMultiplosElementosMock,
  assinarMultiplos,
  assinar,
  assinarLote,
};