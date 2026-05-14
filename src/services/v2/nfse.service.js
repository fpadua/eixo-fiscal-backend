const { XMLParser } = require('fast-xml-parser');
const xmlService = require('./xml.service');
const signService = require('../sign.service');
const soapService = require('../soap.service');
const config = require('../../config/nfse.config');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function _parsearResposta(soapXml) {
  try {
    // Verifica se é resposta mock (sem envelope SOAP)
    if (!soapXml.includes('<soap:Envelope') && !soapXml.includes('<soapenv:Envelope') && !soapXml.includes('<Envelope')) {
      // É resposta direta (mock) - parseia diretamente
      try {
        const dados = parser.parse(soapXml);
        return {
          sucesso: true,
          dados: dados,
          xmlResposta: soapXml,
          numeroNota: _extrairNumeroNota(dados),
          codigoVerificacao: _extrairCodigoVerificacao(dados),
          listaNfse: _extrairListaNfse(dados),
        };
      } catch (e) {
        return { sucesso: true, dados: {}, xmlResposta: soapXml };
      }
    }

    const parsed = parser.parse(soapXml);

    const envelope = parsed['soap:Envelope'] || parsed['soapenv:Envelope'] || parsed['Envelope'];
    const body = envelope?.['soap:Body'] || envelope?.['soapenv:Body'] || envelope?.['Body'];

    if (!body) {
      return { sucesso: false, erro: 'Resposta SOAP inválida', xmlResposta: soapXml };
    }

    const fault = body['soap:Fault'] || body['Fault'];
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

    return {
      sucesso: true,
      dados: dadosNota,
      xmlResposta: xmlResp,
      numeroNota: _extrairNumeroNota(dadosNota),
      codigoVerificacao: _extrairCodigoVerificacao(dadosNota),
      listaNfse: _extrairListaNfse(dadosNota),
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
  const xml = xmlService.gerarXmlGerarNfse(dados);

  const idElemento = _extrairIdXml(xml);
  const xmlAssinado = idElemento
    ? await _assinarXml(xml, idElemento, pfxBuffer, password)
    : xml;

  const respostaSoap = await soapService.enviarSoap('GerarNfse', xmlAssinado, pfxBuffer, password);
  console.log(respostaSoap)
  const resultado = _parsearResposta(respostaSoap);

  if (resultado.numeroNota && resultado.codigoVerificacao) {
    resultado.urlImpressao = _montarUrlImpressao(resultado.numeroNota, resultado.codigoVerificacao);
  }

  resultado.xmlEnviado = xmlAssinado;
  resultado.modeMock = config.isMock;
  return resultado;
}

async function enviarLoteDpsSincrono(listaDps, numeroLote, pfxBuffer, password) {
  const xml = xmlService.gerarXmlEnviarLoteDpsSincrono(listaDps, numeroLote);
  const idElemento = _extrairIdXml(xml) || `lote:${numeroLote}`;
  const xmlAssinado = await _assinarXml(xml, idElemento, pfxBuffer, password);
  const respostaSoap = await soapService.enviarSoap('RecepcionarLoteDpsSincrono', xmlAssinado, pfxBuffer, password);
  const resultado = _parsearResposta(respostaSoap);

  if (resultado.listaNfse && resultado.listaNfse.length > 0) {
    const primeira = resultado.listaNfse[0];
    resultado.urlImpressao = _montarUrlImpressao(primeira.Nfse?.InfNfse?.nNFSe, primeira.Nfse?.InfNfse?.CodigoVerificacao);
  }

  resultado.xmlEnviado = xmlAssinado;
  resultado.modeMock = config.isMock;
  return resultado;
}

async function recepcionarLoteDps(listaDps, numeroLote, pfxBuffer, password) {
  const xml = xmlService.gerarXmlRecepcaoLoteDps(listaDps, numeroLote);
  const idElemento = _extrairIdXml(xml) || `lote:${numeroLote}`;
  const xmlAssinado = await _assinarXml(xml, idElemento, pfxBuffer, password);
  const respostaSoap = await soapService.enviarSoap('RecepcionarLoteDps', xmlAssinado, pfxBuffer, password);
  const resultado = _parsearResposta(respostaSoap);

  resultado.xmlEnviado = xmlAssinado;
  resultado.modeMock = config.isMock;
  return resultado;
}

async function consultarLoteDps(protocolo) {
  const xml = xmlService.gerarXmlConsultaLote(protocolo, config.prestador.cnpj, config.prestador.inscricaoMunicipal);
  const respostaSoap = await soapService.enviarSoap('ConsultarLoteDps', xml);
  return _parsearResposta(respostaSoap);
}

async function consultarSituacaoLote(protocolo) {
  const xml = xmlService.gerarXmlConsultaSituacaoLote(protocolo, config.prestador.cnpj, config.prestador.inscricaoMunicipal);
  const respostaSoap = await soapService.enviarSoap('ConsultarSituacaoLoteDps', xml);
  return _parsearResposta(respostaSoap);
}

async function consultarNfsePorDps(numeroDps, serieDps, pfxBuffer, password) {
  const xml = xmlService.gerarXmlConsultaPorDps(numeroDps, serieDps, config.prestador.cnpj, config.prestador.inscricaoMunicipal);
  const idElemento = _extrairIdXml(xml) || `dps:${numeroDps}`;
  const xmlAssinado = await _assinarXml(xml, idElemento, pfxBuffer, password);
  const respostaSoap = await soapService.enviarSoap('ConsultarNfsePorDps', xmlAssinado, pfxBuffer, password);
  return _parsearResposta(respostaSoap);
}

async function consultarNfsePorFaixa(numeroInicial, numeroFinal, pagina) {
  const xml = xmlService.gerarXmlConsultaPorFaixa(numeroInicial, numeroFinal, pagina, config.prestador.cnpj, config.prestador.inscricaoMunicipal);
  const respostaSoap = await soapService.enviarSoap('ConsultarNfseFaixa', xml);
  return _parsearResposta(respostaSoap);
}

async function consultarNfseServicoPrestado(dataInicial, dataFinal, pagina) {
  const xml = xmlService.gerarXmlConsultaServicosPrestados(dataInicial, dataFinal, config.prestador.cnpj, config.prestador.inscricaoMunicipal, pagina);
  const respostaSoap = await soapService.enviarSoap('ConsultarNfseServicoPrestado', xml);
  return _parsearResposta(respostaSoap);
}

async function consultarNfseServicoTomado(cnpjConsulente, dataInicial, dataFinal, pagina) {
  const xml = xmlService.gerarXmlConsultaServicosTomados(cnpjConsulente || config.prestador.cnpj, config.prestador.inscricaoMunicipal, dataInicial, dataFinal, pagina);
  const respostaSoap = await soapService.enviarSoap('ConsultarNfseServicoTomado', xml);
  return _parsearResposta(respostaSoap);
}

async function cancelarNfse(numeroNota, codigoVerificacao, motivo, pfxBuffer, password) {
  const xml = xmlService.gerarXmlCancelamento(numeroNota, codigoVerificacao, config.prestador.cnpj, config.prestador.inscricaoMunicipal, motivo);
  const xmlAssinado = await _assinarXml(xml, `cancel:${numeroNota}`, pfxBuffer, password);
  const respostaSoap = await soapService.enviarSoap('CancelarNfse', xmlAssinado, pfxBuffer, password);
  const resultado = _parsearResposta(respostaSoap);
  resultado.xmlEnviado = xmlAssinado;
  return resultado;
}

async function substituirNfse(numeroNota, codigoVerificacao, novaDps, motivo, pfxBuffer, password) {
  const xml = xmlService.gerarXmlSubstituicao(numeroNota, codigoVerificacao, novaDps, config.prestador.cnpj, config.prestador.inscricaoMunicipal, motivo);
  const xmlAssinado = await _assinarXml(xml, `subst:${numeroNota}`, pfxBuffer, password);
  const respostaSoap = await soapService.enviarSoap('SubstituirNfse', xmlAssinado, pfxBuffer, password);
  const resultado = _parsearResposta(respostaSoap);
  resultado.xmlEnviado = xmlAssinado;
  return resultado;
}

async function consultarUrlNfse(numeroNfse) {
  const xml = xmlService.gerarXmlConsultaUrlNfse(numeroNfse, config.prestador.cnpj, config.prestador.inscricaoMunicipal);
  const respostaSoap = await soapService.enviarSoap('ConsultarUrlNfse', xml);
  return _parsearResposta(respostaSoap);
}

async function consultarDadosCadastrais() {
  const xml = xmlService.gerarXmlConsultaDadosCadastrais(config.prestador.cnpj, config.prestador.inscricaoMunicipal);
  const respostaSoap = await soapService.enviarSoap('ConsultarDadosCadastrais', xml);
  return _parsearResposta(respostaSoap);
}

async function consultarDpsDisponivel(pagina) {
  const xml = xmlService.gerarXmlConsultaDpsDisponivel(config.prestador.cnpj, config.prestador.inscricaoMunicipal, pagina);
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
