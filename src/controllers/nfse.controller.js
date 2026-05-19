const { z } = require('zod');
const nfseService = require('../services/nfse.service');
const config = require('../config/nfse.config');
const ClientRepository = require('../repositories/client.repository');
const InvoiceRepository = require('../repositories/invoice.repository');
const { TenantSettingsRepository } = require('../repositories/tenant.repository');

async function findOrCreateClient(tenantId, tomador) {
  if (!tomador?.documento) return null;
  const repo = new ClientRepository(tenantId);
  const doc = tomador.documento.replace(/\D/g, '');
  let client = await repo.findByCpfCnpj(doc);
  if (!client) {
    client = await repo.create({
      cpfCnpj: doc,
      nomeRazaoSocial: tomador.razaoSocial || 'Tomador sem nome',
      email: tomador.contato?.email,
      telefone: tomador.contato?.telefone,
      endereco: tomador.endereco || {},
    });
  }
  return client;
}

async function loadCert(tenantId) {
  if (config.isMock) return { pfxBuffer: null, password: null };
  try {
    const settingsRepo = new TenantSettingsRepository(tenantId);
    const cert = await settingsRepo.decryptCertificate();
    if (cert) return { pfxBuffer: cert.certificateContent, password: cert.certificatePassword };
  } catch (e) {
    console.warn('[NFSE] Certificado não encontrado no banco, usando disco:', e.message);
  }
  return { pfxBuffer: null, password: null };
}

async function salvarInvoice(tenantId, client, dados, resultado) {
  const invRepo = new InvoiceRepository(tenantId);
  const valorTotal = dados.servico?.valorServicos || 0;
  return invRepo.create({
    clientId: client.id,
    numeroNota: resultado.numeroNota ? Number(resultado.numeroNota) : null,
    serie: dados.rps?.serie || 'A1',
    tipoNfse: 'NFS-e',
    status: resultado.sucesso ? 'emitida' : 'erro',
    xmlEnviado: resultado.xmlEnviado,
    xmlRetorno: resultado.xmlResposta,
    chaveAcesso: resultado.codigoVerificacao || resultado.chaveAcesso,
    valorTotal,
    dataEmissao: dados.rps?.dataEmissao ? new Date(dados.rps.dataEmissao) : new Date(),
    urlImpressao: resultado.urlImpressao,
    protocolo: resultado.protocolo,
  });
}

// ─── Schemas de validação ────────────────────────────────────────────────────

const emissaoSchema = z.object({
  rps: z.object({
    numero: z.number().int().positive(),
    serie: z.string().default('A1'),
    tipo: z.number().int().min(1).max(3).default(1),
    dataEmissao: z.string().datetime({ offset: true }),
    status: z.number().int().default(1),
    competencia: z.string().optional(),
  }),
  servico: z.object({
    valorServicos: z.number().positive(),
    valorDeducoes: z.number().min(0).default(0),
    valorPis: z.number().min(0).default(0),
    valorCofins: z.number().min(0).default(0),
    valorInss: z.number().min(0).default(0),
    valorIr: z.number().min(0).default(0),
    valorCsll: z.number().min(0).default(0),
    issRetido: z.boolean().default(false),
    valorIss: z.number().min(0).default(0),
    outrasRetencoes: z.number().min(0).default(0),
    baseCalculo: z.number().min(0).optional(),
    aliquota: z.number().min(0).max(100).default(0),
    valorLiquido: z.number().min(0).optional(),
    itemListaServico: z.string(),
    codigoTributacao: z.string().optional(),
    discriminacao: z.string().max(2000),
    codigoMunicipio: z.string().optional(),
    exigibilidadeIss: z.number().int().min(1).max(7).default(1),
  }),
  tomador: z.object({
    documento: z.string().min(11).max(14),
    inscricaoMunicipal: z.string().optional(),
    razaoSocial: z.string(),
    endereco: z.object({
      logradouro: z.string(),
      numero: z.string(),
      complemento: z.string().optional(),
      bairro: z.string(),
      codigoMunicipio: z.string().optional(),
      uf: z.string().length(2).default('GO'),
      cep: z.string(),
    }).optional(),
    contato: z.object({
      telefone: z.string().optional(),
      email: z.string().email().optional(),
    }).optional(),
  }).optional(),
  optanteSimplesNacional: z.boolean().default(false),
  incentivoFiscal: z.boolean().default(false),
});

const emissaoCompletaSchema = z.object({
  rps: z.object({
    numero: z.number().int().positive(),
    serie: z.string().default('A1'),
    tipo: z.number().int().min(1).max(3).default(1),
    dataEmissao: z.string(),
    status: z.number().int().default(1),
    competencia: z.string().optional(),
    rpsSubstituido: z.object({
      numero: z.number().int(),
      serie: z.string(),
      tipo: z.number().int().default(1),
    }).optional(),
  }),
  servico: z.object({
    valorServicos: z.number().positive(),
    valorDeducoes: z.number().min(0).default(0),
    valorPis: z.number().min(0).default(0),
    valorCofins: z.number().min(0).default(0),
    valorInss: z.number().min(0).default(0),
    valorIr: z.number().min(0).default(0),
    valorCsll: z.number().min(0).default(0),
    outrasRetencoes: z.number().min(0).default(0),
    valorTributos: z.number().min(0).default(0),
    issRetido: z.boolean().default(false),
    responsavelRetencao: z.number().int().min(1).max(2).optional(),
    valorIss: z.number().min(0).default(0),
    aliquota: z.number().min(0).max(100).default(0),
    descontoIncondicionado: z.number().min(0).default(0),
    descontoCondicionado: z.number().min(0).default(0),
    itemListaServico: z.string(),
    codigoCnae: z.string().optional(),
    codigoTributacao: z.string().optional(),
    codigoNbs: z.string().optional(),
    discriminacao: z.string().max(2000),
    codigoMunicipio: z.string().optional(),
    codigoPais: z.number().int().default(1058),
    exigibilidadeIss: z.number().int().min(1).max(7).default(1),
    identifNaoExigibilidade: z.string().optional(),
    municipioIncidencia: z.string().optional(),
    numeroProcesso: z.string().optional(),
  }),
  tomador: z.object({
    documento: z.string().min(11).max(14),
    inscricaoMunicipal: z.string().optional(),
    nif: z.string().optional(),
    razaoSocial: z.string(),
    endereco: z.object({
      exterior: z.boolean().default(false),
      logradouro: z.string().optional(),
      numero: z.string().optional(),
      complemento: z.string().optional(),
      bairro: z.string().optional(),
      codigoMunicipio: z.string().optional(),
      uf: z.string().length(2).optional(),
      cep: z.string().optional(),
      codigoPais: z.number().optional(),
      enderecoCompleto: z.string().optional(),
    }).optional(),
    contato: z.object({
      telefone: z.string().optional(),
      email: z.string().optional(),
    }).optional(),
  }).optional(),
  intermediario: z.object({
    documento: z.string(),
    inscricaoMunicipal: z.string().optional(),
    razaoSocial: z.string().optional(),
    codigoMunicipio: z.string().optional(),
  }).optional(),
  construcaoCivil: z.object({
    codigoObra: z.string().optional(),
    art: z.string().optional(),
  }).optional(),
  regimeEspecialTributacao: z.number().int().min(1).max(6).optional(),
  optanteSimplesNacional: z.boolean().default(false),
  incentivoFiscal: z.boolean().default(false),
  evento: z.object({
    identificacaoEvento: z.string().optional(),
    descricaoEvento: z.string().optional(),
  }).optional(),
  informacoesComplementares: z.string().optional(),
  deducao: z.object({
    tipoDeducao: z.number().int().min(1).max(99),
    descricaoDeducao: z.string().optional(),
    identificacaoNfse: z.object({
      codigoMunicipioGerador: z.string(),
      numeroNfse: z.number().int(),
      codigoVerificacao: z.string(),
    }).optional(),
    identificacaoNfe: z.object({
      numeroNfe: z.number().int(),
      ufNfe: z.string(),
      chaveAcessoNfe: z.string(),
    }).optional(),
    outroDocumento: z.object({
      identificacaoDocumento: z.string(),
    }).optional(),
    fornecedor: z.object({
      documento: z.string(),
    }).optional(),
    fornecedorExterior: z.object({
      nif: z.string().optional(),
      codigoPais: z.number().optional(),
    }).optional(),
    dataEmissao: z.string().optional(),
    valorDedutivel: z.number().optional(),
    valorUtilizadoDeducao: z.number().optional(),
  }).optional(),
});

const cancelamentoSchema = z.object({
  numeroNota: z.number().int().positive(),
  codigoVerificacao: z.string(),
  motivoCancelamento: z.number().int().min(1).max(4).default(1),
});

const consultaRpsSchema = z.object({
  numeroRps: z.number().int().positive(),
  serie: z.string().default('A1'),
  tipo: z.number().int().default(1),
});

const substituicaoSchema = z.object({
  numeroNotaSubstituida: z.number().int().positive(),
  codigoVerificacao: z.string(),
  motivoCancelamento: z.number().int().min(1).max(4).default(2),
  dadosNovaNota: emissaoCompletaSchema, // reaproveita o schema completo da nova NFS-e
});

// ─── Controllers ─────────────────────────────────────────────────────────────

async function emitir(req, res) {
  const parse = emissaoSchema.safeParse(req.body);
  if (!parse.success) {
    return res
      .status(400)
      .json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    const resultado = await nfseService.emitirNfse(parse.data, pfxBuffer, password);
    // Salvar XML enviado (resultado.xmlEnviado) para download em homologação
    if (resultado.xmlEnviado) {
      const { TenantSettingsRepository } = require('../repositories/tenant.repository');
      const repo = new TenantSettingsRepository(tenantId);
      const filename = `nfse_emitida_${Date.now()}.xml`;
      const filePath = await repo.saveGeneratedXml(Buffer.from(resultado.xmlEnviado, 'utf-8'), filename);
      resultado.dados = resultado.dados || {};
      resultado.dados.xmlFilePath = filePath;
    }
    // Salvar XML de resposta (resultado.xmlResposta) para download em homologação
    if (resultado.xmlResposta) {
      const { TenantSettingsRepository } = require('../repositories/tenant.repository');
      const repo = new TenantSettingsRepository(tenantId);
      const filenameResp = `nfse_resposta_${Date.now()}.xml`;
      const filePathResp = await repo.saveGeneratedXml(Buffer.from(resultado.xmlResposta, 'utf-8'), filenameResp);
      resultado.xmlRespostaPath = filePathResp;
    }
    if (resultado.sucesso && parse.data.tomador) {
      const tenantId = req.tenantId || 'default-tenant-id';
      const client = await findOrCreateClient(tenantId, parse.data.tomador);
      if (client) {
        await salvarInvoice(tenantId, client, parse.data, resultado);
      }
    }
    return res.status(resultado.sucesso ? 200 : 422).json(resultado);
  } catch (err) {
    console.error('[EMITIR]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

/**
 * Emissão com layout completo, via GerarNfse (síncrono)
 */
async function emitirCompleto(req, res) {
  const parse = emissaoCompletaSchema.safeParse(req.body);
  if (!parse.success) {
    return res
      .status(400)
      .json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    const resultado = await nfseService.emitirNfseSincrono(parse.data, pfxBuffer, password);
    // Salvar XML enviado (resultado.xmlEnviado) para download em homologação
    if (resultado.xmlEnviado) {
      const { TenantSettingsRepository } = require('../repositories/tenant.repository');
      const repo = new TenantSettingsRepository(tenantId);
      const filename = `nfse_completa_${Date.now()}.xml`;
      const filePath = await repo.saveGeneratedXml(Buffer.from(resultado.xmlEnviado, 'utf-8'), filename);
      resultado.dados = resultado.dados || {};
      resultado.dados.xmlFilePath = filePath;
    }
    // Salvar XML de resposta (resultado.xmlResposta) para download em homologação
    if (resultado.xmlResposta) {
      const { TenantSettingsRepository } = require('../repositories/tenant.repository');
      const repo = new TenantSettingsRepository(tenantId);
      const filenameResp = `nfse_resposta_${Date.now()}.xml`;
      const filePathResp = await repo.saveGeneratedXml(Buffer.from(resultado.xmlResposta, 'utf-8'), filenameResp);
      resultado.xmlRespostaPath = filePathResp;
    }
    if (resultado.sucesso && parse.data.tomador) {
      const tenantId = req.tenantId || 'default-tenant-id';
      const client = await findOrCreateClient(tenantId, parse.data.tomador);
      if (client) {
        const invoice = await salvarInvoice(tenantId, client, parse.data, resultado);
        resultado.invoiceId = invoice.id;
      }
    }
    return res.status(resultado.sucesso ? 200 : 422).json(resultado);
  } catch (err) {
    console.error('[EMITIR COMPLETO]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

/**
 * Emissão via EnviarLoteRpsSincrono (lote síncrono)
 */
async function emitirLoteSincrono(req, res) {
  const parse = emissaoSchema.safeParse(req.body);
  if (!parse.success) {
    return res
      .status(400)
      .json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const { pfxBuffer, password } = await loadCert(tenantId);
    const resultado = await nfseService.emitirNfseLoteSincrono(parse.data, pfxBuffer, password);
    if (resultado.sucesso && parse.data.tomador) {
      const tenantId = req.tenantId || 'default-tenant-id';
      const client = await findOrCreateClient(tenantId, parse.data.tomador);
      if (client) {
        await salvarInvoice(tenantId, client, parse.data, resultado);
      }
    }
    return res.status(resultado.sucesso ? 200 : 422).json(resultado);
  } catch (err) {
    console.error('[EMITIR LOTE SINCRONO]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

async function consultarPorRps(req, res) {
  const parse = consultaRpsSchema.safeParse({
    numeroRps: Number(req.params.numero),
    serie: req.query.serie,
    tipo: req.query.tipo ? Number(req.query.tipo) : undefined,
  });
  if (!parse.success) {
    return res
      .status(400)
      .json({ erro: 'Parâmetros inválidos', detalhes: parse.error.flatten() });
  }

  try {
    const resultado = await nfseService.consultarPorRps(parse.data);
    return res.json(resultado);
  } catch (err) {
    console.error('[CONSULTAR RPS]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

async function consultarPorFaixa(req, res) {
  const numeroInicial = req.query.numeroInicial ?? req.query.inicio;
  const numeroFinal = req.query.numeroFinal ?? req.query.fim;
  const { pagina } = req.query;
  if (!numeroInicial || !numeroFinal) {
    return res
      .status(400)
      .json({ erro: 'numeroInicial/numeroFinal (ou inicio/fim) são obrigatórios' });
  }

  try {
    const resultado = await nfseService.consultarPorFaixa({
      numeroInicial: Number(numeroInicial),
      numeroFinal: Number(numeroFinal),
      pagina: pagina ? Number(pagina) : 1,
    });
    return res.json(resultado);
  } catch (err) {
    console.error('[CONSULTAR FAIXA]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

/**
 * Consulta de empresas autorizadas a emitir NFS-e (legado v1).
 * Alguns municípios não expõem esse método no endpoint ABRASF.
 */
async function consultarDadosCadastrais(req, res) {
  const { documento, inscricaoMunicipal } = req.query;
  try {
    const resultado = await nfseService.consultarDadosCadastrais({
      documento,
      inscricaoMunicipal,
    });
    return res.json(resultado);
  } catch (err) {
    console.error('[CONSULTAR DADOS CADASTRAIS]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

async function cancelar(req, res) {
  const parse = cancelamentoSchema.safeParse(req.body);
  if (!parse.success) {
    return res
      .status(400)
      .json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  try {
    const resultado = await nfseService.cancelarNfse(parse.data);
    return res.status(resultado.sucesso ? 200 : 422).json(resultado);
  } catch (err) {
    console.error('[CANCELAR]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

/**
 * Consulta SITUAÇÃO do lote (ConsultarSituacaoLoteRps)
 */
async function consultarSituacaoLote(req, res) {
  const { protocolo } = req.params;
  if (!protocolo) {
    return res.status(400).json({ erro: 'Protocolo é obrigatório' });
  }

  try {
    const resultado = await nfseService.consultarSituacaoLote({ protocolo });
    return res.json(resultado);
  } catch (err) {
    console.error('[SITUACAO LOTE]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

/**
 * Consulta LOTE de RPS (ConsultarLoteRps)
 * Retorna a lista de NFS-e geradas e mensagens de erro/lote.
 */
async function consultarLoteRps(req, res) {
  const { protocolo } = req.params;
  if (!protocolo) {
    return res.status(400).json({ erro: 'Protocolo é obrigatório' });
  }

  try {
    const resultado = await nfseService.consultarLoteRps({ protocolo });
    return res.json(resultado);
  } catch (err) {
    console.error('[CONSULTAR LOTE RPS]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

/**
 * Consulta NFS-e Serviços Prestados (ConsultarNfseServicoPrestado).
 * Lista todas as notas emitidas pelo prestador no período.
 */
async function consultarServicosPrestados(req, res) {
  const { dataInicial, dataFinal, pagina } = req.query;
  try {
    const resultado = await nfseService.consultarServicosPrestados({
      dataInicial,
      dataFinal,
      pagina: pagina ? Number(pagina) : 1,
    });
    return res.json(resultado);
  } catch (err) {
    console.error('[CONSULTAR SERVICOS PRESTADOS]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

/**
 * Consulta NFS-e Serviços Tomados (ConsultarNfseServicoTomado).
 * Lista todas as notas emitidas para o tomador no período.
 */
async function consultarServicosTomados(req, res) {
  const { cnpj, dataInicial, dataFinal, pagina } = req.query;
  try {
    const resultado = await nfseService.consultarServicosTomados({
      cnpj: cnpj || config.prestador.cnpj,
      dataInicial,
      dataFinal,
      pagina: pagina ? Number(pagina) : 1,
    });
    return res.json(resultado);
  } catch (err) {
    console.error('[CONSULTAR SERVICOS TOMADOS]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

/**
 * Substituição de NFS-e (SubstituirNfse)
 */
async function substituir(req, res) {
  const parse = substituicaoSchema.safeParse(req.body);
  if (!parse.success) {
    return res
      .status(400)
      .json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  try {
    const resultado = await nfseService.substituirNfse(parse.data);
    return res.status(resultado.sucesso ? 200 : 422).json(resultado);
  } catch (err) {
    console.error('[SUBSTITUIR]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

module.exports = {
   emitir,
   emitirCompleto,
   emitirLoteSincrono,
   consultarPorRps,
   consultarPorFaixa,
   cancelar,
   consultarSituacaoLote,
   consultarLoteRps,
   consultarServicosPrestados,
   consultarServicosTomados,
   consultarDadosCadastrais,
   substituir,
};
