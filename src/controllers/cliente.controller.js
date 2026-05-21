const { z } = require('zod');
const clienteService = require('../services/cliente.service');

const clienteSchema = z.object({
  documento: z.string().min(11).max(14),
  razaoSocial: z.string().min(2),
  inscricaoMunicipal: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  telefone: z.string().optional(),
  endereco: z.object({
    logradouro: z.string(),
    numero: z.string(),
    complemento: z.string().optional(),
    bairro: z.string(),
    localidade: z.string().optional(),
    codigoMunicipio: z.string().optional(),
    uf: z.string().length(2).default('GO'),
    cep: z.string(),
  }).optional(),
});

function mapToLegacy(client) {
  if (!client) return null;
  return {
    id: client.id,
    documento: client.cpfCnpj,
    razaoSocial: client.nomeRazaoSocial,
    email: client.email,
    telefone: client.telefone,
    inscricaoMunicipal: client.inscricaoMunicipal,
    endereco: client.endereco,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

function mapToDb(data) {
  return {
    nomeRazaoSocial: data.razaoSocial,
    cpfCnpj: data.documento,
    inscricaoMunicipal: data.inscricaoMunicipal,
    email: data.email,
    telefone: data.telefone,
    endereco: data.endereco,
  };
}

async function listar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const result = await clienteService.listar(tenantId);
    const clientes = Array.isArray(result) ? result : result.clients || [];
    res.json(clientes.map(mapToLegacy));
  } catch (error) {
    console.error('[CLIENTE] Error listing:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function buscar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const cliente = await clienteService.buscarPorId(req.params.id, tenantId);
    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });
    res.json(mapToLegacy(cliente));
  } catch (error) {
    console.error('[CLIENTE] Error fetching:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function criar(req, res) {
  const parse = clienteSchema.safeParse({
    ...req.body,
    documento: req.body.documento?.replace(/\D/g, ''),
  });
  if (!parse.success) return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });

  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const dbData = mapToDb(parse.data);
    const novo = await clienteService.criar(dbData, tenantId);
    res.status(201).json(mapToLegacy(novo));
  } catch (error) {
    console.error('[CLIENTE] Error creating:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ erro: 'CPF/CNPJ já cadastrado' });
    }
    res.status(500).json({ erro: error.message });
  }
}

async function atualizar(req, res) {
  const parse = clienteSchema.safeParse({
    ...req.body,
    documento: req.body.documento?.replace(/\D/g, ''),
  });
  if (!parse.success) return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });

  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const dbData = mapToDb(parse.data);
    const atualizado = await clienteService.atualizar(req.params.id, dbData, tenantId);
    if (!atualizado) return res.status(404).json({ erro: 'Cliente não encontrado' });
    res.json(mapToLegacy(atualizado));
  } catch (error) {
    console.error('[CLIENTE] Error updating:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function deletar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    await clienteService.deletar(req.params.id, tenantId);
    res.status(204).send();
  } catch (error) {
    console.error('[CLIENTE] Error deleting:', error);
    if (error.code === 'P2003' || error.message.includes('foreign key')) {
      return res.status(400).json({ erro: 'Cliente possui notas fiscais associadas. Não é possível excluir.' });
    }
    res.status(500).json({ erro: error.message });
  }
}

module.exports = { listar, buscar, criar, atualizar, deletar };