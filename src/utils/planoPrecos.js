const BILLING_CYCLES = ['monthly', 'annual'];

function normalizarDesconto(percent) {
  const n = Number(percent);
  if (Number.isNaN(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function precoMensalNumero(plano) {
  return Number(plano?.precoMensal ?? 0);
}

function calcularPrecos(plano, ciclo = 'monthly') {
  const mensal = precoMensalNumero(plano);
  const descontoPercent = normalizarDesconto(plano?.descontoAnualPercent ?? 0);
  const brutoAnual = mensal * 12;
  const totalAnual = mensal > 0
    ? Math.round(brutoAnual * (1 - descontoPercent / 100) * 100) / 100
    : 0;
  const equivalenteMensal = totalAnual > 0 ? Math.round((totalAnual / 12) * 100) / 100 : 0;
  const economia = Math.round((brutoAnual - totalAnual) * 100) / 100;

  const isAnnual = ciclo === 'annual';

  return {
    mensal,
    totalAnual,
    equivalenteMensal,
    economia,
    descontoPercent,
    brutoAnual,
    ciclo: isAnnual ? 'annual' : 'monthly',
    exibicaoPrincipal: mensal === 0
      ? 0
      : isAnnual
        ? equivalenteMensal
        : mensal,
    exibicaoSecundaria: mensal === 0
      ? null
      : isAnnual
        ? totalAnual
        : null,
    labelCiclo: isAnnual ? 'anual' : 'mensal',
  };
}

function validarBillingCycle(cycle) {
  return BILLING_CYCLES.includes(cycle) ? cycle : 'monthly';
}

function maiorDescontoAnual(planos) {
  if (!Array.isArray(planos) || planos.length === 0) return 0;
  return planos.reduce((max, p) => {
    if (precoMensalNumero(p) <= 0) return max;
    return Math.max(max, normalizarDesconto(p.descontoAnualPercent));
  }, 0);
}

module.exports = {
  BILLING_CYCLES,
  normalizarDesconto,
  calcularPrecos,
  validarBillingCycle,
  maiorDescontoAnual,
};
