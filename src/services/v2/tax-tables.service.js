const tables = require('../../data/v2/tax-tables.json');

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeFixed(value, length) {
  const digits = onlyDigits(value);
  return digits ? digits.padStart(length, '0').slice(-length) : '';
}

function normalizeCTribNac(value) {
  return normalizeFixed(value, 6);
}

function normalizeCTribMun(value) {
  return onlyDigits(value).slice(0, 10);
}

function normalizeCNBS(value) {
  return normalizeFixed(value, 9);
}

function normalizeCST(value) {
  return normalizeFixed(value, 3);
}

function normalizeCClassTrib(value) {
  return normalizeFixed(value, 6);
}

function normalizeCIndOp(value) {
  return normalizeFixed(value, 6);
}

const indexes = {
  tributacaoNacional: new Map(tables.tributacaoNacional.map((item) => [normalizeCTribNac(item.cTribNac), item])),
  nbs: new Map(tables.nbs.map((item) => [normalizeCNBS(item.cNBS), item])),
  indOp: new Map(tables.indOp.map((item) => [normalizeCIndOp(item.cIndOp), item])),
  cClassTrib: new Map(tables.cClassTrib.map((item) => [normalizeCClassTrib(item.cClassTrib), item])),
};

const correlacao = tables.correlacao
  .map((item, index) => ({
    id: `${normalizeCTribNac(item.cTribNac)}-${normalizeCNBS(item.cNBS)}-${normalizeCClassTrib(item.cClassTrib)}-${normalizeCST(item.CST)}-${normalizeCIndOp(item.cIndOp)}-${index + 1}`,
    cTribNac: normalizeCTribNac(item.cTribNac),
    xTribNac: firstText(item.xTribNac),
    cNBS: normalizeCNBS(item.cNBS),
    xNBS: firstText(item.xNBS),
    cClassTrib: normalizeCClassTrib(item.cClassTrib),
    xClassTrib: firstText(item.xClassTrib),
    CST: normalizeCST(item.CST),
    xST: firstText(item.xST),
    cIndOp: normalizeCIndOp(item.cIndOp),
    xIndOp: firstText(item.xIndOp),
    prestacaoOnerosa: firstText(item.prestacaoOnerosa),
    adquirenteExterior: firstText(item.adquirenteExterior),
    localIncidenciaIbs: firstText(item.localIncidenciaIbs),
  }))
  .filter((item) => item.cTribNac && item.cNBS && item.cClassTrib && item.CST && item.cIndOp);

const correlacaoPorTribNac = correlacao.reduce((map, item) => {
  if (!map.has(item.cTribNac)) map.set(item.cTribNac, []);
  map.get(item.cTribNac).push(item);
  return map;
}, new Map());

function findTributacaoNacional(cTribNac) {
  return indexes.tributacaoNacional.get(normalizeCTribNac(cTribNac)) || null;
}

function findNBS(cNBS) {
  return indexes.nbs.get(normalizeCNBS(cNBS)) || null;
}

function findIndOp(cIndOp) {
  return indexes.indOp.get(normalizeCIndOp(cIndOp)) || null;
}

function findCClassTrib(cClassTrib) {
  return indexes.cClassTrib.get(normalizeCClassTrib(cClassTrib)) || null;
}

function findCorrelacao({ cTribNac, cNBS, cClassTrib, CST, cIndOp } = {}) {
  const trib = normalizeCTribNac(cTribNac);
  const nbs = normalizeCNBS(cNBS);
  const classe = normalizeCClassTrib(cClassTrib);
  const cst = normalizeCST(CST);
  const ind = normalizeCIndOp(cIndOp);

  return correlacao.find((item) => {
    if (trib && item.cTribNac !== trib) return false;
    if (nbs && item.cNBS !== nbs) return false;
    if (classe && item.cClassTrib !== classe) return false;
    if (cst && item.CST !== cst) return false;
    if (ind && item.cIndOp !== ind) return false;
    return true;
  }) || null;
}

function getCorrelacoes(cTribNac, limit = 250) {
  const trib = normalizeCTribNac(cTribNac);
  const rows = trib ? (correlacaoPorTribNac.get(trib) || []) : correlacao;
  return rows.slice(0, limit);
}

function getCatalogo(cTribNac) {
  const trib = normalizeCTribNac(cTribNac);
  return {
    generatedAt: tables.generatedAt,
    tributacaoNacional: tables.tributacaoNacional.map((item) => ({
      id: normalizeCTribNac(item.cTribNac),
      cTribNac: normalizeCTribNac(item.cTribNac),
      xTribNac: item.xTribNac,
    })),
    correlacoes: getCorrelacoes(trib, trib ? 500 : 120),
    indOp: tables.indOp.map((item) => ({
      id: normalizeCIndOp(item.cIndOp),
      cIndOp: normalizeCIndOp(item.cIndOp),
      xIndOp: item.xIndOp,
      localOperacao: item.localOperacao,
      localFornecimento: item.localFornecimento,
    })),
    cClassTrib: tables.cClassTrib.map((item) => ({
      id: normalizeCClassTrib(item.cClassTrib),
      cClassTrib: normalizeCClassTrib(item.cClassTrib),
      xClassTrib: item.xClassTrib,
      CST: normalizeCST(item.CST),
      xST: item.xST,
    })),
  };
}

module.exports = {
  normalizeCTribNac,
  normalizeCTribMun,
  normalizeCNBS,
  normalizeCST,
  normalizeCClassTrib,
  normalizeCIndOp,
  findTributacaoNacional,
  findNBS,
  findIndOp,
  findCClassTrib,
  findCorrelacao,
  getCorrelacoes,
  getCatalogo,
};
