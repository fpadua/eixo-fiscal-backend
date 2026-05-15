require('dotenv').config({ path: __dirname + '/../.env' });
const express = require('express');
const https = require('https');
const fs = require('fs');
const cors = require('cors');
const config = require('./config/nfse.config');
const nfseRoutes = require('./routes/nfse.routes');
const nfseRoutesV2 = require('./routes/v2/nfse.routes');
const clienteRoutes = require('./routes/cliente.routes');
const rascunhoRoutes = require('./routes/rascunho.routes');
const metricasRoutes = require('./routes/metricas.routes');
const uiConfigRoutes = require('./routes/ui-config.routes');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const invoiceRoutes = require('./routes/invoice.routes');
const planoRoutes = require('./routes/plano.routes');
const { tenantMiddleware } = require('./middleware/tenant.middleware');
const { authMiddleware } = require('./middleware/auth.middleware');

const { PrismaClient } = require('@prisma/client');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const prisma = new PrismaClient();

const app = express();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { erro: 'Muitas tentativas. Tente novamente em 15 minutos.', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      connectSrc: ["'self'", 'http://*.localhost:3000', 'http://localhost:3001', 'http://*.localhost:3001', process.env.FRONTEND_URL, 'https://*.vercel.app'].filter(Boolean),
    },
  },
}));
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || process.env.NODE_ENV === 'development') return callback(null, true);
    const allowed = [config.frontendUrl].filter(Boolean);
    // Aceitar qualquer subdomínio de localhost
    if (origin && /^https?:\/\/.*localhost:\d+$/.test(origin)) return callback(null, true);
    // Aceitar qualquer subdomínio do Vercel (testes)
    if (origin && /^https?:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return callback(null, true);
    if (allowed.includes(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Redirecionar HTTP → HTTPS em produção
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (!req.secure && req.get('x-forwarded-proto') !== 'https') {
      return res.redirect(307, `https://${req.get('host')}${req.url}`);
    }
    next();
  });
}

app.use((req, _res, next) => {
  req.prisma = prisma;
  next();
});

app.get('/health', async (_req, res) => {
  let dbStatus = 'desconectado';
  
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'conectado';
  } catch (e) {
    dbStatus = 'erro';
  }

  res.json({ status: 'ok', database: dbStatus });
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/nfse', tenantMiddleware, nfseRoutes);
app.use('/api/v2/nfse', tenantMiddleware, nfseRoutesV2);
app.use('/api/clientes', tenantMiddleware, clienteRoutes);
app.use('/api/rascunhos', tenantMiddleware, rascunhoRoutes);
app.use('/api/metricas', tenantMiddleware, metricasRoutes);
app.use('/api/config', tenantMiddleware, uiConfigRoutes);
app.use('/api/invoices', tenantMiddleware, invoiceRoutes);
app.use('/api/planos', tenantMiddleware, planoRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/testar-conexao', async (_req, res) => {
  const soapService = require('./services/soap.service');
  const resultado = await soapService.testarConexao();
  res.json(resultado);
});

app.use((_req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// Servidor HTTP
app.listen(config.port, () => {
  console.log(`\n🚀 NFS-e Backend [${config.version.toUpperCase()}] rodando em http://localhost:${config.port}`);
  console.log(`   Ambiente: ${config.homologacao ? '🧪 HOMOLOGAÇÃO (Nota Control)' : config.isMock ? '⚠️  MOCK (sem certificado .pfx)' : '✅ PRODUÇÃO (com certificado)'}`);
  console.log(`   tpAmb:    ${config.tpAmb} (${config.homologacao ? 'Homologação' : 'Produção'})`);
  console.log(`   Endpoint: ${config.endpoint}`);
  console.log(`   Health:   http://localhost:${config.port}/health\n`);
  console.log(`   Database: ${process.env.DATABASE_URL ? 'configurado' : 'NÃO CONFIGURADO'}\n`);
});

// Servidor HTTPS (opcional — requer certificado)
const sslCertPath = process.env.SSL_CERT_PATH;
const sslKeyPath = process.env.SSL_KEY_PATH;
if (sslCertPath && sslKeyPath && fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath)) {
  const sslOptions = {
    cert: fs.readFileSync(sslCertPath),
    key: fs.readFileSync(sslKeyPath),
  };
  const sslPort = process.env.SSL_PORT || 3443;
  https.createServer(sslOptions, app).listen(sslPort, () => {
    console.log(`   🔒 HTTPS:  https://localhost:${sslPort}`);
  });
}

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});