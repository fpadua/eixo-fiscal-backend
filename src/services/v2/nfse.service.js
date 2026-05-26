const { XMLParser } = require('fast-xml-parser');
const xmlService = require('./xml.service');
const signService = require('../sign.service');
const soapService = require('../soap.service');
const { getConfig } = require('../../config/configProvider');
const fs = require('fs');
const path = require('path');

let config = null;
const _cfgReady = (async () => {
  config = await getConfig('default-tenant-id');
})();

async function _ensureConfig() {
  if (!config) await _cfgReady;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
});
const XML_STORAGE_DIR = path.resolve('D:/Home/app-nfs/backend/storage/xml');

function _parsearResposta(soapXml) {
  try {
    if (!soapXml || typeof soapXml !== 'string') {
      return { sucesso: false, erro: 'Resposta SOAP vazia ou invalida', xmlResposta: soapXml };
    }

    // Verifica se é resposta mock (sem envelope SOAP)
    if (!/<(?:\w+:)?Envelope\b/.test(soapXml)) {
      // É resposta direta (mock) - parseia diretamente
      try {
        const dados = parser.parse(soapXml);
        const mensagensRetorno = _extrairMensagensRetorno(dados);
        return {
          sucesso: mensagensRetorno.length === 0,
          dados: dados,
          xmlResposta: soapXml,
          numeroNota: _extrairNumeroNota(dados),
          codigoVerificacao: _extrairCodigoVerificacao(dados),
          listaNfse: _extrairListaNfse(dados),
          mensagensRetorno,
        };
      } catch (e) {
        return { sucesso: true, dados: {}, xmlResposta: soapXml };
      }
    }

    const parsed = parser.parse(soapXml);

    const envelope = _getByLocalName(parsed, 'Envelope') || parsed;
    const body = _getByLocalName(envelope, 'Body') || envelope;

    if (!body) {
      return { sucesso: false, erro: 'Resposta SOAP inválida', xmlResposta: soapXml };
    }

    const fault = _getByLocalName(body, 'Fault');
    if (fault) {
      return {
        sucesso: false,
        erro: `SOAP Fault: ${fault.faultstring || fault.reason || JSON.stringify(fault)}`,
        xmlResposta: soapXml,
      };
    }

    const resposta = _extrairPrimeiroValor(body);
    const xmlResp = resposta?.outputXML || resposta?.return || resposta?.body || JSON.stringify(resposta);

    let dadosNota = {};
    if (typeof xmlResp === 'string' && xmlResp.includes('<')) {
      try {
        dadosNota = parser.parse(xmlResp);
      } catch { /* ignora */ }
    }

    // Se xmlResp é JSON string, tenta parsear como objeto
    if (!dadosNota || Object.keys(dadosNota).length === 0) {
      try {
        const parsedJson = JSON.parse(typeof xmlResp === 'string' ? xmlResp : JSON.stringify(xmlResp));
        dadosNota = parsedJson;
      } catch { /* ignora */ }
    }

    // Fallback: usar o próprio body como dados
    if (!dadosNota || Object.keys(dadosNota).length === 0) {
      dadosNota = resposta || body;
    }

    let mensagensRetorno = _extrairMensagensRetorno(dadosNota);
    const mensagensXml = _extrairMensagensRetornoDoXml(soapXml);
    if (mensagensXml.length > 0 && (mensagensRetorno.length === 0 || mensagensRetorno.some(msg => !msg.Codigo))) {
      mensagensRetorno = mensagensXml;
    }

    return {
      sucesso: mensagensRetorno.length === 0,
      dados: dadosNota,
      xmlResposta: soapXml,
      numeroNota: _extrairNumeroNota(dadosNota),
      codigoVerificacao: _extrairCodigoVerificacao(dadosNota),
      listaNfse: _extrairListaNfse(dadosNota),
      mensagensRetorno,
    };
  } catch (err) {
    return { sucesso: false, erro: `Erro ao parsear resposta: ${err.message}`, xmlResposta: soapXml };
  }
}

function _extrairPrimeiroValor(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const keys = Object.keys(obj);
  if (keys.length === 0) return null;
  return obj[keys[0]];
}

function _getByLocalName(obj, localName) {
  if (!obj || typeof obj !== 'object') return null;
  const key = Object.keys(obj).find(k => k === localName || k.endsWith(`:${localName}`));
  return key ? obj[key] : null;
}

function _findByLocalName(obj, localName) {
  if (!obj || typeof obj !== 'object') return null;

  const direct = _getByLocalName(obj, localName);
  if (direct) return direct;

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = _findByLocalName(value, localName);
      if (found) return found;
    }
  }

  return null;
}

function _asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function _toText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') return value['#text'] || value._text || JSON.stringify(value);
  return String(value);
}

function _extrairMensagensRetorno(dados) {
  const lista = _findByLocalName(dados, 'ListaMensagemRetorno')
    || _findByLocalName(dados, 'ListaMensagemRetornoLote')
    || _findByLocalName(dados, 'ListaMensagemAlertaRetorno');

  const mensagens = _getByLocalName(lista, 'MensagemRetorno');

  return _asArray(mensagens).map(mensagem => ({
    Codigo: _toText(_getByLocalName(mensagem, 'Codigo')),
    Mensagem: _toText(_getByLocalName(mensagem, 'Mensagem')),
    Correcao: _toText(_getByLocalName(mensagem, 'Correcao')),
  }));
}

function _extrairMensagensRetornoDoXml(xml) {
  if (!xml || typeof xml !== 'string') return [];

  const mensagens = [];
  const blocos = xml.matchAll(/<MensagemRetorno>([\s\S]*?)<\/MensagemRetorno>/g);

  for (const bloco of blocos) {
    const conteudo = bloco[1];
    const textoTag = (tag) => {
      const match = conteudo.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return match ? match[1].trim() : null;
    };

    mensagens.push({
      Codigo: textoTag('Codigo'),
      Mensagem: textoTag('Mensagem'),
      Correcao: textoTag('Correcao'),
    });
  }

  return mensagens;
}

function _salvarXml(nomeArquivo, conteudo) {
  if (!conteudo) return null;
  if (!fs.existsSync(XML_STORAGE_DIR)) fs.mkdirSync(XML_STORAGE_DIR, { recursive: true });

  const filePath = path.join(XML_STORAGE_DIR, nomeArquivo);
  fs.writeFileSync(filePath, conteudo, 'utf8');
  return filePath;
}

function _anexarXmlAuditoria(resultado, xmlEnviado, xmlResposta, operacao) {
  const soapAudit = soapService.getLastSoapAudit?.();
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0'); // Mês é base 0
  const day = now.getDate().toString().padStart(2, '0');
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');

  const formattedDate = `${year}${month}${day}T${hours}${minutes}${seconds}`;

  if (xmlEnviado) {
    const envioFileName = `${formattedDate}_${operacao}_envio.xml`;
    resultado.xmlEnviado = xmlEnviado;
    resultado.xmlEnviadoPath = _salvarXml(envioFileName, xmlEnviado);
  }

  if (xmlResposta) {
    const respostaFileName = `${formattedDate}_${operacao}_resposta.xml`;
    resultado.xmlResposta = xmlResposta;
    resultado.xmlRespostaPath = _salvarXml(respostaFileName, xmlResposta);
  }

  resultado.modeMock = config?.isMock;
  if (soapAudit?.soapEnvelopePath) resultado.soapEnvelopePath = soapAudit.soapEnvelopePath;
  if (soapAudit?.soapEnvelope) resultado.soapEnvelope = soapAudit.soapEnvelope;
  if (soapAudit?.soapAction) resultado.soapAction = soapAudit.soapAction;
  return resultado;
}

function _extrairNumeroNota(dados) {
  try {
    const path = dados?.GerarNfseResposta?.ListaNfse?.CompNfse?.Nfse?.InfNfse
      || dados?.EnviarLoteDpsSincronoResposta?.ListaNfse?.CompNfse?.Nfse?.InfNfse
      || dados?.CompNfse?.Nfse?.InfNfse
      || dados?.ListaNfse?.CompNfse?.Nfse?.InfNfse;
    return path?.nNFSe || path?.Numero || null;
  } catch { return null; }
}

function _extrairCodigoVerificacao(dados) {
  try {
    const path = dados?.GerarNfseResposta?.ListaNfse?.CompNfse?.Nfse?.InfNfse
      || dados?.EnviarLoteDpsSincronoResposta?.ListaNfse?.CompNfse?.Nfse?.InfNfse
      || dados?.CompNfse?.Nfse?.InfNfse
      || dados?.ListaNfse?.CompNfse?.Nfse?.InfNfse;
    return path?.CodigoVerificacao || path?.codigoVerificacao || null;
  } catch { return null; }
}

function _extrairListaNfse(dados) {
  try {
    const lista = dados?.ListaNfse?.CompNfse
      || dados?.GerarNfseResposta?.ListaNfse?.CompNfse
      || dados?.EnviarLoteDpsSincronoResposta?.ListaNfse?.CompNfse;

    if (!lista) return [];
    return Array.isArray(lista) ? lista : [lista];
  } catch { return []; }
}

function _montarUrlImpressao(numeroNota, codigoVerificacao) {
  return `https://nfse.goiania.go.gov.br/secure/nfse/visualizarNotaFiscal.jsp?numeroNota=${numeroNota}&codigoVerificacao=${codigoVerificacao}`;
}

/**
 * Extrai o Id do elemento raiz do XML gerado (ex: infDPS[@Id=...] ou infNFSe[@Id=...])
 * Usa regex simples para evitar dependência de parser extra
 */
function _extrairIdXml(xml) {
  // Tenta capturar Id="..." do primeiro elemento que tiver
  const match = xml.match(/(?:Id|id)="([^"]+)"/);
  return match ? match[1] : null;
}

async function _assinarXml(xml, idElemento, pfxBuffer, password) {
  if (pfxBuffer) {
    return signService.assinar(xml, idElemento, pfxBuffer, password);
  }
  return signService.assinar(xml, idElemento);
}

async function gerarNfse(dados, pfxBuffer, password) {
  await _ensureConfig();
  const xml = xmlService.gerarXmlGerarNfse(dados);

  const idElemento = _extrairIdXml(xml);
  const xmlAssinado = idElemento
    ? await _assinarXml(xml, idElemento, pfxBuffer, password)
    : xml;

  const respostaSoap = await soapService.enviarSoap('GerarNfse', xmlAssinado, pfxBuffer, password);
  const resultado = _parsearResposta(respostaSoap);

  if (resultado.numeroNota && resultado.codigoVerificacao) {
    resultado.urlImpressao = _montarUrlImpressao(resultado.numeroNota, resultado.codigoVerificacao);
  }

  return _anexarXmlAuditoria(resultado, xmlAssinado, respostaSoap, 'nfse');
}

async function enviarLoteDpsSincrono(listaDps, numeroLote, pfxBuffer, password) {
  await _ensureConfig();
  const xml = xmlService.gerarXmlEnviarLoteDpsSincrono(listaDps, numeroLote);
  const idElemento = _extrairIdXml(xml) || `lote:${numeroLote}`;
  const xmlAssinado = await _assinarXml(xml, idElemento, pfxBuffer, password);
  const respostaSoap = await soapService.enviarSoap('RecepcionarLoteDpsSincrono', xmlAssinado, pfxBuffer, password);
  const resultado = _parsearResposta(respostaSoap);

  if (resultado.listaNfse && resultado.listaNfse.length > 0) {
    const primeira = resultado.listaNfse[0];
    resultado.urlImpressao = _montarUrlImpressao(primeira.Nfse?.InfNfse?.nNFSe, primeira.Nfse?.InfNfse?.CodigoVerificacao);
  }

  return _anexarXmlAuditoria(resultado, xmlAssinado, respostaSoap, 'lote_dps_sincrono');
}

async function recepcionarLoteDps(listaDps, numeroLote, pfxBuffer, password) {
  await _ensureConfig();
  const xml = xmlService.gerarXmlRecepcaoLoteDps(listaDps, numeroLote);
  const idElemento = _extrairIdXml(xml) || `lote:${numeroLote}`;
  const xmlAssinado = await _assinarXml(xml, idElemento, pfxBuffer, password);
  const respostaSoap = await soapService.enviarSoap('RecepcionarLoteDps', xmlAssinado, pfxBuffer, password);
  const resultado = _parsearResposta(respostaSoap);

  return _anexarXmlAuditoria(resultado, xmlAssinado, respostaSoap, 'lote_dps');
}

async function consultarLoteDps(protocolo, cnpjPrestador, inscricaoMunicipal) {
  await _ensureConfig();
  cnpjPrestador = cnpjPrestador || config.prestador.cnpj;
  inscricaoMunicipal = inscricaoMunicipal || config.prestador.inscricaoMunicipal;
  const xml = xmlService.gerarXmlConsultaLote(protocolo, cnpjPrestador, inscricaoMunicipal);
  const respostaSoap = await soapService.enviarSoap('ConsultarLoteDps', xml);
  return _parsearResposta(respostaSoap);
}

async function consultarSituacaoLote(protocolo, cnpjPrestador, inscricaoMunicipal) {
  await _ensureConfig();
  cnpjPrestador = cnpjPrestador || config.prestador.cnpj;
  inscricaoMunicipal = inscricaoMunicipal || config.prestador.inscricaoMunicipal;
  const xml = xmlService.gerarXmlConsultaSituacaoLote(protocolo, cnpjPrestador, inscricaoMunicipal);
  const respostaSoap = await soapService.enviarSoap('ConsultarLoteDps', xml);
  return _parsearResposta(respostaSoap);
}

async function consultarNfsePorDps(numeroDps, serieDps, pfxBuffer, password, cnpjPrestador, inscricaoMunicipal) {
  await _ensureConfig();
  cnpjPrestador = cnpjPrestador || config.prestador.cnpj;
  inscricaoMunicipal = inscricaoMunicipal || config.prestador.inscricaoMunicipal;
  const xml = xmlService.gerarXmlConsultaPorDps(numeroDps, serieDps, cnpjPrestador, inscricaoMunicipal);
  const idElemento = _extrairIdXml(xml) || `dps:${numeroDps}`;
  const xmlAssinado = await _assinarXml(xml, idElemento, pfxBuffer, password);
  const respostaSoap = await soapService.enviarSoap('ConsultarNfsePorDps', xmlAssinado, pfxBuffer, password);
  return _parsearResposta(respostaSoap);
}

async function consultarNfsePorFaixa(numeroInicial, numeroFinal, pagina, cnpjPrestador, inscricaoMunicipal) {
  await _ensureConfig();
  cnpjPrestador = cnpjPrestador || config.prestador.cnpj;
  inscricaoMunicipal = inscricaoMunicipal || config.prestador.inscricaoMunicipal;
  const xml = xmlService.gerarXmlConsultaPorFaixa(numeroInicial, numeroFinal, pagina, cnpjPrestador, inscricaoMunicipal);
  const respostaSoap = await soapService.enviarSoap('ConsultarNfseFaixa', xml);
  return _parsearResposta(respostaSoap);
}

async function consultarNfseServicoPrestado(dataInicial, dataFinal, pagina, cnpjPrestador, inscricaoMunicipal) {
  await _ensureConfig();
  cnpjPrestador = cnpjPrestador || config.prestador.cnpj;
  inscricaoMunicipal = inscricaoMunicipal || config.prestador.inscricaoMunicipal;
  const xml = xmlService.gerarXmlConsultaServicosPrestados(dataInicial, dataFinal, cnpjPrestador, inscricaoMunicipal, pagina);
  const respostaSoap = await soapService.enviarSoap('ConsultarNfseServicoPrestado', xml);
  return _parsearResposta(respostaSoap);
}

async function consultarNfseServicoTomado(cnpjConsulente, dataInicial, dataFinal, pagina, inscricaoMunicipal) {
  await _ensureConfig();
  inscricaoMunicipal = inscricaoMunicipal || config.prestador.inscricaoMunicipal;
  const xml = xmlService.gerarXmlConsultaServicosTomados(cnpjConsulente || config.prestador.cnpj, inscricaoMunicipal, dataInicial, dataFinal, pagina);
  const respostaSoap = await soapService.enviarSoap('ConsultarNfseServicoTomado', xml);
  return _parsearResposta(respostaSoap);
}

async function cancelarNfse(numeroNota, codigoVerificacao, motivo, pfxBuffer, password, autorDocumento) {
  await _ensureConfig();
  const xml = xmlService.gerarXmlCancelamento({
    chNFSe: codigoVerificacao,
    documentoAutor: autorDocumento || config.prestador.cnpj,
    motivo,
  });
  const xmlAssinado = await _assinarXml(xml, _extrairIdXml(xml) || `cancel:${numeroNota}`, pfxBuffer, password);
  const respostaSoap = await soapService.enviarSoap('CancelarNfse', xmlAssinado, pfxBuffer, password);
  const resultado = _parsearResposta(respostaSoap);
  return _anexarXmlAuditoria(resultado, xmlAssinado, respostaSoap, 'cancelamento');
}

async function substituirNfse(numeroNota, codigoVerificacao, novaDps, motivo, pfxBuffer, password) {
  await _ensureConfig();
  const xml = xmlService.gerarXmlSubstituicao(numeroNota, codigoVerificacao, novaDps, config.prestador.cnpj, config.prestador.inscricaoMunicipal, motivo);
  const xmlAssinado = await _assinarXml(xml, _extrairIdXml(xml) || `subst:${numeroNota}`, pfxBuffer, password);
  const respostaSoap = await soapService.enviarSoap('GerarNfse', xmlAssinado, pfxBuffer, password);
  const resultado = _parsearResposta(respostaSoap);
  return _anexarXmlAuditoria(resultado, xmlAssinado, respostaSoap, 'substituicao');
}

async function consultarUrlNfse(numeroNfse, cnpjPrestador, inscricaoMunicipal) {
  await _ensureConfig();
  cnpjPrestador = cnpjPrestador || config.prestador.cnpj;
  inscricaoMunicipal = inscricaoMunicipal || config.prestador.inscricaoMunicipal;
  const xml = xmlService.gerarXmlConsultaUrlNfse(numeroNfse, cnpjPrestador, inscricaoMunicipal);
  const respostaSoap = await soapService.enviarSoap('ConsultarUrlNfse', xml);
  return _parsearResposta(respostaSoap);
}

async function consultarDadosCadastrais(cnpjPrestador, inscricaoMunicipal) {
  await _ensureConfig();
  cnpjPrestador = cnpjPrestador || config.prestador.cnpj;
  inscricaoMunicipal = inscricaoMunicipal || config.prestador.inscricaoMunicipal;
  const xml = xmlService.gerarXmlConsultaDadosCadastrais(cnpjPrestador, inscricaoMunicipal);
  const respostaSoap = await soapService.enviarSoap('ConsultarDadosCadastrais', xml);
  return _parsearResposta(respostaSoap);
}

async function consultarDpsDisponivel(pagina, cnpjPrestador, inscricaoMunicipal) {
  await _ensureConfig();
  cnpjPrestador = cnpjPrestador || config.prestador.cnpj;
  inscricaoMunicipal = inscricaoMunicipal || config.prestador.inscricaoMunicipal;
  const xml = xmlService.gerarXmlConsultaDpsDisponivel(cnpjPrestador, inscricaoMunicipal, pagina);
  const respostaSoap = await soapService.enviarSoap('ConsultarDpsDisponivel', xml);
  return _parsearResposta(respostaSoap);
}

module.exports = {
  gerarNfse,
  enviarLoteDpsSincrono,
  recepcionarLoteDps,
  consultarLoteDps,
  consultarSituacaoLote,
  consultarNfsePorDps,
  consultarNfsePorFaixa,
  consultarNfseServicoPrestado,
  consultarNfseServicoTomado,
  cancelarNfse,
  substituirNfse,
  consultarUrlNfse,
  consultarDadosCadastrais,
  consultarDpsDisponivel,
};
