const prisma = require('../lib/prisma');

class ClientRepository {
  constructor(tenantId) {
    this.tenantId = tenantId;
  }

  async findById(id) {
    return prisma.client.findFirst({
      where: { id, tenantId: this.tenantId },
    });
  }

  async findByCpfCnpj(cpfCnpj) {
    return prisma.client.findFirst({
      where: { tenantId: this.tenantId, cpfCnpj },
    });
  }

  async findAll(options = {}) {
    const { page = 1, limit = 50, search, tipoPessoa } = options;
    const skip = (page - 1) * limit;

    const where = { tenantId: this.tenantId };
    
    if (search) {
      where.OR = [
        { nomeRazaoSocial: { contains: search, mode: 'insensitive' } },
        { cpfCnpj: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    
    if (tipoPessoa) {
      where.tipoPessoa = tipoPessoa;
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.client.count({ where }),
    ]);

    return { clients, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async create(data) {
    const tipoPessoa = data.cpfCnpj?.length === 14 ? 'PJ' : 'PF';
    return prisma.client.create({
      data: {
        tenantId: this.tenantId,
        tipoPessoa: data.tipoPessoa || tipoPessoa,
        nomeRazaoSocial: data.nomeRazaoSocial,
        cpfCnpj: data.cpfCnpj,
        email: data.email,
        telefone: data.telefone,
        endereco: data.endereco || {},
        dataCadastro: new Date(),
      },
    });
  }

  async update(id, data) {
    return prisma.client.update({
      where: { id, tenantId: this.tenantId },
      data,
    });
  }

  async delete(id) {
    const count = await prisma.invoice.count({
      where: { clientId: id, tenantId: this.tenantId },
    });

    if (count > 0) {
      throw new Error('Cliente possui notas fiscais asociadas. Não é possível excluir.');
    }

    return prisma.client.delete({
      where: { id, tenantId: this.tenantId },
    });
  }

  async count() {
    return prisma.client.count({ where: { tenantId: this.tenantId } });
  }

  async findByEmail(email) {
    return prisma.client.findFirst({
      where: { tenantId: this.tenantId, email },
    });
  }
}

module.exports = ClientRepository;