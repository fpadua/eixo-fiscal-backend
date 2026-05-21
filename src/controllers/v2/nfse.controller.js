const nfseService = require('../../services/v2/nfse.service');
const config = require('../../config/nfse.config');
const { TenantSettingsRepository } = require('../../repositories/tenant.repository');

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function compactObject(obj = {}) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => nonEmpty(value) !== undefined)
  );
}

function mergePrestador(...prestadores) {
  const merged = {};
  const endereco = {};

  for (const prestador of prestadores) {
    if (!prestador || typeof prestador !== 'object') continue;

    const { endereco: prestadorEndereco, ...campos } = prestador;
    Object.assign(merged, compactObject(campos));

    if (prestadorEndereco && typeof prestadorEndereco === 'object') {
      Object.assign(endereco, compactObject(prestadorEndereco));
    }
  }

  if (Object.keys(endereco).length > 0) merged.endereco = endereco;
  return merged;
}

function prestadorFromTenant(tenant) {
  if (!tenant) return {};

  const endereco = tenant.endereco && typeof tenant.endereco === 'object'
    ? tenant.endereco
    : {};
  const inscricaoMunicipal = nonEmpty(tenant.inscricaoMunicipal);

  return mergePrestador({
    cnpj: tenant.cnpj,
    inscricaoMunicipal,
    IM: inscricaoMunicipal,
    razaoSocial: tenant.razaoSocial,
    xNome: tenant.razaoSocial,
    endereco: {
      logradouro: endereco.logradouro || endereco.xLgr,
      numero: endereco.numero || endereco.nro,
      complemento: endereco.complemento || endereco.xCpl,
      bairro: endereco.bairro || endereco.xBairro,
      codigoMunicipio: endereco.codigoMunicipio || endereco.cMun,
      cep: endereco.cep || endereco.CEP,
    },
  });
}

function withTenantPrestador(dados = {}, tenant) {
  const prestadorTenant = prestadorFromTenant(tenant);
  if (Object.keys(prestadorTenant).length === 0) return dados;

  if (dados.dps && typeof dados.dps === 'object') {
    return {
      ...dados,
      dps: {
        ...dados.dps,
        prestador: mergePrestador(prestadorTenant, dados.prestador, dados.dps.prestador),
      },
    };
  }

  return {
    ...dados,
    prestador: mergePrestador(prestadorTenant, dados.prestador),
  };
}

function withTenantPrestadorList(listaDps = [], tenant) {
  if (!Array.isArray(listaDps)) return listaDps;
  return listaDps.map((dps) => withTenantPrestador(dps, tenant));
}

async function loadCert(tenantId) {
  if (config.isMock) return { pfxBuffer: null, password: null };
  try {
    const repo = new TenantSettingsRepository(tenantId);
    const cert = await repo.decryptCertificate();
    if (cert) return { pfxBuffer: cert.certificateContent, password: cert.certificatePassword };
  } catch (e) {
    console.warn('[V2 NFSE] Erro ao carregar ou validar certificado:', e.message);
    // Propaga o erro para que as funções chamadoras possam tratá-lo
    throw new Error(`Falha ao carregar certificado: ${e.message}`);
  }
  return { pfxBuffer: null, password: null };
}

async function gerarNfse(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    if (!pfxBuffer || !password) {
      return res.status(400).json({ sucesso: false, erro: 'Certificado ou senha não fornecidos/válidos.' });
    }
    const dados = withTenantPrestador(req.body, req.tenant);
    const resultado = await nfseService.gerarNfse(dados, pfxBuffer, password);
    res.json(resultado);
  } catch (err) {
    // Aqui você pode diferenciar o erro de certificado
    if (err.message.includes('Falha ao carregar certificado') || err.message.includes('Senha do certificado PKCS#12 inválida')) {
      return res.status(401).json({ sucesso: false, erro: `Erro de certificado: ${err.message}` });
    }
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function enviarLoteDpsSincrono(req, res) {
  try {
    const { listaDps, numeroLote } = req.body;
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    if (!pfxBuffer || !password) {
      return res.status(400).json({ sucesso: false, erro: 'Certificado ou senha não fornecidos/válidos.' });
    }
    const resultado = await nfseService.enviarLoteDpsSincrono(
      withTenantPrestadorList(listaDps, req.tenant),
      numeroLote || Date.now(),
      pfxBuffer,
      password
    );
    res.json(resultado);
  } catch (err) {
    if (err.message.includes('Falha ao carregar certificado') || err.message.includes('Senha do certificado PKCS#12 inválida')) {
      return res.status(401).json({ sucesso: false, erro: `Erro de certificado: ${err.message}` });
    }
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function recepcionarLoteDps(req, res) {
  try {
    const { listaDps, numeroLote } = req.body;
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    if (!pfxBuffer || !password) {
      return res.status(400).json({ sucesso: false, erro: 'Certificado ou senha não fornecidos/válidos.' });
    }
    const resultado = await nfseService.recepcionarLoteDps(
      withTenantPrestadorList(listaDps, req.tenant),
      numeroLote || Date.now(),
      pfxBuffer,
      password
    );
    res.json(resultado);
  } catch (err) {
    if (err.message.includes('Falha ao carregar certificado') || err.message.includes('Senha do certificado PKCS#12 inválida')) {
      return res.status(401).json({ sucesso: false, erro: `Erro de certificado: ${err.message}` });
    }
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
    if (!pfxBuffer || !password) {
      return res.status(400).json({ sucesso: false, erro: 'Certificado ou senha não fornecidos/válidos.' });
    }
    const resultado = await nfseService.consultarNfsePorDps(numero, serie || '00001', pfxBuffer, password);
    res.json(resultado);
  } catch (err) {
    if (err.message.includes('Falha ao carregar certificado') || err.message.includes('Senha do certificado PKCS#12 inválida')) {
      return res.status(401).json({ sucesso: false, erro: `Erro de certificado: ${err.message}` });
    }
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
    if (!pfxBuffer || !password) {
      return res.status(400).json({ sucesso: false, erro: 'Certificado ou senha não fornecidos/válidos.' });
    }
    const resultado = await nfseService.cancelarNfse(numeroNota, codigoVerificacao, motivo, pfxBuffer, password);
    res.json(resultado);
  } catch (err) {
    if (err.message.includes('Falha ao carregar certificado') || err.message.includes('Senha do certificado PKCS#12 inválida')) {
      return res.status(401).json({ sucesso: false, erro: `Erro de certificado: ${err.message}` });
    }
    res.status(500).json({ sucesso: false, erro: err.message });
  }
}

async function substituirNfse(req, res) {
  try {
    const { numeroNota, codigoVerificacao, novaDps, motivo } = req.body;
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    if (!pfxBuffer || !password) {
      return res.status(400).json({ sucesso: false, erro: 'Certificado ou senha não fornecidos/válidos.' });
    }
    const resultado = await nfseService.substituirNfse(numeroNota, codigoVerificacao, novaDps, motivo, pfxBuffer, password);
    res.json(resultado);
  } catch (err) {
    if (err.message.includes('Falha ao carregar certificado') || err.message.includes('Senha do certificado PKCS#12 inválida')) {
      return res.status(401).json({ sucesso: false, erro: `Erro de certificado: ${err.message}` });
    }
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
