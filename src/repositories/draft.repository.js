const prisma = require('../lib/prisma');

class DraftRepository {
  constructor(tenantId) {
    this.tenantId = tenantId;
  }

  async listar() {
    return prisma.draft.findMany({
      where: { tenantId: this.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async buscarPorId(id) {
    return prisma.draft.findFirst({
      where: { id, tenantId: this.tenantId },
    });
  }

  async criar(dados) {
    return prisma.draft.create({
      data: {
        tenantId: this.tenantId,
        nome: dados.nome || 'Rascunho',
        formData: dados.dados || {},
      },
    });
  }

  async atualizar(id, dados) {
    return prisma.draft.update({
      where: { id, tenantId: this.tenantId },
      data: {
        nome: dados.nome,
        formData: dados.dados,
      },
    });
  }

  async deletar(id) {
    try {
      await prisma.draft.delete({
        where: { id, tenantId: this.tenantId },
      });
      return true;
    } catch {
      return false;
    }
  }

  async count() {
    return prisma.draft.count({ where: { tenantId: this.tenantId } });
  }
}

module.exports = DraftRepository;