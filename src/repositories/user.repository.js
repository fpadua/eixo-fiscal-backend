const bcrypt = require('bcryptjs');

const prisma = require('../lib/prisma');

class UserRepository {
  constructor(tenantId) {
    this.tenantId = tenantId;
  }

  async findById(id) {
    return prisma.user.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { tenant: true },
    });
  }

  async findByEmail(email) {
    return prisma.user.findFirst({
      where: { tenantId: this.tenantId, email },
      include: { tenant: true },
    });
  }

  async findByEmailGlobal(email) {
    return prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });
  }

  async validatePassword(email, password) {
    const user = await this.findByEmailGlobal(email);
    if (!user || user.tenantId !== this.tenantId) return null;
    
    const isValid = await bcrypt.compare(password, user.password);
    return isValid ? user : null;
  }

  async findAll(options = {}) {
    const { page = 1, limit = 50, status } = options;
    const skip = (page - 1) * limit;

    const where = { tenantId: this.tenantId };
    if (status) where.status = status;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          nome: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    return { users, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async create(data) {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    return prisma.user.create({
      data: {
        tenantId: this.tenantId,
        email: data.email,
        password: hashedPassword,
        nome: data.nome,
        role: data.role || 'user',
        status: data.status || 'active',
      },
    });
  }

  async update(id, data) {
    const updateData = { ...data };
    delete updateData.password;
    delete updateData.email;

    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    return prisma.user.update({
      where: { id, tenantId: this.tenantId },
      data: updateData,
    });
  }

  async updatePassword(id, newPassword) {
    const hashed = await bcrypt.hash(newPassword, 10);
    return prisma.user.update({
      where: { id, tenantId: this.tenantId },
      data: { password: hashed },
    });
  }

  async delete(id) {
    return prisma.user.update({
      where: { id, tenantId: this.tenantId },
      data: { status: 'inactive' },
    });
  }

  async count() {
    return prisma.user.count({ where: { tenantId: this.tenantId, status: 'active' } });
  }
}

module.exports = UserRepository;