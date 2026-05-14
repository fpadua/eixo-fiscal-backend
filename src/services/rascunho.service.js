const DraftRepository = require('../repositories/draft.repository');

function getRepo(tenantId) {
  return new DraftRepository(tenantId);
}

async function listar(tenantId) {
  return getRepo(tenantId).listar();
}

async function buscarPorId(id, tenantId) {
  return getRepo(tenantId).buscarPorId(id);
}

async function criar(dados, tenantId) {
  return getRepo(tenantId).criar(dados);
}

async function atualizar(id, dados, tenantId) {
  return getRepo(tenantId).atualizar(id, dados);
}

async function deletar(id, tenantId) {
  return getRepo(tenantId).deletar(id);
}

module.exports = { listar, buscarPorId, criar, atualizar, deletar };