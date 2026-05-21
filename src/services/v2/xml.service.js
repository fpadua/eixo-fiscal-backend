const { XMLBuilder } = require('fast-xml-parser');
const config = require('../../config/nfse.config');

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
});

const NS_NFSE = 'http://www.sped.fazenda.gov.br/nfse';
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
const VERSAO_SCHEMA_NACIONAL = '1.01';
const CODIGO_MUNICIPIO_CAMPO_GRANDE = '5002704';
const SERIE_DPS_SUPORTE = '8';
const CNPJ_HOMOLOGACAO = '43983294000121';

const PRESTADOR_HOMOLOGACAO = {
  cnpj: CNPJ_HOMOLOGACAO,
  inscricaoMunicipal: '123456',
  razaoSocial: 'Prestador Homologacao NFSe',
  endereco: {
    logradouro: 'Rua Barao do Rio Branco',
    numero: '1000',
    complemento: 'Sala 01',
    bairro: 'Centro',
    codigoMunicipio: CODIGO_MUNICIPIO_CAMPO_GRANDE,
    cep: '79002000',
  },
  fone: '6733334444',
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

function getCodigoMunicipio(dados = {}) {
  return onlyDigits(
    dados.codigoMunicipio
      || dados.codigoMunicipioPrestador
      || dados.prestador?.endereco?.codigoMunicipio
      || config.codigoMunicipioNacional
      || config.codigoMunicipioCampoGrande
      || CODIGO_MUNICIPIO_CAMPO_GRANDE
  );
}

function getCodigoMunicipioPrestacao(dados = {}, codigoMunicipio) {
  return onlyDigits(
    dados.servico?.cLocPrestacao
      || dados.cLocPrestacao
      || dados.servico?.cMunIncid
      || dados.codigoMunicipioIncidencia
      || dados.servico?.municipioIncidencia
      || codigoMunicipio
      || CODIGO_MUNICIPIO_CAMPO_GRANDE
  );
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

function resolvePrestador(dados = {}) {
  const informado = dados.prestador || {};
  const configPrestador = config.prestador || {};
  const documentoInformado = onlyDigits(informado.cnpj || informado.cpf);
  const documentoConfig = onlyDigits(configPrestador.cnpj || configPrestador.cpf);
  const inscricaoMunicipalInformada = nonEmpty(informado.inscricaoMunicipal || informado.IM);
  const inscricaoMunicipalConfig = nonEmpty(configPrestador.inscricaoMunicipal || configPrestador.IM);
  const temPrestadorExplicito = Boolean(
    documentoInformado
      || documentoConfig
      || inscricaoMunicipalInformada
      || inscricaoMunicipalConfig
  );
  const base = {
    ...PRESTADOR_HOMOLOGACAO,
    ...withoutEmptyValues(configPrestador),
    ...withoutEmptyValues(informado),
    endereco: {
      ...PRESTADOR_HOMOLOGACAO.endereco,
      ...withoutEmptyValues(configPrestador.endereco),
      ...withoutEmptyValues(informado.endereco),
    },
  };

  let documento = documentoInformado || documentoConfig;
  if (config.homologacao && !temPrestadorExplicito) {
    documento = CNPJ_HOMOLOGACAO;
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
      || (!temPrestadorExplicito ? PRESTADOR_HOMOLOGACAO.inscricaoMunicipal : undefined)
  );
  if (!inscricaoMunicipal) {
    throw new Error('Inscricao municipal do prestador e obrigatoria para a DPS nacional.');
  }

  return {
    documento,
    tipoInscricaoFederal: documento.length === 14 ? '2' : '1',
    inscricaoMunicipal: String(inscricaoMunicipal).slice(0, 15),
    razaoSocial: nonEmpty(base.razaoSocial || base.xNome || PRESTADOR_HOMOLOGACAO.razaoSocial),
    endereco: base.endereco,
    fone: onlyDigits(base.fone || base.telefone || PRESTADOR_HOMOLOGACAO.fone),
    email: nonEmpty(base.email || PRESTADOR_HOMOLOGACAO.email),
  };
}

function montarEndereco(endereco = {}, codigoMunicipio) {
  const logradouro = nonEmpty(endereco.logradouro || endereco.xLgr);
  const numero = nonEmpty(endereco.numero || endereco.nro);
  const bairro = nonEmpty(endereco.bairro || endereco.xBairro);
  const cep = onlyDigits(endereco.cep || endereco.CEP);
  const municipio = onlyDigits(endereco.codigoMunicipio || endereco.cMun || codigoMunicipio);

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

  const endereco = montarEndereco(tomador.endereco, codigoMunicipio);
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

  const endereco = montarEndereco(prestador.endereco, codigoMunicipio);
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
  const digits = onlyDigits(dados.servico?.cTribNac || dados.cTribNac || dados.itemListaServico);
  return digits.length === 6 ? digits : '010100';
}

function normalizarCTribMun(dados = {}) {
  return sanitizeMaxDigits(
    dados.servico?.cTribMun || dados.servico?.codigoTributacao || dados.codigoTributacao,
    10,
    '1010100000'
  );
}

function montarIbsCbs(dados = {}) {
  const origem = typeof dados.IBSCBS === 'object'
    ? dados.IBSCBS
    : (typeof dados.ibsCBS === 'object' ? dados.ibsCBS : {});
  const gIBSCBS = origem.valores?.trib?.gIBSCBS || origem.trib?.gIBSCBS || origem.gIBSCBS || {};

  return {
    finNFSe: String(origem.finNFSe ?? dados.finNFSe ?? 0),
    cIndOp: sanitizeFixedDigits(origem.cIndOp ?? dados.cIndOp, 6, '000001'),
    indDest: String(origem.indDest ?? dados.indDest ?? 0),
    valores: gIBSCBS.CST || gIBSCBS.cClassTrib ? {
      trib: {
        gIBSCBS: {
          CST: sanitizeFixedDigits(gIBSCBS.CST ?? dados.CST, 3, '000'),
          cClassTrib: sanitizeFixedDigits(gIBSCBS.cClassTrib ?? dados.cClassTrib, 6, '000000'),
        },
      },
    } : {},
  };
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
  const codigoMunicipio = getCodigoMunicipio(dados);
  const codigoMunicipioPrestacao = getCodigoMunicipioPrestacao(dados, codigoMunicipio);
  const prestador = resolvePrestador(dados);
  const serieDps = getSerieDps(dados);
  const numeroDps = getNumeroDps(dados);
  const idDps = gerarIdDPS(
    codigoMunicipio,
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
  const cNBS = nonEmpty(dados.servico?.cNBS || dados.cNBS);

  const tribFed = {};
  if (Number(dados.tribFed?.vRetCP) > 0) tribFed.vRetCP = formatDecimal(dados.tribFed.vRetCP);
  if (Number(dados.tribFed?.vRetIRRF) > 0) tribFed.vRetIRRF = formatDecimal(dados.tribFed.vRetIRRF);
  if (Number(dados.tribFed?.vRetCSLL) > 0) tribFed.vRetCSLL = formatDecimal(dados.tribFed.vRetCSLL);

  const trib = {
    tribMun: {
      tribISSQN: String(dados.tribISSQN || dados.tributacao || 1),
      tpRetISSQN: issRetido ? '2' : '1',
      pAliq: formatDecimal(pAliq),
    },
  };

  if (dados.cPaisResult) trib.tribMun.cPaisResult = String(dados.cPaisResult);
  if (Object.keys(tribFed).length > 0) trib.tribFed = tribFed;
  trib.totTrib = { indTotTrib: '0' };

  const cServ = {
    cTribNac: normalizarCTribNac(dados),
    cTribMun: normalizarCTribMun(dados),
    xDescServ: nonEmpty(dados.servico?.discriminacao || dados.discriminacao || 'Servicos prestados'),
  };
  if (cNBS) cServ.cNBS = cNBS;

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

  console.log('================ dados ================', JSON.stringify(dados, null, 2));

  const infDPS = {
    '@_Id': idDps,
    tpAmb: String(dados.tpAmb || config.tpAmb || 2),
    dhEmi: formatarDhEmi(dados.dhEmi || dados.rps?.dataEmissao),
    verAplic: String(dados.verAplic),
    serie: serieDps,
    nDPS: numeroDps,
    dCompet: formatarData(dados.dCompet || dados.rps?.competencia || dados.rps?.dataEmissao),
    tpEmit: String(dados.tpEmit || 1),
    cLocEmi: codigoMunicipio,
    prest: (() => {
      const p = montarPrestador({
        ...prestador,
        opSimpNac: dados.optanteSimplesNacional ? 3 : 1,
        regApTribSN: dados.regApTribSN || dados.regimeApuracao,
        regEspTrib: dados.regEspTrib ?? dados.regimeEspecialTributacao,
      }, codigoMunicipio);
      if (String(dados.tpEmit || 1) === '1') {
        delete p.xNome;
        delete p.end;
      }
      return p;
    })(),
  };

  console.log('================ infDPS prest ================', JSON.stringify(infDPS.prest, null, 2));

  const tomador = montarPessoaTomador(dados.tomador, codigoMunicipio);
  if (tomador) infDPS.toma = tomador;
  infDPS.serv = serv;
  infDPS.valores = valores;
  infDPS.IBSCBS = montarIbsCbs(dados);

  if (dados.pag) infDPS.pag = dados.pag;

  const dps = {
    '@_versao': VERSAO_SCHEMA_NACIONAL,
    infDPS,
  };

  if (includeNamespace) {
    dps['@_xmlns'] = NS_NFSE;
    dps['@_xmlns:dsig'] = NS_DS;
  }

  return { DPS: dps };
}

function gerarXmlDps(dados) {
  return builder.build(montarDpsObject(dados, true));
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
  const xmlObj = {
    GerarNfseEnvio: {
      '@_xmlns': NS_NFSE,
      '@_xmlns:dsig': NS_DS,
      DPS: montarDpsObject(dps, false).DPS,
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
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

function gerarXmlCancelamento(numeroNfse, codigoVerificacao, cnpjPrestador, inscricaoMunicipal, motivo) {
  const cnpj = onlyDigits(cnpjPrestador);
  const codigoMunicipio = config.codigoMunicipioNacional || CODIGO_MUNICIPIO_CAMPO_GRANDE;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CancelarNfseEnvio xmlns="${NS_NFSE}" versao="${VERSAO_SCHEMA_NACIONAL}">
  <pedRegEvento versao="${VERSAO_SCHEMA_NACIONAL}">
    <infPedReg>
      <tpAmb>2</tpAmb>
      <verAplic>NFSe-Nacional-v2</verAplic>
      <dhEvento>${formatarDhEmi()}</dhEvento>
      <CNPJAutor>${cnpj}</CNPJAutor>
      <chNFSe>${codigoMunicipio}1${cnpj.padStart(14, '0')}${String(numeroNfse).padStart(13, '0')}${new Date().toISOString().slice(0, 4) + new Date().toISOString().slice(5, 7)}0000000011</chNFSe>
      <e101101>
        <xDesc>Cancelamento de NFS-e</xDesc>
        <cMotivo>${motivo || 1}</cMotivo>
        <xMotivo>${motivo === 9 ? 'Outros' : 'Erro na Emissao'}</xMotivo>
      </e101101>
    </infPedReg>
  </pedRegEvento>
</CancelarNfseEnvio>`;

  return xml;
}

function gerarXmlSubstituicao(numeroNfse, codigoVerificacao, novaDps, cnpjPrestador, inscricaoMunicipal, motivo) {
  const cnpj = onlyDigits(cnpjPrestador);
  const codigoMunicipio = config.codigoMunicipioNacional || CODIGO_MUNICIPIO_CAMPO_GRANDE;
  const novaDpsXml = gerarXmlDps(novaDps);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<SubstituirNfseEnvio xmlns="${NS_NFSE}" versao="${VERSAO_SCHEMA_NACIONAL}">
  <pedRegEvento versao="${VERSAO_SCHEMA_NACIONAL}">
    <infPedReg>
      <tpAmb>2</tpAmb>
      <verAplic>NFSe-Nacional-v2</verAplic>
      <dhEvento>${formatarDhEmi()}</dhEvento>
      <CNPJAutor>${cnpj}</CNPJAutor>
      <chNFSe>${codigoMunicipio}1${cnpj.padStart(14, '0')}${String(numeroNfse).padStart(13, '0')}${new Date().toISOString().slice(0, 4) + new Date().toISOString().slice(5, 7)}0000000011</chNFSe>
      <e105102>
        <xDesc>Cancelamento de NFS-e por Substituicao</xDesc>
        <cMotivo>${motivo || 99}</cMotivo>
        <xMotivo>Substituicao por nova NFS-e</xMotivo>
      </e105102>
    </infPedReg>
  </pedRegEvento>
  ${removerDeclaracaoXml(novaDpsXml)}
</SubstituirNfseEnvio>`;

  return xml;
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
      Pagina: String(pagina || 1),
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
      Pagina: String(pagina || 1),
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
      Pagina: String(pagina || 1),
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
  return gerarXmlConsultaLote(protocolo, cnpjPrestador, inscricaoMunicipal)
    .replace('ConsultarLoteDpsEnvio', 'ConsultarSituacaoLoteDpsEnvio')
    .replace('ConsultarLoteDpsEnvio', 'ConsultarSituacaoLoteDpsEnvio');
}

function gerarXmlConsultaUrlNfse(numeroNfse, cnpjPrestador, inscricaoMunicipal) {
  const xmlObj = {
    ConsultarUrlNfseEnvio: {
      '@_xmlns': NS_NFSE,
      Prestador: montarPrestadorLote(cnpjPrestador, inscricaoMunicipal),
      NumeroNfse: String(numeroNfse),
      Pagina: '1',
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
      Pagina: String(pagina || 1),
    },
  };

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObj)}`;
}

module.exports = {
  gerarXmlDps,
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