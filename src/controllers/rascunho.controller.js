const { z } = require('zod');
const rascunhoService = require('../services/rascunho.service');

const rascunhoSchema = z.object({
  nome: z.string().min(1).optional().default('Rascunho'),
  dados: z.record(z.any()),
});

async function listar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const rascunhos = await rascunhoService.listar(tenantId);
    res.json(rascunhos);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

async function buscar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const rascunho = await rascunhoService.buscarPorId(req.params.id, tenantId);
    if (!rascunho) return res.status(404).json({ erro: 'Rascunho não encontrado' });
    res.json(rascunho);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

async function criar(req, res) {
  const parse = rascunhoSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });

  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const novo = await rascunhoService.criar(parse.data, tenantId);
    res.status(201).json(novo);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

async function atualizar(req, res) {
  const parse = rascunhoSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });

  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const atualizado = await rascunhoService.atualizar(req.params.id, parse.data, tenantId);
    if (!atualizado) return res.status(404).json({ erro: 'Rascunho não encontrado' });
    res.json(atualizado);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

async function deletar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const sucesso = await rascunhoService.deletar(req.params.id, tenantId);
    if (!sucesso) return res.status(404).json({ erro: 'Rascunho não encontrado' });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
}

module.exports = { listar, buscar, criar, atualizar, deletar };