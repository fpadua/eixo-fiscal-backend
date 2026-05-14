const nfseService = require('../../services/v2/nfse.service');
const config = require('../../config/nfse.config');
const { TenantSettingsRepository } = require('../../repositories/tenant.repository');

async function loadCert(tenantId) {
  if (config.isMock) return { pfxBuffer: null, password: null };
  try {
    const repo = new TenantSettingsRepository(tenantId);
    const cert = await repo.decryptCertificate();
    if (cert) return { pfxBuffer: cert.certificateContent, password: cert.certificatePassword };
  } catch (e) {
    console.warn('[V2 NFSE] Cert não encontrado:', e.message);
  }
  return { pfxBuffer: null, password: null };
}

async function gerarNfse(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    const resultado = await nfseService.gerarNfse(req.body, pfxBuffer, password);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function enviarLoteDpsSincrono(req, res) {
  try {
    const { listaDps, numeroLote } = req.body;
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    const resultado = await nfseService.enviarLoteDpsSincrono(listaDps, numeroLote || Date.now(), pfxBuffer, password);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function recepcionarLoteDps(req, res) {
  try {
    const { listaDps, numeroLote } = req.body;
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    const resultado = await nfseService.recepcionarLoteDps(listaDps, numeroLote || Date.now(), pfxBuffer, password);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function consultarLoteDps(req, res) {
  try {
    const { protocolo } = req.params;
    const resultado = await nfseService.consultarLoteDps(protocolo);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function consultarSituacaoLote(req, res) {
  try {
    const { protocolo } = req.params;
    const resultado = await nfseService.consultarSituacaoLote(protocolo);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function consultarNfsePorDps(req, res) {
  try {
    const { numero, serie } = req.params;
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    const resultado = await nfseService.consultarNfsePorDps(numero, serie || '00001', pfxBuffer, password);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function consultarNfsePorFaixa(req, res) {
  try {
    const { inicio, fim, pagina } = req.query;
    const resultado = await nfseService.consultarNfsePorFaixa(
      parseInt(inicio, 10),
      parseInt(fim, 10),
      parseInt(pagina, 10) || 1
    );
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function consultarNfseServicoPrestado(req, res) {
  try {
    const { dataInicial, dataFinal, pagina } = req.query;
    const resultado = await nfseService.consultarNfseServicoPrestado(dataInicial, dataFinal, parseInt(pagina, 10) || 1);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function consultarNfseServicoTomado(req, res) {
  try {
    const { cnpj, dataInicial, dataFinal, pagina } = req.query;
    const resultado = await nfseService.consultarNfseServicoTomado(cnpj, dataInicial, dataFinal, parseInt(pagina, 10) || 1);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function cancelarNfse(req, res) {
  try {
    const { numeroNota, codigoVerificacao, motivo } = req.body;
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    const resultado = await nfseService.cancelarNfse(numeroNota, codigoVerificacao, motivo, pfxBuffer, password);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function substituirNfse(req, res) {
  try {
    const { numeroNota, codigoVerificacao, novaDps, motivo } = req.body;
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    const resultado = await nfseService.substituirNfse(numeroNota, codigoVerificacao, novaDps, motivo, pfxBuffer, password);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function consultarUrlNfse(req, res) {
  try {
    const { numero } = req.params;
    const resultado = await nfseService.consultarUrlNfse(numero);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function consultarDadosCadastrais(req, res) {
  try {
    const resultado = await nfseService.consultarDadosCadastrais();
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function consultarDpsDisponivel(req, res) {
  try {
    const { pagina } = req.query;
    const resultado = await nfseService.consultarDpsDisponivel(parseInt(pagina, 10) || 1);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
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
