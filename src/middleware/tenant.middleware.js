const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[FATAL] JWT_SECRET não configurado. Encerrando.');
    process.exit(1);
  }
  return secret;
})();

const ROOT_DOMAINS = [
  'onrender.com',
  'vercel.app',
  'netlify.app',
  'herokuapp.com',
  'fly.dev',
  'railway.app',
  'ngrok-free.app',
  'ngrok.io',
];

function extractSubdomain(host) {
  if (!host) return null;

  const cleanHost = host.split(':')[0];

  // Se for um IP (só dígitos e pontos), não tem subdomínio
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cleanHost)) return null;

  // Se for um domínio de plataforma de hospedagem conhecida, não extrair subdomínio
  if (ROOT_DOMAINS.some(d => cleanHost.endsWith(d))) return null;

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
    const headerSubdomain = req.get('x-subdomain');
    const subdomain = headerSubdomain || extractSubdomain(host);
    const prisma = require('../lib/prisma');

    let tenantId = null;

    if (subdomain && subdomain !== 'localhost') {
      const tenant = await prisma.tenant.findUnique({
        where: { subdomain },
        include: { settings: true },
      });

      if (tenant) {
        if (tenant.status !== 'active') {
          return res.status(403).json({ erro: 'Tenant inativo', code: 'TENANT_INACTIVE' });
        }
        if (tenant.planStatus === 'pendente') {
          return res.status(403).json({ erro: 'Plano pendente de pagamento', code: 'PLAN_PENDING' });
        }
        tenantId = tenant.id;
        req.tenant = tenant;
      } else {
        console.log(`[TENANT_DEBUG] Subdominio "${subdomain}" nao encontrado no banco. Tentando fallback...`);
      }
    }

    // Se não encontrou por subdomínio (ou é localhost), tenta por body/email
    if (!tenantId) {
      console.log('[TENANT_DEBUG] Buscando tenant por outros meios (body/email/header)...');
      
      // 1. Pelo body (tenant ou subdomain direto)
      if (req.body && (req.body.tenant || req.body.subdomain)) {
        const bodySubdomain = (req.body.tenant || req.body.subdomain).toLowerCase().trim();
        const tenant = await prisma.tenant.findUnique({
          where: { subdomain: bodySubdomain },
          include: { settings: true },
        });
        if (tenant) {
          tenantId = tenant.id;
          req.tenant = tenant;
        }
      }

      // 2. Pelo E-mail (Fundamental para ngrok/túneis)
      if (!tenantId && req.body && req.body.email) {
        const user = await prisma.user.findUnique({
          where: { email: req.body.email.toLowerCase().trim() },
          select: { tenantId: true }
        });
        if (user && user.tenantId) {
          const tenant = await prisma.tenant.findUnique({
            where: { id: user.tenantId },
            include: { settings: true },
          });
          if (tenant) {
            tenantId = tenant.id;
            req.tenant = tenant;
          }
        }
      }

      // 3. Headers
      if (!tenantId) {
        tenantId = req.headers['x-tenant-id'];
      }
    }

    // 4. Tenta extrair tenantId do JWT (usuário autenticado)
    if (!tenantId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
          if (decoded.tenantId) {
            tenantId = decoded.tenantId;
            req.user = decoded;
          }
        } catch (e) {
          // Token inválido ou expirado, ignora (authMiddleware cuidará disso)
        }
      }
    }

    // Fallback final para 'default-tenant-id' se ninguém foi identificado
    if (!tenantId) {
      tenantId = 'default-tenant-id';
    }

    if (!req.tenant) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { settings: true },
      });

      if (!tenant) {
        const path = req.originalUrl || req.url;
        const isAuthRoute = path.includes('/auth/') || path.includes('/login') || path.includes('/register');
        
        if (!isAuthRoute) {
          return res.status(404).json({ erro: 'Cliente não encontrado', code: 'TENANT_NOT_FOUND' });
        }
      } else {
        req.tenant = tenant;
      }
    }

    req.tenantId = tenantId;

    // Se o usuário foi identificado via JWT acima, já validamos. Caso contrário,
    // se houver JWT e a validação de tenantId falhar, negar acesso.
    if (!req.user) {
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
    }

    next();
  } catch (error) {
    console.error('[TENANT_MIDDLEWARE] Erro:', error);
    return res.status(500).json({ erro: 'Erro ao identificar tenant', code: 'TENANT_ERROR' });
  }
}

module.exports = { tenantMiddleware, extractSubdomain };