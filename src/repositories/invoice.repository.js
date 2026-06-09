const prisma = require('../lib/prisma');

class InvoiceRepository {
  constructor(tenantId) {
    this.tenantId = tenantId;
  }

  async findById(id) {
    return prisma.invoice.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { client: true },
    });
  }

  async findByChaveAcesso(chaveAcesso) {
    return prisma.invoice.findFirst({
      where: { tenantId: this.tenantId, chaveAcesso },
    });
  }

  async findByNumero(numeroNota, serie = 'A') {
    return prisma.invoice.findFirst({
      where: { tenantId: this.tenantId, numeroNota, serie },
    });
  }

  async findAll(options = {}) {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      clientId, 
      dataInicio, 
      dataFim 
    } = options;
    const skip = (page - 1) * limit;

    const where = { tenantId: this.tenantId };

    if (status) {
      where.status = status;
    }

    if (clientId) {
      where.clientId = clientId;
    }

    if (dataInicio || dataFim) {
      where.dataEmissao = {};
      if (dataInicio) where.dataEmissao.gte = new Date(dataInicio);
      if (dataFim) where.dataEmissao.lte = new Date(dataFim);
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          tenantId: true,
          clientId: true,
          numeroNota: true,
          serie: true,
          tipoNfse: true,
          status: true,
          xmlEnviado: true,
          xmlRetorno: true,
          chaveAcesso: true,
          valorTotal: true,
          dataEmissao: true,
          urlImpressao: true,
          protocolo: true,
          createdAt: true,
          client: true,
        },
      }),
      prisma.invoice.count({ where }),
    ]);

    return { invoices, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async create(data) {
    return prisma.invoice.create({
      data: {
        tenantId: this.tenantId,
        clientId: data.clientId,
        numeroNota: data.numeroNota,
        serie: data.serie || 'A',
        tipoNfse: data.tipoNfse || 'NFS-e',
        status: data.status || 'rascunho',
        xmlEnviado: data.xmlEnviado,
        xmlRetorno: data.xmlRetorno,
        chaveAcesso: data.chaveAcesso,
        valorTotal: data.valorTotal,
        dataEmissao: data.dataEmissao,
        urlImpressao: data.urlImpressao,
        protocolo: data.protocolo,
      },
      include: { client: true },
    });
  }

  async update(id, data) {
    return prisma.invoice.update({
      where: { id, tenantId: this.tenantId },
      data,
      include: { client: true },
    });
  }

  async updateStatus(id, status, extraData = {}) {
    return prisma.invoice.update({
      where: { id, tenantId: this.tenantId },
      data: { status, ...extraData },
    });
  }

  async delete(id) {
    return prisma.invoice.delete({
      where: { id, tenantId: this.tenantId },
    });
  }

  async countByStatus() {
    const result = await prisma.invoice.groupBy({
      by: ['status'],
      where: { tenantId: this.tenantId },
      _count: true,
    });

    return result.reduce((acc, item) => {
      acc[item.status] = item._count;
      return acc;
    }, {});
  }

  async getStatistics(dataInicio, dataFim) {
    const where = { tenantId: this.tenantId };

    if (dataInicio || dataFim) {
      where.dataEmissao = {};
      if (dataInicio) where.dataEmissao.gte = new Date(dataInicio);
      if (dataFim) where.dataEmissao.lte = new Date(dataFim);
    }

    const [total, emitadas, canceladas, rascunhos] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.count({ where: { ...where, status: 'emitida' } }),
      prisma.invoice.count({ where: { ...where, status: 'cancelada' } }),
      prisma.invoice.count({ where: { ...where, status: 'rascunho' } }),
    ]);

    const resultado = await prisma.invoice.aggregate({
      where,
      _sum: { valorTotal: true },
    });

    return {
      total,
      emitadas,
      canceladas,
      rascunhos,
      valorTotal: resultado._sum.valorTotal || 0,
    };
  }
}

module.exports = InvoiceRepository;