/**
 * services/nfse.service.js
 *
 * Camada de serviço responsável por orquestrar:
 *  - Geração dos XMLs (xmlservice)
 *  - Assinatura digital (signservice)
 *  - Envio via SOAP (soapservice)
 *  - Parse estruturado das respostas
 *
 * Alinhado ao manual ABRASF 2.04:
 *  - RecepcionarLoteRps (assíncrono)
 *  - EnviarLoteRpsSincrono
 *  - GerarNfse
 *  - CancelarNfse
 *  - SubstituirNfse
 *  - ConsultarNfseRps
 *  - ConsultarNfseFaixa
 *  - ConsultarLoteRps
 */

const { XMLParser } = require('fast-xml-parser');
const xmlService = require('./xml.service');
const signService = require('./sign.service');
const soapService = require('./soap.service');
const config = require('../config/nfse.config');

// Parser genérico para respostas SOAP
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true,
  removeNSPrefix: true, // remove "ns:" dos nomes das tags
});

/**
 * Emite NFS-e via RECEPCIONAR LOTE (ASSÍNCRONO).
 *
 * Fluxo:
 *  1) Gera EnviarLoteRpsEnvio (xmlService.gerarXmlLoteRps)
 *  2) Assina RPS e Lote (signService.assinarMultiplos)
 *      - Id RPS:   rps:<numeroRps>
 *      - Id Lote:  lote:<numeroLote>
 *  3) Chama método SOAP RecepcionarLoteRps
 *  4) Retorna protocolo do lote e mensagens (se houver)
 *
 * @param {Object} dados - dados da nota
 * @returns {Promise<Object>}
 */
async function emitirNfse(dados, pfxBuffer, password) {
  try {
    console.log('[NFSE] 1. Gerando XML do RPS...');
    const xmlRps = xmlService.gerarXmlRps(dados);

    console.log('[NFSE] 2. Assinando RPS...');
    const idRps = `RPS${dados.rps.numero}`;
    const xmlRpsAssinado = await signService.assinar(xmlRps, idRps, pfxBuffer, password);

    console.log('[NFSE] 3. Montando Lote...');
    const numeroLote = Date.now().toString();
    const loteInfo = {
      numero: numeroLote,
      cnpj: (dados.prestador?.cnpj) || config.prestador.cnpj,
      inscricaoMunicipal: (dados.prestador?.inscricaoMunicipal) || config.prestador.inscricaoMunicipal,
      quantidade: 1
    };

    const xmlLote = xmlService.gerarXmlLoteRps(xmlRpsAssinado, loteInfo);

    console.log('[NFSE] 4. Assinando Lote...');
    const idLote = `Lote${numeroLote}`;
    const xmlLoteAssinado = await signService.assinarLote(xmlLote, idRps, idLote, pfxBuffer, password);

    console.log('[NFSE] 5. Enviando para Prefeitura...');
    const resultado = await soapService.enviarSoap('RecepcionarLoteRps', xmlLoteAssinado, pfxBuffer, password);

    return {
      sucesso: true,
      protocolo: resultado.protocolo || 'N/A',
      xmlRetorno: resultado
    };

  } catch (erro) {
    console.error('[NFSE] Falha crítica na emissão:', erro);
    throw erro;
  }
}

/**
 * Emite NFS-e via ENVIO SÍNCRONO DO LOTE (EnviarLoteRpsSincrono).
 *
 * Fluxo:
 *  1) Gera EnviarLoteRpsSincronoEnvio
 *  2) Assina RPS e Lote
 *  3) Chama RecepcionarLoteRpsSincrono
 *  4) Retorna NFS-e geradas ou ListaMensagemRetorno / ListaMensagemRetornoLote
 *
 * @param {Object} dados - dados da nota
 * @returns {Promise<Object>}
 */
async function emitirNfseLoteSincrono(dados, pfxBuffer, password) {
  const now = String(Date.now());
  const numeroLote = parseInt(now.slice(-15), 10) || 1;

  const xmlLote = xmlService.gerarXmlLoteRpsSincrono(dados, numeroLote);

  const idRps = `RPS${dados.rps.numero}`;
  const idLote = `Lote${numeroLote}`;
  const xmlAssinado = signService.assinarLote(xmlLote, idRps, idLote, pfxBuffer, password);

  const respostaSoap = await soapService.enviarSoap('RecepcionarLoteRpsSincrono', xmlAssinado, pfxBuffer, password);

  const resultado = _parsearResposta(respostaSoap, 'RecepcionarLoteRpsSincrono');

  // Se vierem NFS-e, tenta extrair dados da primeira
  if (resultado.listaNfse && resultado.listaNfse.length > 0) {
    const primeira = resultado.listaNfse[0];
    resultado.numeroNota = primeira.numeroNota || resultado.numeroNota;
    resultado.codigoVerificacao = primeira.codigoVerificacao || resultado.codigoVerificacao;

    if (resultado.numeroNota && resultado.codigoVerificacao) {
      resultado.urlImpressao = _montarUrlImpressao(
        resultado.numeroNota,
        resultado.codigoVerificacao
      );
    }
  }

  resultado.xmlEnviado = xmlAssinado;
  resultado.modeMock = config.isMock;

  return resultado;
}

/**
 * Emite NFS-e via GERAR NFS-e (síncrono simples).
 *
 * Fluxo:
 *  1) Gera GerarNfseEnvio (xmlService.gerarXmlGerarNfse)
 *  2) Assina RPS (InfDeclaracaoPrestacaoServico Id="rps:X")
 *  3) Chama GerarNfse
 *  4) Retorna NFS-e gerada ou ListaMensagemRetorno
 *
 * @param {Object} dados
 * @returns {Promise<Object>}
 */
async function emitirNfseSincrono(dados, pfxBuffer, password) {
  const xmlRps = xmlService.gerarXmlGerarNfse(dados);
  const idRps = `RPS${dados.rps.numero}`;
  const xmlAssinado = signService.assinar(xmlRps, idRps, pfxBuffer, password);

  const respostaSoap = await soapService.enviarSoap('GerarNfse', xmlAssinado, pfxBuffer, password);

  const resultado = _parsearResposta(respostaSoap, 'GerarNfse');

  if (resultado.numeroNota && resultado.codigoVerificacao) {
    resultado.urlImpressao = _montarUrlImpressao(
      resultado.numeroNota,
      resultado.codigoVerificacao
    );
  }

  resultado.xmlEnviado = xmlAssinado;
  resultado.modeMock = config.isMock;

  return resultado;
}

/**
 * Consulta NFS-e por número do RPS (ConsultarNfseRps).
 *
 * @param {Object} params
 * @param {number} params.numeroRps
 * @param {string} [params.serie]
 * @param {number} [params.tipo]
 */
async function consultarPorRps({ numeroRps, serie, tipo }) {
  const xml = xmlService.gerarXmlConsultaPorRps({ numeroRps, serie, tipo });

  // ConsultarNfseRpsEnvio NÃO exige assinatura na especificação,
  // mas alguns municípios aceitam/esperam assinatura; por segurança,
  // podemos assinar ou não. Aqui vamos ASSINAR o elemento IdentificacaoRps
  // usando Id artificial "rps:<numeroRps>" se você incluir esse Id no XML.
  // Como hoje o XML de consulta não tem Id, vamos enviar sem assinatura.
  const resposta = await soapService.enviarSoap('ConsultarNfsePorRps', xml);

  return _parsearResposta(resposta, 'ConsultarNfsePorRps');
}

/**
 * Consulta NFS-e por faixa de números (ConsultarNfseFaixa).
 *
 * @param {Object} params
 * @param {number} params.numeroInicial
 * @param {number} params.numeroFinal
 * @param {number} [params.pagina=1]
 */
async function consultarPorFaixa({ numeroInicial, numeroFinal, pagina }) {
  const xml = xmlService.gerarXmlConsultaPorFaixa({
    numeroInicial,
    numeroFinal,
    pagina,
  });

  const resposta = await soapService.enviarSoap('ConsultarNfsePorFaixa', xml);
  return _parsearResposta(resposta, 'ConsultarNfsePorFaixa');
}

/**
  * Consulta NFS-e por período (ConsultarNfseServicoPrestado).
  * Lista todas as notas emitidas pelo prestador no período.
  *
  * @param {Object} params
  * @param {string} params.dataInicial - Data no formato YYYY-MM-DD
  * @param {string} params.dataFinal - Data no formato YYYY-MM-DD
  * @param {number} [params.pagina=1]
  */
async function consultarServicosPrestados({ dataInicial, dataFinal, pagina }) {
  const xml = xmlService.gerarXmlConsultaServicosPrestados({
    dataInicial,
    dataFinal,
    pagina,
  });
  const resposta = await soapService.enviarSoap('ConsultarNfseServicoPrestado', xml);
  return _parsearResposta(resposta, 'ConsultarNfseServicoPrestado');
}

/**
  * Consulta NFS-e Tomadas (ConsultarNfseServicoTomado).
  * Lista todas as notas emitidas para o tomador no período.
  *
  * @param {Object} params
  * @param {string} params.cnpj - CNPJ do tomador/consulente
  * @param {string} params.dataInicial - Data no formato YYYY-MM-DD
  * @param {string} params.dataFinal - Data no formato YYYY-MM-DD
  * @param {number} [params.pagina=1]
  */
async function consultarServicosTomados({ cnpj, dataInicial, dataFinal, pagina }) {
  const xml = xmlService.gerarXmlConsultaServicosTomados({
    cnpj,
    dataInicial,
    dataFinal,
    pagina,
  });
  const resposta = await soapService.enviarSoap('ConsultarNfseServicoTomado', xml);
  return _parsearResposta(resposta, 'ConsultarNfseServicoTomado');
}

/**
 * Consulta de dados cadastrais / autorização para emissão (quando disponível no provedor v1).
 *
 * @param {Object} params
 * @param {string} [params.documento] - CPF/CNPJ para consulta; fallback para prestador configurado
 * @param {string} [params.inscricaoMunicipal] - IM opcional; fallback para prestador configurado
 */
async function consultarDadosCadastrais({ documento, inscricaoMunicipal } = {}) {
  const docLimpo = String(documento || config.prestador.cnpj || '').replace(/\D/g, '');
  const im = inscricaoMunicipal || config.prestador.inscricaoMunicipal;

  const cpfTag = docLimpo.length === 11 ? `<Cpf>${docLimpo}</Cpf>` : '';
  const cnpjTag = docLimpo.length === 14 ? `<Cnpj>${docLimpo}</Cnpj>` : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <ConsultarDadosCadastraisEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">
    <Prestador>
      <CpfCnpj>${cpfTag}${cnpjTag}</CpfCnpj>
      ${im ? `<InscricaoMunicipal>${im}</InscricaoMunicipal>` : ''}
    </Prestador>
  </ConsultarDadosCadastraisEnvio>`;

  const resposta = await soapService.enviarSoap('ConsultarDadosCadastrais', xml);
  return _parsearResposta(resposta, 'ConsultarDadosCadastrais');
}

/**
 * Consulta LOTE de RPS (ConsultarLoteRps) — retorna NFS-e do lote ou erros.
 *
 * @param {Object} params
 * @param {string} params.protocolo
 */
async function consultarLoteRps({ protocolo }) {
  const xml = xmlService.gerarXmlConsultarLoteRps({ protocolo });

  const resposta = await soapService.enviarSoap('ConsultarLoteRps', xml);

  return _parsearResposta(resposta, 'ConsultarLoteRps');
}

/**
 * Consulta SITUAÇÃO do lote (ConsultarSituacaoLoteRps).
 * (Este método não é padronizado no manual ABRASF 2.04, mas é comum em
 *  implementações municipais. Se Goiânia disponibilizar, funcionará aqui.)
 *
 * @param {Object} params
 * @param {string} params.protocolo
 * @param {string} [params.cnpj]
 */
async function consultarSituacaoLote({ protocolo, cnpj }) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <ConsultarSituacaoLoteRpsEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">
    <Prestador>
      <CpfCnpj><Cnpj>${cnpj || config.prestador.cnpj}</Cnpj></CpfCnpj>
      <InscricaoMunicipal>${config.prestador.inscricaoMunicipal}</InscricaoMunicipal>
    </Prestador>
    <Protocolo>${protocolo}</Protocolo>
  </ConsultarSituacaoLoteRpsEnvio>`;

  const resposta = await soapService.enviarSoap('ConsultarSituacaoLoteRps', xml);
  return _parsearResposta(resposta, 'ConsultarSituacaoLoteRps');
}

/**
 * Cancela NFS-e (CancelarNfse).
 *
 * Fluxo:
 *  1) Gera CancelarNfseEnvio (xmlService.gerarXmlCancelamento)
 *  2) Assina InfPedidoCancelamento (Id="cancel:<numeroNota>")
 *  3) Envia para método CancelarNfse
 *
 * @param {Object} params
 * @param {number} params.numeroNota
 * @param {string} params.codigoVerificacao
 * @param {number} [params.motivoCancelamento]
 */
async function cancelarNfse({ numeroNota, codigoVerificacao, motivoCancelamento }) {
  const xml = xmlService.gerarXmlCancelamento({
    numeroNota,
    codigoVerificacao,
    motivoCancelamento,
  });

  const idCancel = `cancel:${numeroNota}`;
  const xmlAssinado = signService.assinar(xml, idCancel);

  const resposta = await soapService.enviarSoap('CancelarNfse', xmlAssinado);

  const resultado = _parsearResposta(resposta, 'CancelarNfse');
  resultado.xmlEnviado = xmlAssinado;
  resultado.modeMock = config.isMock;

  return resultado;
}

/**
 * Substitui NFS-e (SubstituirNfse).
 *
 * Fluxo:
 *  1) Gera SubstituirNfseEnvio (xmlService.gerarXmlSubstituicao)
 *  2) Assina:
 *      - InfPedidoCancelamento (Id="cancel:<numeroNotaSubstituida>")
 *      - InfDeclaracaoPrestacaoServico da nova NFS-e (Id="rps:<numeroRps>")
 *      - opcionalmente o elemento SubstituicaoNfse (Id="subst:<numeroNotaSubstituida>")
 *  3) Envia para método SubstituirNfse
 *
 * @param {Object} params
 * @param {number} params.numeroNotaSubstituida
 * @param {string} params.codigoVerificacao
 * @param {number} [params.motivoCancelamento]
 * @param {Object} params.dadosNovaNota
 */
async function substituirNfse({
  numeroNotaSubstituida,
  codigoVerificacao,
  motivoCancelamento,
  dadosNovaNota,
}) {
  const xml = xmlService.gerarXmlSubstituicao({
    numeroNotaSubstituida,
    codigoVerificacao,
    motivoCancelamento,
    dadosNovaNota,
  });

  const ids = [
    `cancel:${numeroNotaSubstituida}`,
    `RPS${dadosNovaNota.rps.numero}`,
    `subst:${numeroNotaSubstituida}`,
  ];

  const xmlAssinado = signService.assinarMultiplos(xml, ids);

  const resposta = await soapService.enviarSoap('SubstituirNfse', xmlAssinado);

  const resultado = _parsearResposta(resposta, 'SubstituirNfse');
  resultado.xmlEnviado = xmlAssinado;
  resultado.modeMock = config.isMock;

  return resultado;
}


/* ────────────────────────────────────────────────────────────────────────── */
/* PARSE DAS RESPOSTAS SOAP                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Parser genérico de resposta SOAP:
 *  - Detecta Fault
 *  - Localiza o nó de resposta correspondente ao serviço
 *  - Extrai:
 *      - ListaNfse → array de NFS-e (numero, codigoVerificacao, xml bruto)
 *      - ListaMensagemRetorno, ListaMensagemRetornoLote, ListaMensagemAlertaRetorno
 *      - NumeroLote, Protocolo, Situacao (quando existirem)
 *
 * @param {string} soapXml
 * @param {string} operacao - nome da operação chamada (para ajudar a achar o nó)
 * @returns {Object}
 */
function _parsearResposta(soapXml, operacao) {
  try {
    if (!soapXml || typeof soapXml !== 'string') {
      return { sucesso: false, erro: 'Resposta SOAP vazia ou inválida', xmlResposta: soapXml };
    }

    const trimmed = soapXml.trim();
    if (!trimmed.startsWith('<')) {
      return { sucesso: false, erro: 'Resposta não é XML', xmlResposta: soapXml };
    }

    const parsed = parser.parse(soapXml);

    // Envelope SOAP (com ou sem prefixo)
    const envelope =
      parsed.Envelope ||
      parsed['soap:Envelope'] ||
      parsed['soapenv:Envelope'] ||
      parsed;

    let body =
      envelope.Body ||
      envelope['soap:Body'] ||
      envelope['soapenv:Body'] ||
      envelope;

    // Fault?
    const fault = body.Fault || body['soap:Fault'] || body['soapenv:Fault'];
    if (fault) {
      const erroMsg =
        fault.faultstring ||
        fault.faultcode ||
        fault.reason ||
        JSON.stringify(fault);
      return {
        sucesso: false,
        erro: `SOAP Fault: ${erroMsg}`,
        xmlResposta: soapXml,
      };
    }

    // Encontra nó principal de resposta pelo nome da operação
    // Ex: GerarNfse -> GerarNfseResposta
    const respTagName = _obterNomeResposta(operacao);
    let dadosResposta = body[respTagName];

    // Algumas implementações podem não usar exatamente o mesmo nome;
    // se não encontrar, cai para o primeiro nó do body.
    if (!dadosResposta) {
      const bodyKeys = Object.keys(body);
      if (bodyKeys.length === 1) {
        dadosResposta = body[bodyKeys[0]];
      } else {
        dadosResposta = body;
      }
    }

    // Extrai listas de mensagens (erros/alertas)
    const mensagensRetorno = _extrairListaMensagemRetorno(dadosResposta).map(m => ({
      Codigo: _toText(m.Codigo),
      Mensagem: _toText(m.Mensagem),
      Correcao: _toText(m.Correcao),
    }));

    const mensagensRetornoLote = _extrairListaMensagemRetornoLote(dadosResposta).map(m => ({
      Codigo: _toText(m.Codigo),
      Mensagem: _toText(m.Mensagem),
      Correcao: _toText(m.Correcao),
    }));

    const mensagensAlerta = _extrairListaMensagemAlerta(dadosResposta).map(m => ({
      Codigo: _toText(m.Codigo),
      Mensagem: _toText(m.Mensagem),
      Correcao: _toText(m.Correcao),
    }));

    // Extrai dados de lote, quando existirem
    const numeroLote = dadosResposta.NumeroLote || null;
    const protocolo = dadosResposta.Protocolo || null;
    const situacao = dadosResposta.Situacao || null;

    // Extrai lista de NFS-e, se houver
    const listaNfse = _extrairListaNfse(dadosResposta);

    // Extrai número/código verificação de forma direta (primeira NFS-e)
    let numeroNota = null;
    let codigoVerificacao = null;
    if (listaNfse.length > 0) {
      numeroNota = listaNfse[0].numeroNota;
      codigoVerificacao = listaNfse[0].codigoVerificacao;
    } else {
      numeroNota = _extrairNumeroNota(dadosResposta);
      codigoVerificacao = _extrairCodigoVerificacao(dadosResposta);
    }

    // Se houver mensagens de erro, considera sucesso=false
    const hasErro =
      (mensagensRetorno && mensagensRetorno.length > 0) ||
      (mensagensRetornoLote && mensagensRetornoLote.length > 0);

    return {
      sucesso: !hasErro,
      xmlResposta: soapXml,
      dados: dadosResposta,

      numeroLote,
      protocolo,
      situacao,

      numeroNota,
      codigoVerificacao,

      listaNfse,
      mensagensRetorno,
      mensagensRetornoLote,
      mensagensAlerta,
    };
  } catch (err) {
    return {
      sucesso: false,
      erro: `Erro ao parsear resposta: ${err.message}`,
      xmlResposta: soapXml,
    };
  }
}

/**
 * Retorna o nome esperado do nó de resposta para a operação.
 *
 * @param {string} operacao
 * @returns {string}
 */
function _obterNomeResposta(operacao) {
  switch (operacao) {
    case 'RecepcionarLoteRps':
      return 'EnviarLoteRpsResposta';
    case 'RecepcionarLoteRpsSincrono':
      return 'EnviarLoteRpsSincronoResposta';
    case 'GerarNfse':
      return 'GerarNfseResposta';
    case 'CancelarNfse':
      return 'CancelarNfseResposta';
    case 'SubstituirNfse':
      return 'SubstituirNfseResposta';
    case 'ConsultarNfsePorRps':
    case 'ConsultarNfseRps':
      return 'ConsultarNfseRpsResposta';
    case 'ConsultarNfsePorFaixa':
    case 'ConsultarNfseFaixa':
      return 'ConsultarNfseFaixaResposta';
    case 'ConsultarLoteRps':
      return 'ConsultarLoteRpsResposta';
    case 'ConsultarSituacaoLoteRps':
      return 'ConsultarSituacaoLoteRpsResposta';
    case 'ConsultarDadosCadastrais':
      return 'ConsultarDadosCadastraisResposta';
    default:
      // fallback genérico: <Operacao>Resposta
      return `${operacao}Resposta`;
  }
}

/**
 * Extrai ListaNfse e retorna array simplificado:
 *  [{ numeroNota, codigoVerificacao, compNfse }]
 *
 * @param {Object} dadosResposta
 * @returns {Array<{numeroNota:string,codigoVerificacao:string,compNfse:any}>}
 */
function _extrairListaNfse(dadosResposta) {
  const lista = [];

  if (!dadosResposta) return lista;

  // Caso padrão:
  //   ListaNfse -> CompNfse[] ou CompNfse único
  const listaNfseNode =
    dadosResposta.ListaNfse ||
    dadosResposta.listaNfse ||
    null;

  if (!listaNfseNode) return lista;

  const comp = listaNfseNode.CompNfse || listaNfseNode.compNfse;
  if (!comp) return lista;

  const arr = Array.isArray(comp) ? comp : [comp];

  for (const c of arr) {
    const nfse = c.Nfse || c.nfse || {};
    const inf = nfse.InfNfse || nfse.infNfse || {};

    lista.push({
      numeroNota: inf.Numero || inf.numero || null,
      codigoVerificacao: inf.CodigoVerificacao || inf.codigoVerificacao || null,
      compNfse: c,
    });
  }

  return lista;
}

/**
 * Extrai ListaMensagemRetorno (erros gerais).
 */
function _extrairListaMensagemRetorno(dadosResposta) {
  const lista =
    dadosResposta.ListaMensagemRetorno ||
    dadosResposta.listaMensagemRetorno ||
    null;
  if (!lista) return [];

  const msgs = lista.MensagemRetorno || lista.mensagemRetorno;
  if (!msgs) return [];

  return Array.isArray(msgs) ? msgs : [msgs];
}

/**
 * Extrai ListaMensagemRetornoLote (erros por RPS no lote).
 */
function _extrairListaMensagemRetornoLote(dadosResposta) {
  const lista =
    dadosResposta.ListaMensagemRetornoLote ||
    dadosResposta.listaMensagemRetornoLote ||
    null;
  if (!lista) return [];

  const msgs = lista.MensagemRetorno || lista.mensagemRetorno;
  if (!msgs) return [];

  return Array.isArray(msgs) ? msgs : [msgs];
}

/**
 * Extrai ListaMensagemAlertaRetorno (avisos).
 */
function _extrairListaMensagemAlerta(dadosResposta) {
  const lista =
    dadosResposta.ListaMensagemAlertaRetorno ||
    dadosResposta.listaMensagemAlertaRetorno ||
    null;
  if (!lista) return [];

  const msgs = lista.MensagemRetorno || lista.mensagemRetorno;
  if (!msgs) return [];

  return Array.isArray(msgs) ? msgs : [msgs];
}

/**
 * Fallback antigo: tenta achar número da nota em vários caminhos possíveis.
 *
 * @param {Object} dados
 */
function _extrairNumeroNota(dados) {
  try {
    return (
      dados?.GerarNfseResposta?.ListaNfse?.CompNfse?.Nfse?.InfNfse?.Numero ||
      dados?.ListaNfse?.CompNfse?.Nfse?.InfNfse?.Numero ||
      dados?.Nfse?.InfNfse?.Numero ||
      dados?.Numero ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Fallback antigo: tenta achar Código de Verificação em vários caminhos possíveis.
 *
 * @param {Object} dados
 */
function _extrairCodigoVerificacao(dados) {
  try {
    return (
      dados?.GerarNfseResposta?.ListaNfse?.CompNfse?.Nfse?.InfNfse?.CodigoVerificacao ||
      dados?.ListaNfse?.CompNfse?.Nfse?.InfNfse?.CodigoVerificacao ||
      dados?.Nfse?.InfNfse?.CodigoVerificacao ||
      dados?.CodigoVerificacao ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Monta URL de impressão específica de Goiânia.
 *
 * @param {string|number} numeroNota
 * @param {string} codigoVerificacao
 */
function _montarUrlImpressao(numeroNota, codigoVerificacao) {
  return `https://www2.goiania.go.gov.br/sistemas/snfse/asp/snfse00200w0.asp?inscricao=${config.prestador.inscricaoMunicipal}&nota=${numeroNota}&verificador=${codigoVerificacao}`;
}

const _toText = v => Array.isArray(v) ? v[0] : (v ?? null);

module.exports = {
  emitirNfse,              // Lote assíncrono (RecepcionarLoteRps)
  emitirNfseLoteSincrono,  // EnviarLoteRpsSincrono
  emitirNfseSincrono,      // GerarNfse
  consultarPorRps,         // ConsultarNfseRps
  consultarPorFaixa,       // ConsultarNfseFaixa
  consultarLoteRps,        // ConsultarLoteRps
  consultarSituacaoLote,  // ConsultarSituacaoLoteRps (se a prefeitura tiver)
  consultarServicosPrestados, // ConsultarNfseServicoPrestado
  consultarServicosTomados,   // ConsultarNfseServicoTomado
  consultarDadosCadastrais,   // ConsultarDadosCadastrais
  cancelarNfse,            // CancelarNfse
  substituirNfse,          // SubstituirNfse
};
