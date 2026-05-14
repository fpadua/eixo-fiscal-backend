const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[FATAL] JWT_SECRET não configurado. Encerrando.');
    process.exit(1);
  }
  return secret;
})();

const prisma = new PrismaClient();

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ erro: 'Token não fornecido', code: 'AUTH_REQUIRED' });
    }

    const token = authHeader.substring(7);

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ erro: 'Token expirado', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ erro: 'Token inválido', code: 'TOKEN_INVALID' });
    }

    // Verificar tokenVersion no banco
    if (decoded.tokenVersion !== undefined) {
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { tokenVersion: true, status: true },
      });
      if (!user) {
        return res.status(401).json({ erro: 'Usuário não encontrado', code: 'USER_NOT_FOUND' });
      }
      if (user.status !== 'active') {
        return res.status(401).json({ erro: 'Usuário inativo', code: 'USER_INACTIVE' });
      }
      if (user.tokenVersion !== decoded.tokenVersion) {
        return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.', code: 'TOKEN_REVOKED' });
      }
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenantId: decoded.tenantId,
    };

    if (!req.tenantId && decoded.tenantId) {
      req.tenantId = decoded.tenantId;
    }

    next();
  } catch (error) {
    console.error('[AUTH_MIDDLEWARE] Erro:', error);
    return res.status(500).json({ erro: 'Erro de autenticação', code: 'AUTH_ERROR' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ erro: 'Usuário não autenticado', code: 'AUTH_REQUIRED' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ erro: 'Permissão insuficiente', code: 'FORBIDDEN' });
    }

    next();
  };
}

module.exports = { authMiddleware, requireRole };