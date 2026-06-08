const nfseService = require('../../services/v2/nfse.service');
const { getConfig } = require('../../config');
const { TenantSettingsRepository } = require('../../repositories/tenant.repository');
const taxTables = require('../../services/v2/tax-tables.service');

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

async function getPrestadorConsulta(req) {
  const tenantId = req.tenantId || 'default-tenant-id';
  const config = await getConfig(tenantId);
  const prestador = prestadorFromTenant(req.tenant);
  return {
    documento: prestador.cnpj || prestador.cpf || config.prestador.cnpj || config.prestador.cpf,
    inscricaoMunicipal: prestador.inscricaoMunicipal || prestador.IM || config.prestador.inscricaoMunicipal || config.prestador.IM,
  };
}

function responderErro(res, err) {
  if (err.code === 'VALIDACAO_DPS_V2') {
    return res.status(422).json({
      sucesso: false,
      erro: err.message,
      mensagensRetorno: err.mensagensRetorno || [],
      missingFields: err.missingFields || [],
    });
  }
  if (err.message.includes('Falha ao carregar certificado') || err.message.includes('Senha do certificado')) {
    return res.status(401).json({ sucesso: false, erro: `Erro de certificado: ${err.message}` });
  }
  return res.status(500).json({ sucesso: false, erro: err.message });
}

async function loadCert(tenantId) {
  const config = await getConfig(tenantId);
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
    if (err.code === 'VALIDACAO_DPS_V2') {
      return res.status(422).json({
        sucesso: false,
        erro: err.message,
        mensagensRetorno: err.mensagensRetorno || [],
        missingFields: err.missingFields || [],
      });
    }
    // Aqui você pode diferenciar o erro de certificado
    if (err.message.includes('Falha ao carregar certificado') || err.message.includes('Senha do certificado PKCS#12 inválida')) {
      return res.status(401).json({ sucesso: false, erro: `Erro de certificado: ${err.message}` });
    }
    return responderErro(res, err);
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
    return responderErro(res, err);
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
    return responderErro(res, err);
  }
}

async function consultarLoteDps(req, res) {
  try {
    const { protocolo } = req.params;
    const prestador = await getPrestadorConsulta(req);
    const resultado = await nfseService.consultarLoteDps(protocolo, prestador.documento, prestador.inscricaoMunicipal);
    res.json(resultado);
  } catch (err) {
    return responderErro(res, err);
  }
}

async function consultarSituacaoLote(req, res) {
  try {
    const { protocolo } = req.params;
    const prestador = await getPrestadorConsulta(req);
    const resultado = await nfseService.consultarSituacaoLote(protocolo, prestador.documento, prestador.inscricaoMunicipal);
    res.json(resultado);
  } catch (err) {
    return responderErro(res, err);
  }
}

async function consultarNfsePorDps(req, res) {
  try {
    const { numero } = req.params;
    const { serie } = req.query;
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    if (!pfxBuffer || !password) {
      return res.status(400).json({ sucesso: false, erro: 'Certificado ou senha não fornecidos/válidos.' });
    }
    const prestador = await getPrestadorConsulta(req);
    const resultado = await nfseService.consultarNfsePorDps(numero, serie || '1', pfxBuffer, password, prestador.documento, prestador.inscricaoMunicipal);
    res.json(resultado);
  } catch (err) {
    if (err.message.includes('Falha ao carregar certificado') || err.message.includes('Senha do certificado PKCS#12 inválida')) {
      return res.status(401).json({ sucesso: false, erro: `Erro de certificado: ${err.message}` });
    }
    return responderErro(res, err);
  }
}

async function consultarNfsePorFaixa(req, res) {
  try {
    const { inicio, fim, pagina } = req.query;
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    if (!pfxBuffer || !password) {
      return res.status(400).json({ sucesso: false, erro: 'Certificado ou senha não fornecidos/válidos.' });
    }
    const prestador = await getPrestadorConsulta(req);
    const resultado = await nfseService.consultarNfsePorFaixa(
      parseInt(inicio, 10),
      parseInt(fim, 10),
      parseInt(pagina, 10) || 1,
      pfxBuffer,
      password,
      prestador.documento,
      prestador.inscricaoMunicipal
    );
    res.json(resultado);
  } catch (err) {
    if (err.message.includes('Falha ao carregar certificado') || err.message.includes('Senha do certificado PKCS#12 inválida')) {
      return res.status(401).json({ sucesso: false, erro: `Erro de certificado: ${err.message}` });
    }
    return responderErro(res, err);
  }
}

async function consultarNfseServicoPrestado(req, res) {
  try {
    const { dataInicial, dataFinal, pagina } = req.query;
    const prestador = await getPrestadorConsulta(req);
    const resultado = await nfseService.consultarNfseServicoPrestado(dataInicial, dataFinal, parseInt(pagina, 10) || 1, prestador.documento, prestador.inscricaoMunicipal);
    res.json(resultado);
  } catch (err) {
    return responderErro(res, err);
  }
}

async function consultarNfseServicoTomado(req, res) {
  try {
    const { cnpj, dataInicial, dataFinal, pagina } = req.query;
    const prestador = await getPrestadorConsulta(req);
    const resultado = await nfseService.consultarNfseServicoTomado(cnpj || prestador.documento, dataInicial, dataFinal, parseInt(pagina, 10) || 1, prestador.inscricaoMunicipal);
    res.json(resultado);
  } catch (err) {
    return responderErro(res, err);
  }
}

async function cancelarNfse(req, res) {
  try {
    const { numeroNota, codigoVerificacao, chaveAcesso, chNFSe, motivo } = req.body;
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    if (!pfxBuffer || !password) {
      return res.status(400).json({ sucesso: false, erro: 'Certificado ou senha não fornecidos/válidos.' });
    }
    const prestador = await getPrestadorConsulta(req);
    const resultado = await nfseService.cancelarNfse(
      numeroNota,
      chNFSe || chaveAcesso || codigoVerificacao,
      motivo,
      pfxBuffer,
      password,
      prestador.documento
    );
    res.json(resultado);
  } catch (err) {
    if (err.message.includes('Falha ao carregar certificado') || err.message.includes('Senha do certificado PKCS#12 inválida')) {
      return res.status(401).json({ sucesso: false, erro: `Erro de certificado: ${err.message}` });
    }
    return responderErro(res, err);
  }
}

async function substituirNfse(req, res) {
  try {
    const { numeroNota, codigoVerificacao, chaveAcesso, chNFSe, novaDps, motivo } = req.body;
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    if (!pfxBuffer || !password) {
      return res.status(400).json({ sucesso: false, erro: 'Certificado ou senha não fornecidos/válidos.' });
    }
    const dps = withTenantPrestador(novaDps, req.tenant);
    const resultado = await nfseService.substituirNfse(numeroNota, chNFSe || chaveAcesso || codigoVerificacao, dps, motivo, pfxBuffer, password);
    res.json(resultado);
  } catch (err) {
    if (err.message.includes('Falha ao carregar certificado') || err.message.includes('Senha do certificado PKCS#12 inválida')) {
      return res.status(401).json({ sucesso: false, erro: `Erro de certificado: ${err.message}` });
    }
    return responderErro(res, err);
  }
}

async function consultarUrlNfse(req, res) {
  try {
    const { numero } = req.params;
    const prestador = await getPrestadorConsulta(req);
    const resultado = await nfseService.consultarUrlNfse(numero, prestador.documento, prestador.inscricaoMunicipal);
    res.json(resultado);
  } catch (err) {
    return responderErro(res, err);
  }
}

async function consultarDadosCadastrais(req, res) {
  try {
    const prestador = await getPrestadorConsulta(req);
    const resultado = await nfseService.consultarDadosCadastrais(prestador.documento, prestador.inscricaoMunicipal);
    res.json(resultado);
  } catch (err) {
    return responderErro(res, err);
  }
}

async function consultarDpsDisponivel(req, res) {
  try {
    const { pagina } = req.query;
    const prestador = await getPrestadorConsulta(req);
    const resultado = await nfseService.consultarDpsDisponivel(parseInt(pagina, 10) || 1, prestador.documento, prestador.inscricaoMunicipal);
    res.json(resultado);
  } catch (err) {
    return responderErro(res, err);
  }
}

function catalogoFiscal(req, res) {
  res.json(taxTables.getCatalogo(req.query.cTribNac));
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
  catalogoFiscal,
};
