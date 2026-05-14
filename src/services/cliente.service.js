const ClientRepository = require('../repositories/client.repository');

function getClientRepository(tenantId) {
  return new ClientRepository(tenantId);
}

async function listar(tenantId) {
  const repo = getClientRepository(tenantId);
  return repo.findAll({ limit: 1000 });
}

async function buscarPorId(id, tenantId) {
  const repo = getClientRepository(tenantId);
  return repo.findById(id);
}

async function criar(dados, tenantId) {
  const repo = getClientRepository(tenantId);
  return repo.create(dados);
}

async function atualizar(id, dados, tenantId) {
  const repo = getClientRepository(tenantId);
  return repo.update(id, dados);
}

async function deletar(id, tenantId) {
  const repo = getClientRepository(tenantId);
  return repo.delete(id);
}

module.exports = { listar, buscarPorId, criar, atualizar, deletar };