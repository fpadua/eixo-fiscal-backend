const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function listar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const { page = 1, limit = 50, search } = req.query;
    const skip = (page - 1) * limit;

    const where = { tenantId, role: { not: 'master' } };
    if (search) {
      where.OR = [
        { nome: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        select: { id: true, email: true, nome: true, role: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error('[USUARIO] List error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function criar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const { email, password, nome, role } = req.body;
    const effectiveTenantId = role === 'master' ? null : tenantId;

    const existing = await prisma.user.findFirst({ where: { tenantId: effectiveTenantId, email } });
    if (existing) {
      return res.status(400).json({ erro: 'Email já cadastrado neste tenant' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { tenantId: effectiveTenantId, email, password: hashedPassword, nome, role: role || 'user', status: 'active' },
    });
    res.status(201).json(user);
  } catch (error) {
    console.error('[USUARIO] Create error:', error);
    if (error.code === 'P2002') return res.status(400).json({ erro: 'Email já cadastrado' });
    res.status(500).json({ erro: error.message });
  }
}

async function atualizar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const { id } = req.params;
    const { nome, role, status, password } = req.body;

    const user = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (user.role === 'master') return res.status(403).json({ erro: 'Não pode alterar usuário master' });

    const data = {};
    if (nome !== undefined) data.nome = nome;
    if (role !== undefined) data.role = role;
    if (status !== undefined) data.status = status;
    if (password) data.password = await bcrypt.hash(password, 10);

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, nome: true, role: true, status: true, createdAt: true },
    });

    res.json(updated);
  } catch (error) {
    console.error('[USUARIO] Update error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function deletar(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const { id } = req.params;

    const user = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (user.role === 'master') return res.status(403).json({ erro: 'Não pode desativar usuário master' });

    await prisma.user.update({ where: { id }, data: { status: 'inactive' } });

    res.json({ success: true, message: 'Usuário desativado' });
  } catch (error) {
    console.error('[USUARIO] Delete error:', error);
    res.status(500).json({ erro: error.message });
  }
}

module.exports = { listar, criar, atualizar, deletar };
