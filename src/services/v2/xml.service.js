const { XMLBuilder } = require('fast-xml-parser');
const { getConfig } = require('../../config');
const taxTables = require('./tax-tables.service');

let config = null;
const _cfgReady = (async () => {
  config = await getConfig('default-tenant-id');
})();

async function _ensureConfig() {
  if (!config) await _cfgReady;
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
});

/** XML compacto (sem indentação) exigido para assinatura da DPS — manual NFS-e Nacional */
const builderCompact = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: false,
  suppressEmptyNode: true,
});

const NS_NFSE = 'http://www.sped.fazenda.gov.br/nfse';
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
const VERSAO_SCHEMA_NACIONAL = '1.01';
const CODIGO_MUNICIPIO_EXEMPLO = '5208707';
/** Campo Grande/MS — local de emissão em homologação (orientação prefeitura) */
const CODIGO_MUNICIPIO_HOMOLOGACAO = '5002704';
const SERIE_DPS_SUPORTE = '1';
const CNPJ_EXEMPLO = '43983294000121';

const PRESTADOR_HOMOLOGACAO = {
  cnpj: CNPJ_EXEMPLO,
  inscricaoMunicipal: '123456',
  razaoSocial: 'Prestador Exemplo NFSe',
  endereco: {
    logradouro: 'Rua Exemplo',
    numero: '1000',
    complemento: 'Sala 01',
    bairro: 'Centro',
    codigoMunicipio: CODIGO_MUNICIPIO_EXEMPLO,
    cep: '74000000',
  },
  fone: '6233334444',
  email: 'homologacao@example.com',
};

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function withoutEmptyValues(obj = {}) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => nonEmpty(value) !== undefined)
  );
}

function formatDecimal(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : Number(fallback).toFixed(2);
}

function sanitizeFixedDigits(value, length, fallback) {
  const digits = onlyDigits(value || fallback);
  return digits.padStart(length, '0').slice(-length);
}

function sanitizeMaxDigits(value, maxLength, fallback) {
  const digits = onlyDigits(value || fallback);
  return digits.slice(0, maxLength) || fallback;
}

function isValidCnpj(value) {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;

  const calc = (base) => {
    const weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    const sum = base
      .split('')
      .reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return calc(cnpj.slice(0, 12)) === Number(cnpj[12])
    && calc(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

function getTpAmb(dados = {}) {
  return String(dados.tpAmb || config?.tpAmb || 2);
}

function isAmbienteHomologacao(dados = {}) {
  return getTpAmb(dados) === '2' || Boolean(config?.homologacao);
}

function getCodigoMunicipio(dados = {}) {
  return onlyDigits(
    dados.prestador?.endereco?.codigoMunicipio
      || dados.prestador?.endereco?.cMun
      || dados.codigoMunicipioPrestador
      || dados.codigoMunicipio
      || config?.codigoMunicipioNacional
      || config?.codigoMunicipioGoiania
  );
}

/**
 * Código IBGE da localidade emissora (cLocEmi e Id da DPS).
 * Em homologação usa Campo Grande/MS conforme orientação da prefeitura.
 */
function getCodigoMunicipioEmissao(dados = {}) {
  if (isAmbienteHomologacao(dados)) {
    return onlyDigits(
      dados.codigoMunicipioEmissao
        || dados.cLocEmi
        || config?.codigoMunicipioHomologacao
        || CODIGO_MUNICIPIO_HOMOLOGACAO
    );
  }

  return onlyDigits(
    dados.cLocEmi
      || dados.codigoMunicipioEmissao
      || getCodigoMunicipio(dados)
  );
}

function getCodigoMunicipioPrestacao(dados = {}, codigoMunicipioEmissao) {
  const informado = onlyDigits(
    dados.servico?.cMunIncid
      || dados.servico?.cLocPrestacao
      || dados.cLocPrestacao
      || dados.codigoMunicipioIncidencia
      || dados.servico?.municipioIncidencia
  );
  if (informado) return informado;
  return codigoMunicipioEmissao || CODIGO_MUNICIPIO_EXEMPLO;
}

function getSerieDps(dados = {}) {
  const digits = onlyDigits(dados.serieDps || dados.rps?.serie || SERIE_DPS_SUPORTE);
  const serie = String(Number.parseInt(digits || SERIE_DPS_SUPORTE, 10));
  return serie === '0' || serie === 'NaN' ? SERIE_DPS_SUPORTE : serie.slice(0, 5);
}

function getNumeroDps(dados = {}) {
  const raw = onlyDigits(dados.numeroDps || dados.rps?.numero);
  const parsed = Number.parseInt(raw || '0', 10);
  if (Number.isFinite(parsed) && parsed > 0) return String(parsed).slice(0, 15);

  const timestamp = Date.now().toString();
  return String(Number.parseInt(timestamp.slice(-12), 10)).slice(0, 15);
}

function formatarDhEmi(value) {
  if (typeof value === 'string') {
    const normalized = value.replace(/\.\d{3}/, '');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:00$/.test(normalized)) {
      return normalized;
    }
  }

  const date = value ? new Date(value) : new Date();
  const source = Number.isNaN(date.getTime()) ? new Date() : date;
  const brt = new Date(source.getTime() - (3 * 60 * 60 * 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${brt.getUTCFullYear()}-${pad(brt.getUTCMonth() + 1)}-${pad(brt.getUTCDate())}`
    + `T${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())}:${pad(brt.getUTCSeconds())}-03:00`;
}

function formatarData(value) {
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  const date = value ? new Date(value) : new Date();
  const source = Number.isNaN(date.getTime()) ? new Date() : date;
  return source.toISOString().slice(0, 10);
}

function formatarPagina(value) {
  const pagina = onlyDigits(value || 1) || '1';
  return pagina.padStart(7, '0').slice(-7);
}

function resolvePrestador(dados = {}) {
  const informado = dados.prestador || {};
  const configPrestador = config.prestador || {};
  const documentoInformado = onlyDigits(informado.cnpj || informado.cpf);
  const documentoConfig = onlyDigits(configPrestador.cnpj || configPrestador.cpf);
  const inscricaoMunicipalInformada = nonEmpty(informado.inscricaoMunicipal || informado.IM);
  const inscricaoMunicipalConfig = nonEmpty(configPrestador.inscricaoMunicipal || configPrestador.IM);
  const usarExemplo = Boolean(dados.usarPrestadorExemplo || config.isMock);
  const temPrestadorExplicito = Boolean(
    documentoInformado
      || documentoConfig
      || inscricaoMunicipalInformada
      || inscricaoMunicipalConfig
  );
  const baseExemplo = usarExemplo && !temPrestadorExplicito ? PRESTADOR_HOMOLOGACAO : { endereco: {} };
  const base = {
    ...baseExemplo,
    ...withoutEmptyValues(configPrestador),
    ...withoutEmptyValues(informado),
    endereco: {
      ...baseExemplo.endereco,
      ...withoutEmptyValues(configPrestador.endereco),
      ...withoutEmptyValues(informado.endereco),
    },
  };

  let documento = documentoInformado || documentoConfig;
  if (usarExemplo && !temPrestadorExplicito) {
    documento = PRESTADOR_HOMOLOGACAO.cnpj;
  }

  if (documento.length !== 14 && documento.length !== 11) {
    throw new Error('Prestador v2 deve ter CNPJ ou CPF valido para gerar a DPS nacional.');
  }

  if (documento.length === 14 && !isValidCnpj(documento)) {
    throw new Error('CNPJ do prestador invalido para gerar a DPS nacional.');
  }

  const inscricaoMunicipal = nonEmpty(
    inscricaoMunicipalInformada
      || inscricaoMunicipalConfig
      || (usarExemplo && !temPrestadorExplicito ? PRESTADOR_HOMOLOGACAO.inscricaoMunicipal : undefined)
  );
  if (!inscricaoMunicipal) {
    throw new Error('Inscricao municipal do prestador e obrigatoria para a DPS nacional.');
  }

  return {
    documento,
    tipoInscricaoFederal: documento.length === 14 ? '2' : '1',
    inscricaoMunicipal: String(inscricaoMunicipal).slice(0, 15),
    razaoSocial: nonEmpty(base.razaoSocial || base.xNome),
    endereco: base.endereco,
    fone: onlyDigits(base.fone || base.telefone),
    email: nonEmpty(base.email),
  };
}

function montarEndereco(endereco = {}, codigoMunicipio, options = {}) {
  const logradouro = nonEmpty(endereco.logradouro || endereco.xLgr);
  const numero = nonEmpty(endereco.numero || endereco.nro);
  const bairro = nonEmpty(endereco.bairro || endereco.xBairro);
  const cep = onlyDigits(endereco.cep || endereco.CEP);
  const municipio = onlyDigits(
    endereco.codigoMunicipio
      || endereco.cMun
      || (options.usarFallbackMunicipio ? codigoMunicipio : '')
  );

  if (!logradouro || !numero || !bairro || !cep || !municipio) return null;

  const end = {
    endNac: {
      cMun: municipio,
      CEP: cep.padStart(8, '0').slice(-8),
    },
    xLgr: logradouro,
    nro: numero,
  };

  const complemento = nonEmpty(endereco.complemento || endereco.xCpl);
  if (complemento) end.xCpl = complemento;
  end.xBairro = bairro;

  return end;
}

function montarPessoaTomador(tomador = {}, codigoMunicipio) {
  const documento = onlyDigits(tomador.cnpj || tomador.cpf || tomador.documento);
  if (!documento) return null;

  const pessoa = {};
  if (documento.length === 14) pessoa.CNPJ = documento;
  else if (documento.length === 11) pessoa.CPF = documento;
  else return null;

  const inscricaoMunicipal = nonEmpty(tomador.IM || tomador.inscricaoMunicipal);
  if (inscricaoMunicipal) pessoa.IM = String(inscricaoMunicipal).slice(0, 15);

  pessoa.xNome = nonEmpty(tomador.razaoSocial || tomador.xNome || 'Tomador Homologacao');

  const endereco = montarEndereco(tomador.endereco, codigoMunicipio, { usarFallbackMunicipio: false });
  if (endereco) pessoa.end = endereco;

  const fone = onlyDigits(tomador.fone || tomador.telefone || tomador.contato?.telefone);
  if (fone) pessoa.fone = fone;

  const email = nonEmpty(tomador.email || tomador.contato?.email);
  if (email) pessoa.email = email;

  return pessoa;
}

function montarPrestador(prestador, codigoMunicipio) {
  const xml = prestador.documento.length === 14
    ? { CNPJ: prestador.documento }
    : { CPF: prestador.documento };

  xml.IM = prestador.inscricaoMunicipal;
  if (prestador.razaoSocial) xml.xNome = prestador.razaoSocial;

  const endereco = montarEndereco(prestador.endereco, codigoMunicipio, { usarFallbackMunicipio: true });
  if (endereco) xml.end = endereco;

  if (prestador.fone) xml.fone = prestador.fone;
  if (prestador.email) xml.email = prestador.email;

  const opSimpNac = nonEmpty(prestador.opSimpNac || prestador.optanteSimplesNacional) || 1;
  xml.regTrib = {
    opSimpNac: String(opSimpNac),
  };

  if (String(opSimpNac) === '3') {
    xml.regTrib.regApTribSN = String(nonEmpty(prestador.regApTribSN || prestador.regimeApuracao) || 1);
  }

  xml.regTrib.regEspTrib = String(nonEmpty(prestador.regEspTrib) || nonEmpty(prestador.regimeEspecialTributacao) || 0);

  return xml;
}

function normalizarCTribNac(dados = {}) {
  return taxTables.normalizeCTribNac(dados.servico?.cTribNac || dados.cTribNac || dados.itemListaServico);
}

function normalizarCTribMun(dados = {}) {
  return taxTables.normalizeCTribMun(
    dados.servico?.cTribMun
      || dados.servico?.codigoTributacao
      || dados.cTribMun
      || dados.codigoTributacao
  );
}

function extrairFiscalServico(dados = {}) {
  const origem = typeof dados.IBSCBS === 'object'
    ? dados.IBSCBS
    : (typeof dados.ibsCBS === 'object' ? dados.ibsCBS : {});
  const gIBSCBS = origem.valores?.trib?.gIBSCBS || origem.trib?.gIBSCBS || origem.gIBSCBS || {};

  const fiscal = {
    cTribNac: normalizarCTribNac(dados),
    cTribMun: normalizarCTribMun(dados),
    cNBS: taxTables.normalizeCNBS(origem.cNBS || dados.servico?.cNBS || dados.cNBS),
    cIndOp: taxTables.normalizeCIndOp(origem.cIndOp ?? dados.cIndOp),
    CST: taxTables.normalizeCST(gIBSCBS.CST ?? origem.CST ?? dados.CST),
    cClassTrib: taxTables.normalizeCClassTrib(gIBSCBS.cClassTrib ?? origem.cClassTrib ?? dados.cClassTrib),
    finNFSe: String(origem.finNFSe ?? dados.finNFSe ?? 0),
    indDest: String(origem.indDest ?? dados.indDest ?? 0),
  };

  fiscal.correlacao = taxTables.findCorrelacao(fiscal);
  return fiscal;
}

function montarIbsCbs(dados = {}, fiscal = extrairFiscalServico(dados)) {
  return {
    finNFSe: fiscal.finNFSe,
    cIndOp: fiscal.cIndOp,
    indDest: fiscal.indDest,
    valores: {
      trib: {
        gIBSCBS: {
          CST: fiscal.CST,
          cClassTrib: fiscal.cClassTrib,
        },
      },
    },
  };
}

const CINDOP_EXIGE_TOMADOR_ENDERECO = new Set([
  '030102', '050102', '100101', '100301', '100501',
  '030103', '050103', '100102', '100201', '100302',
  '100401', '100502', '100601',
]);

function criarMensagemValidacao(codigo, mensagem, correcao) {
  return { Codigo: codigo, Mensagem: mensagem, Correcao: correcao };
}

function criarErroValidacao(mensagens) {
  const error = new Error('DPS v2 invalida. Revise os campos obrigatorios antes do envio.');
  error.code = 'VALIDACAO_DPS_V2';
  error.mensagensRetorno = mensagens;
  const mapCodigoParaCampo = {
    E0322: ['cNBS'],
    E0901: ['cIndOp'],
    E0017: ['cClassTrib'],
    'V2-CST': ['CST'],
    'V2-TOMADOR': ['cnpjCpfTomador'],
    E056: ['logradouroTomador'],
    E0237: ['numeroTomador', 'bairroTomador', 'cepTomador', 'codigoMunicipioTomador'],
  };
  const missing = new Set();
  (mensagens || []).forEach((msg) => {
    const campos = mapCodigoParaCampo[msg?.Codigo];
    if (Array.isArray(campos)) campos.forEach((campo) => missing.add(campo));
  });
  error.missingFields = Array.from(missing);
  return error;
}

function getDocumentoTomador(tomador = {}) {
  return onlyDigits(tomador.cnpj || tomador.cpf || tomador.documento);
}

function hasRetencaoFederal(dados = {}) {
  return Number(dados.tribFed?.vRetCP) > 0
    || Number(dados.tribFed?.vRetIRRF) > 0
    || Number(dados.tribFed?.vRetCSLL) > 0;
}

function validarDpsNegocio(dados = {}, contexto = {}) {
  const mensagens = [];
  const {
    prestador,
    codigoMunicipio,
    codigoMunicipioEmissao,
    codigoMunicipioPrestacao,
    fiscal,
    homologacao,
  } = contexto;
  const add = (codigo, mensagem, correcao) => mensagens.push(criarMensagemValidacao(codigo, mensagem, correcao));

  if (!codigoMunicipioEmissao || codigoMunicipioEmissao.length !== 7) {
    add('V2-LOC-EMI', 'Codigo da localidade emissora nao informado ou invalido.', 'Preencha o codigo IBGE de 7 digitos no cadastro da empresa/prestador.');
  }

  const municipioPrestador = onlyDigits(prestador?.endereco?.codigoMunicipio || prestador?.endereco?.cMun);
  if (
    !homologacao
    && municipioPrestador
    && codigoMunicipioEmissao
    && municipioPrestador !== codigoMunicipioEmissao
  ) {
    add('V2-ID-DPS', 'Municipio usado no Id/cLocEmi difere do municipio do endereco do prestador.', 'Use o mesmo codigo IBGE do endereco do emitente para formar o Id da DPS e preencher cLocEmi.');
  }

  if (!prestador?.documento || !['11', '14'].includes(String(prestador.documento.length))) {
    add('V2-PREST-DOC', 'Documento federal do prestador ausente ou invalido.', 'Preencha CPF ou CNPJ valido no cadastro da empresa.');
  }

  if (!prestador?.inscricaoMunicipal) {
    add('V2-PREST-IM', 'Inscricao municipal do prestador nao informada.', 'Preencha a inscricao municipal da empresa.');
  }

  if (!codigoMunicipioPrestacao || codigoMunicipioPrestacao.length !== 7) {
    add('V2-LOC-PREST', 'Codigo do local de prestacao nao informado ou invalido.', 'Informe o codigo IBGE de 7 digitos do local da prestacao.');
  }

  if (
    !homologacao
    && codigoMunicipioEmissao
    && codigoMunicipioPrestacao
    && codigoMunicipioPrestacao !== codigoMunicipioEmissao
    && !dados.permitirPrestacaoForaMunicipio
  ) {
    add(
      'L111',
      'Local de prestacao informado difere do municipio emissor da DPS.',
      'Use o codigo IBGE do municipio do prestador (localidade emissora) ou atualize o cadastro na Prefeitura para emitir fora do municipio.'
    );
  }

  if (!fiscal.cTribNac || !taxTables.findTributacaoNacional(fiscal.cTribNac)) {
    add('E0310', 'Codigo de tributacao nacional inexistente ou nao informado.', 'Selecione um cTribNac da tabela TributacaoNacional.xlsx.');
  }

  if (!fiscal.cTribMun) {
    add('E0314', 'Codigo de tributacao municipal nao informado.', 'Informe o codigo municipal administrado pelo municipio de incidencia do ISSQN.');
  }

  if (!fiscal.cNBS || !taxTables.findNBS(fiscal.cNBS)) {
    add('E0322', 'NBS obrigatoria/invalida para a declaracao de IBS/CBS.', 'Selecione uma correlacao que preencha cNBS, cClassTrib, CST e cIndOp.');
  }

  if (!fiscal.cIndOp || !taxTables.findIndOp(fiscal.cIndOp)) {
    add('E0901', 'Codigo indicador da operacao inexistente ou nao informado.', 'Selecione uma correlacao fiscal valida para o servico informado.');
  }

  if (!fiscal.cClassTrib || !taxTables.findCClassTrib(fiscal.cClassTrib)) {
    add('E0017', 'cClassTrib inexistente ou nao informado.', 'Selecione uma classificacao IBS/CBS publicada para prestacao de servicos.');
  }

  if (!fiscal.CST) {
    add('V2-CST', 'CST IBS/CBS nao informado.', 'Selecione uma correlacao fiscal valida.');
  }

  if (fiscal.cTribNac && fiscal.cNBS && fiscal.cClassTrib && fiscal.CST && fiscal.cIndOp && !fiscal.correlacao) {
    add('L119', 'Correlacao fiscal invalida para os servicos informados.', 'Use uma linha valida da planilha Correlacao_TribNac_NBS_cClassTribIBSCBS_CSTIBSCBS_IndOp.xlsx.');
  }

  const issRetido = dados.servico?.issRetido || dados.issRetido || false;
  const documentoTomador = getDocumentoTomador(dados.tomador);
  const exigeTomadorEndereco = Boolean(issRetido)
    || fiscal.cTribNac === '170501'
    || CINDOP_EXIGE_TOMADOR_ENDERECO.has(fiscal.cIndOp);

  if (exigeTomadorEndereco && !documentoTomador) {
    add('V2-TOMADOR', 'Tomador obrigatorio para a operacao fiscal selecionada.', 'Informe CPF/CNPJ e nome do tomador.');
  }

  if (documentoTomador && ![11, 14].includes(documentoTomador.length)) {
    add('V2-TOMADOR-DOC', 'Documento do tomador invalido.', 'Informe CPF com 11 digitos ou CNPJ com 14 digitos.');
  }

  if (exigeTomadorEndereco) {
    const endereco = dados.tomador?.endereco || {};
    const campos = [
      ['logradouro', endereco.logradouro || endereco.xLgr, 'logradouro'],
      ['numero', endereco.numero || endereco.nro, 'numero'],
      ['bairro', endereco.bairro || endereco.xBairro, 'bairro'],
      ['cep', onlyDigits(endereco.cep || endereco.CEP), 'CEP'],
      ['codigoMunicipio', onlyDigits(endereco.codigoMunicipio || endereco.cMun), 'codigo IBGE do municipio'],
    ];

    for (const [key, value, label] of campos) {
      if (!nonEmpty(value)) {
        add(key === 'logradouro' ? 'E056' : 'E0237', `Endereco nacional do tomador incompleto: ${label}.`, 'Informe logradouro, numero, bairro, CEP e codigo IBGE do municipio do tomador.');
      }
    }
  }

  if (hasRetencaoFederal(dados) && documentoTomador.length !== 14) {
    add('E241', 'Retencoes federais so podem ser informadas para tomador pessoa juridica.', 'Zere as retencoes federais ou informe um tomador CNPJ.');
  }

  if (mensagens.length > 0) {
    throw criarErroValidacao(mensagens);
  }
}

function gerarIdDPS(codigoMunicipio, tipoInscricaoFederal, inscricaoFederal, serie, numero) {
  const tipo = String(tipoInscricaoFederal || (onlyDigits(inscricaoFederal).length === 14 ? '2' : '1'));
  const cpfCnpj = onlyDigits(inscricaoFederal).padStart(14, '0').slice(-14);
  const serieStr = onlyDigits(serie).padStart(5, '0').slice(-5);
  const numeroStr = onlyDigits(numero).padStart(15, '0').slice(-15);
  const resultado = `DPS${codigoMunicipio}${tipo}${cpfCnpj}${serieStr}${numeroStr}`;

  if (resultado.length !== 45) {
    console.log('[XML v2] AVISO: ID DPS tem ' + resultado.length + ' chars, esperado 45');
  }
  return resultado;
}

function gerarIdNFSe(codigoMunicipio, ambienteGerador, tipoInscricaoFederal, inscricaoFederal, numeroNota, anoMes, codigoNumero) {
  const tipo = String(tipoInscricaoFederal || (onlyDigits(inscricaoFederal).length === 14 ? '2' : '1'));
  const cpfCnpj = onlyDigits(inscricaoFederal).padStart(14, '0').slice(-14);
  const numeroNotaStr = String(numeroNota).padStart(13, '0');
  const codigoNumeroStr = String(codigoNumero).padStart(9, '0');
  const dv = '1';
  return `NFS${codigoMunicipio}${ambienteGerador}${tipo}${cpfCnpj}${numeroNotaStr}${anoMes}${codigoNumeroStr}${dv}`;
}

function montarDpsObject(dados, includeNamespace = false) {
  const codigoMunicipioEmissao = getCodigoMunicipioEmissao(dados);
  const codigoMunicipioPrestador = getCodigoMunicipio(dados);
  const codigoMunicipioPrestacao = getCodigoMunicipioPrestacao(dados, codigoMunicipioEmissao);
  const homologacao = isAmbienteHomologacao(dados);
  const prestador = resolvePrestador(dados);
  const fiscal = extrairFiscalServico(dados);
  validarDpsNegocio(dados, {
    prestador,
    codigoMunicipio: codigoMunicipioPrestador,
    codigoMunicipioEmissao,
    codigoMunicipioPrestacao,
    fiscal,
    homologacao,
  });
  const serieDps = getSerieDps(dados);
  const numeroDps = getNumeroDps(dados);
  const tpEmit = String(dados.tpEmit ?? '1');
  const idDps = gerarIdDPS(
    codigoMunicipioEmissao,
    prestador.tipoInscricaoFederal,
    prestador.documento,
    serieDps,
    numeroDps
  );

  const vServicos = Number(dados.servico?.valorServicos || dados.valorServicos || 0);
  const vDescIncond = Number(dados.servico?.vDescIncond || dados.vDescIncond || 0);
  const vDescCond = Number(dados.servico?.vDescCond || dados.vDescCond || 0);
  const pAliq = Number(dados.servico?.aliquota || dados.aliquota || 2);
  const issRetido = dados.servico?.issRetido || dados.issRetido || false;

  const tribFed = {};
  if (Number(dados.tribFed?.vRetCP) > 0) tribFed.vRetCP = formatDecimal(dados.tribFed.vRetCP);
  if (Number(dados.tribFed?.vRetIRRF) > 0) tribFed.vRetIRRF = formatDecimal(dados.tribFed.vRetIRRF);
  if (Number(dados.tribFed?.vRetCSLL) > 0) tribFed.vRetCSLL = formatDecimal(dados.tribFed.vRetCSLL);

  const trib = {
    tribMun: {
      tribISSQN: String(dados.servico?.tribISSQN || dados.tribISSQN || dados.tributacao || 1),
      tpRetISSQN: issRetido ? '2' : '1',
      pAliq: formatDecimal(pAliq),
    },
  };

  if (dados.cPaisResult) trib.tribMun.cPaisResult = String(dados.cPaisResult);
  if (Object.keys(tribFed).length > 0) trib.tribFed = tribFed;
  trib.totTrib = { indTotTrib: String(dados.indTotTrib ?? dados.servico?.indTotTrib ?? 0) };

  const cServ = {
    cTribNac: fiscal.cTribNac,
    cTribMun: fiscal.cTribMun,
    xDescServ: nonEmpty(dados.servico?.discriminacao || dados.discriminacao || 'Servicos prestados'),
  };
  if (fiscal.cNBS) cServ.cNBS = fiscal.cNBS;

  const serv = {
    locPrest: {
      cLocPrestacao: codigoMunicipioPrestacao,
    },
    cServ,
  };

  if (dados.infAdPrest || dados.infAdFisco) {
    serv.infoCompl = {};
    if (dados.infAdPrest) serv.infoCompl.xInfComp = String(dados.infAdPrest).slice(0, 2000);
    if (dados.infAdFisco) serv.infoCompl.xInfAdFisco = String(dados.infAdFisco).slice(0, 2000);
  }

  const valores = {
    vServPrest: {
      vServ: formatDecimal(vServicos),
    },
  };

  if (vDescIncond > 0 || vDescCond > 0) {
    valores.vDescCondIncond = {};
    if (vDescIncond > 0) valores.vDescCondIncond.vDescIncond = formatDecimal(vDescIncond);
    if (vDescCond > 0) valores.vDescCondIncond.vDescCond = formatDecimal(vDescCond);
  }

  valores.trib = trib;

  const infDPS = {
    '@_Id': idDps,
    tpAmb: String(dados.tpAmb || config.tpAmb || 2),
    dhEmi: formatarDhEmi(dados.dhEmi || dados.rps?.dataEmissao),
    verAplic: String(VERSAO_SCHEMA_NACIONAL),
    serie: serieDps,
    nDPS: numeroDps,
    dCompet: formatarData(dados.dCompet || dados.rps?.competencia || dados.rps?.dataEmissao),
    tpEmit,
    cLocEmi: codigoMunicipioEmissao,
    ...(dados.subst ? {
      subst: {
        chSubstda: onlyDigits(dados.subst.chSubstda || dados.subst.chNFSe || dados.subst.chaveAcesso),
        cMotivo: String(dados.subst.cMotivo || dados.subst.motivo || '99').padStart(2, '0'),
        ...(dados.subst.xMotivo ? { xMotivo: String(dados.subst.xMotivo).slice(0, 255) } : {}),
      },
    } : {}),
    prest: (() => {
      const p = montarPrestador({
        ...prestador,
        opSimpNac: dados.optanteSimplesNacional ? 3 : 1,
        regApTribSN: dados.regApTribSN || dados.regimeApuracao,
        regEspTrib: dados.regEspTrib ?? dados.regimeEspecialTributacao,
      }, codigoMunicipioPrestador);
      if (tpEmit === '1') {
        delete p.xNome;
        delete p.end;
      }
      return p;
    })(),
  };

  const tomador = montarPessoaTomador(dados.tomador, codigoMunicipioPrestador);
  if (tomador) infDPS.toma = tomador;
  infDPS.serv = serv;
  infDPS.valores = valores;
  infDPS.IBSCBS = montarIbsCbs(dados, fiscal);

  if (dados.pag) infDPS.pag = dados.pag;

  const dps = {
    '@_versao': VERSAO_SCHEMA_NACIONAL,
    infDPS,
  };

  if (includeNamespace) {
    dps['@_xmlns'] = NS_NFSE;
  }

  return { DPS: dps };
}

function gerarXmlDps(dados) {
  return builder.build(montarDpsObject(dados, true));
}

function gerarXmlDpsCompacto(dados) {
  return builderCompact.build(montarDpsObject(dados, true));
}

function envolverGerarNfseEnvio(dpsXml) {
  const inner = removerDeclaracaoXml(dpsXml);
  return `<?xml version="1.0" encoding="UTF-8"?><GerarNfseEnvio xmlns="${NS_NFSE}">${inner}</GerarNfseEnvio>`;
}

function removerDeclaracaoXml(xml) {
  return String(xml || '').replace(/<\?xml.*?\?>\s*/i, '').trim();
}

function montarPrestadorLote(cnpjPrestador, inscricaoMunicipal) {
  const documento = onlyDigits(cnpjPrestador || resolvePrestador().documento);
  return {
    ...(documento.length === 14 ? { CNPJ: documento } : { CPF: documento }),
    IM: String(inscricaoMunicipal || resolvePrestador().inscricaoMunicipal),
  };
}

function gerarXmlLoteDps(listaDps, numeroLote, cnpjPrestador, inscricaoMunicipal) {
  const idLote = `LOTE${numeroLote}`;
  const dpsXml = listaDps
    .map((dps) => removerDeclaracaoXml(dps.xml || gerarXmlDps(dps)))
    .join('\n');
  const prestador = montarPrestadorLote(cnpjPrestador, inscricaoMunicipal);

  return `<?xml version="1.0" encoding="UTF-8"?>
<LoteDps xmlns="${NS_NFSE}" Id="${idLote}" versao="${VERSAO_SCHEMA_NACIONAL}">
  <NumeroLote>${numeroLote}</NumeroLote>
  <Prestador>
    ${prestador.CNPJ ? `<CNPJ>${prestador.CNPJ}</CNPJ>` : `<CPF>${prestador.CPF}</CPF>`}
    <IM>${prestador.IM}</IM>
  </Prestador>
  <QuantidadeDps>${listaDps.length}</QuantidadeDps>
  <ListaDps>
    ${dpsXml}
  </ListaDps>
</LoteDps>`;
}

function gerarXmlGerarNfse(dados) {
  const dps = dados.dps || dados;
  return envolverGerarNfseEnvio(gerarXmlDpsCompacto(dps));
}

function gerarXmlEnviarLoteDpsSincrono(listaDps, numeroLote) {
  const prestador = resolvePrestador(listaDps[0] || {});
  const xmlObj = {
    EnviarLoteDpsSincronoEnvio: {
      '@_xmlns': NS_NFSE,
      '@_xmlns:dsig': NS_DS,
      LoteDps: {
        '@_Id': `LOTE${numeroLote}`,
        '@_versao': VERSAO_SCHEMA_NACIONAL,
        NumeroLote: String(numeroLote),
        Prestador: montarPrestadorLote(prestador.documento, prestador.inscricaoMunicipal),
        QuantidadeDps: listaDps.length,
        ListaDps: {
          DPS: listaDps.map((dps) => montarDpsObject(dps, false).DPS),
        },
      },
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
}

function gerarXmlRecepcaoLoteDps(listaDps, numeroLote) {
  const prestador = resolvePrestador(listaDps[0] || {});
  const xmlObj = {
    EnviarLoteDpsEnvio: {
      '@_xmlns': NS_NFSE,
      '@_xmlns:dsig': NS_DS,
      LoteDps: {
        '@_Id': `LOTE${numeroLote}`,
        '@_versao': VERSAO_SCHEMA_NACIONAL,
        NumeroLote: String(numeroLote),
        Prestador: montarPrestadorLote(prestador.documento, prestador.inscricaoMunicipal),
        QuantidadeDps: listaDps.length,
        ListaDps: {
          DPS: listaDps.map((dps) => montarDpsObject(dps, false).DPS),
        },
      },
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
}

function montarAutorEvento(documento) {
  const digits = onlyDigits(documento);
  if (digits.length === 14) return { CNPJAutor: digits };
  if (digits.length === 11) return { CPFAutor: digits };
  throw criarErroValidacao([
    criarMensagemValidacao('V2-EVT-AUTOR', 'Documento do autor do evento nao informado ou invalido.', 'Informe CPF ou CNPJ do prestador/autor do evento.'),
  ]);
}

function montarPedidoEvento({ chNFSe, documentoAutor, motivo = 1, xMotivo, tipoEvento = 'e101103', tpAmb } = {}) {
  const chave = onlyDigits(chNFSe);
  if (chave.length !== 50) {
    throw criarErroValidacao([
      criarMensagemValidacao('V2-EVT-CHAVE', 'Chave de acesso da NFS-e invalida para evento.', 'Informe a chave NFS-e com 50 digitos.'),
    ]);
  }

  const tipoNumerico = onlyDigits(tipoEvento);
  const infPedReg = {
    '@_Id': `PRE${chave}${tipoNumerico}`,
    tpAmb: String(tpAmb || config.tpAmb || 2),
    verAplic: 'NFSe-Nacional-v2',
    dhEvento: formatarDhEmi(),
    ...montarAutorEvento(documentoAutor),
    chNFSe: chave,
  };

  if (tipoEvento === 'e101103') {
    infPedReg.e101103 = {
      xDesc: 'Solicitação de Análise Fiscal para Cancelamento de NFS-e',
      cMotivo: String(motivo || 1),
      xMotivo: nonEmpty(xMotivo) || 'Solicitacao de analise fiscal para cancelamento',
    };
  } else {
    infPedReg.e101101 = {
      xDesc: 'Cancelamento de NFS-e',
      cMotivo: String(motivo || 1),
      xMotivo: nonEmpty(xMotivo) || (String(motivo) === '9' ? 'Outros' : 'Erro na Emissao'),
    };
  }

  return {
    '@_versao': VERSAO_SCHEMA_NACIONAL,
    infPedReg,
  };
}

function gerarXmlCancelamento(paramsOrNumero, codigoVerificacao, cnpjPrestador, inscricaoMunicipal, motivo) {
  const params = typeof paramsOrNumero === 'object'
    ? paramsOrNumero
    : {
      chNFSe: codigoVerificacao,
      documentoAutor: cnpjPrestador,
      motivo,
    };

  const xmlObj = {
    CancelarNfseEnvio: {
      '@_xmlns': NS_NFSE,
      '@_xmlns:dsig': NS_DS,
      pedRegEvento: montarPedidoEvento({
        chNFSe: params.chNFSe || params.chaveAcesso,
        documentoAutor: params.documentoAutor || params.cnpjPrestador || params.cpfPrestador,
        motivo: params.motivo,
        xMotivo: params.xMotivo,
        tipoEvento: params.tipoEvento || 'e101103',
        tpAmb: params.tpAmb,
      }),
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
}

function gerarXmlSubstituicao(numeroNfse, codigoVerificacao, novaDps, cnpjPrestador, inscricaoMunicipal, motivo) {
  const dpsSubstituta = {
    ...novaDps,
    subst: {
      chSubstda: onlyDigits(codigoVerificacao),
      cMotivo: String(motivo || 99).padStart(2, '0'),
      xMotivo: 'Substituicao por nova NFS-e',
      ...(novaDps?.subst || {}),
    },
  };

  return gerarXmlGerarNfse(dpsSubstituta);
}

function gerarXmlConsultaPorDps(numeroDps, serieDps, cnpjPrestador, inscricaoMunicipal) {
  const xmlObj = {
    ConsultarNfseDpsEnvio: {
      '@_xmlns': NS_NFSE,
      IdentificacaoDps: {
        NumDPS: String(numeroDps),
        SerieDPS: String(serieDps || SERIE_DPS_SUPORTE),
      },
      Prestador: montarPrestadorLote(cnpjPrestador, inscricaoMunicipal),
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
}

function gerarXmlConsultaPorFaixa(numeroInicial, numeroFinal, pagina, cnpjPrestador, inscricaoMunicipal) {
  const xmlObj = {
    ConsultarNfseFaixaEnvio: {
      '@_xmlns': NS_NFSE,
      Prestador: montarPrestadorLote(cnpjPrestador, inscricaoMunicipal),
      Faixa: {
        NumeroNfseInicial: String(numeroInicial),
        NumeroNfseFinal: String(numeroFinal),
      },
      Pagina: formatarPagina(pagina),
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
}

function montarPeriodo(dataInicial, dataFinal) {
  return {
    DataInicial: dataInicial || formatarData(),
    DataFinal: dataFinal || dataInicial || formatarData(),
  };
}

function gerarXmlConsultaServicosPrestados(dataInicial, dataFinal, cnpjPrestador, inscricaoMunicipal, pagina) {
  const xmlObj = {
    ConsultarNfseServicoPrestadoEnvio: {
      '@_xmlns': NS_NFSE,
      Prestador: montarPrestadorLote(cnpjPrestador, inscricaoMunicipal),
      PeriodoEmissao: montarPeriodo(dataInicial, dataFinal),
      Pagina: formatarPagina(pagina),
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
}

function gerarXmlConsultaServicosTomados(cnpjConsulente, inscricaoMunicipal, dataInicial, dataFinal, pagina) {
  const prestador = montarPrestadorLote(cnpjConsulente, inscricaoMunicipal);
  const xmlObj = {
    ConsultarNfseServicoTomadoEnvio: {
      '@_xmlns': NS_NFSE,
      Consulente: prestador,
      PeriodoEmissao: montarPeriodo(dataInicial, dataFinal),
      Tomador: prestador,
      Pagina: formatarPagina(pagina),
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
}

function gerarXmlConsultaLote(protocolo, cnpjPrestador, inscricaoMunicipal) {
  const xmlObj = {
    ConsultarLoteDpsEnvio: {
      '@_xmlns': NS_NFSE,
      Prestador: montarPrestadorLote(cnpjPrestador, inscricaoMunicipal),
      Protocolo: String(protocolo),
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
}

function gerarXmlConsultaSituacaoLote(protocolo, cnpjPrestador, inscricaoMunicipal) {
  return gerarXmlConsultaLote(protocolo, cnpjPrestador, inscricaoMunicipal);
}

function gerarXmlConsultaUrlNfse(numeroNfse, cnpjPrestador, inscricaoMunicipal) {
  const xmlObj = {
    ConsultarUrlNfseEnvio: {
      '@_xmlns': NS_NFSE,
      Prestador: montarPrestadorLote(cnpjPrestador, inscricaoMunicipal),
      NumeroNfse: String(numeroNfse),
      Pagina: formatarPagina(1),
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
}

function gerarXmlConsultaDadosCadastrais(cnpjPrestador, inscricaoMunicipal) {
  const xmlObj = {
    ConsultarDadosCadastraisEnvio: {
      '@_xmlns': NS_NFSE,
      Prestador: montarPrestadorLote(cnpjPrestador, inscricaoMunicipal),
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
}

function gerarXmlConsultaDpsDisponivel(cnpjPrestador, inscricaoMunicipal, pagina) {
  const xmlObj = {
    ConsultarDpsDisponivelEnvio: {
      '@_xmlns': NS_NFSE,
      Prestador: montarPrestadorLote(cnpjPrestador, inscricaoMunicipal),
      Pagina: formatarPagina(pagina),
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
}

module.exports = {
  gerarXmlDps,
  gerarXmlDpsCompacto,
  envolverGerarNfseEnvio,
  gerarXmlLoteDps,
  gerarXmlGerarNfse,
  gerarXmlEnviarLoteDpsSincrono,
  gerarXmlRecepcaoLoteDps,
  gerarXmlCancelamento,
  gerarXmlSubstituicao,
  gerarXmlConsultaPorDps,
  gerarXmlConsultaPorFaixa,
  gerarXmlConsultaServicosPrestados,
  gerarXmlConsultaServicosTomados,
  gerarXmlConsultaLote,
  gerarXmlConsultaSituacaoLote,
  gerarXmlConsultaUrlNfse,
  gerarXmlConsultaDadosCadastrais,
  gerarXmlConsultaDpsDisponivel,
  gerarIdDPS,
  gerarIdNFSe,
};
