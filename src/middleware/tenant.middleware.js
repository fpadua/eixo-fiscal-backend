const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[FATAL] JWT_SECRET não configurado. Encerrando.');
    process.exit(1);
  }
  return secret;
})();

function extractSubdomain(host) {
  if (!host) return null;

  const cleanHost = host.split(':')[0];

  // Se for um IP (só dígitos e pontos), não tem subdomínio
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cleanHost)) return null;

  const parts = cleanHost.split('.');

  if (parts.length >= 3) {
    return parts[0];
  }

  if (parts.length === 2 && parts[0] !== 'localhost' && parts[0] !== '127') {
    return parts[0];
  }

  return null;
}

async function tenantMiddleware(req, res, next) {
  try {
    const host = req.get('host') || '';
    const subdomain = extractSubdomain(host);
    const prisma = require('../lib/prisma');

    let tenantId = null;

    if (subdomain && subdomain !== 'localhost') {
      const tenant = await prisma.tenant.findUnique({
        where: { subdomain },
        include: { settings: true },
      });

      if (!tenant) {
        return res.status(404).json({ erro: 'Tenant não encontrado', code: 'TENANT_NOT_FOUND' });
      }

      if (tenant.status !== 'active') {
        return res.status(403).json({ erro: 'Tenant inativo', code: 'TENANT_INACTIVE' });
      }

      tenantId = tenant.id;
      req.tenant = tenant;
    } else {
      tenantId = req.headers['x-tenant-id'];

      if (!tenantId && req.user && req.user.tenantId) {
        tenantId = req.user.tenantId;
      }

      if (!tenantId) {
        tenantId = 'default-tenant-id';
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { settings: true },
      });

      if (!tenant) {
        return res.status(404).json({ erro: 'Tenant não encontrado', code: 'TENANT_NOT_FOUND' });
      }

      req.tenant = tenant;
    }

    req.tenantId = tenantId;

    // Se o usuário já está autenticado (JWT), validar que o tenant do token
    // corresponde ao tenant identificado pelo subdomínio
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
        if (decoded.tenantId && decoded.tenantId !== tenantId) {
          return res.status(403).json({ erro: 'Acesso negado: usuário não pertence a este tenant', code: 'TENANT_MISMATCH' });
        }
        req.user = decoded;
      } catch (e) {
        // Token inválido ou expirado, ignora (authMiddleware cuidará disso)
      }
    }

    next();
  } catch (error) {
    console.error('[TENANT_MIDDLEWARE] Erro:', error);
    return res.status(500).json({ erro: 'Erro ao identificar tenant', code: 'TENANT_ERROR' });
  }
}

module.exports = { tenantMiddleware, extractSubdomain };