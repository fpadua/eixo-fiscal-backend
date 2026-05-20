const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: __dirname + '/../.env' });

const prisma = new PrismaClient();

async function main() {
  console.log('[SEED] Iniciando criação de dados padrão...\n');

  // 1. Planos
  const planos = [
    { nome: 'Free', slug: 'free', precoMensal: 0, limiteNotas: 10, maxUsuarios: 1, features: ['emitir_nfse'] },
    { nome: 'Basic', slug: 'basic', precoMensal: 49.90, limiteNotas: 100, maxUsuarios: 2, features: ['emitir_nfse'] },
    { nome: 'Pro', slug: 'pro', precoMensal: 99.90, limiteNotas: 1000, maxUsuarios: 5, features: ['emitir_nfse', 'modulo_financeiro'] },
    { nome: 'Premium', slug: 'premium', precoMensal: 297, limiteNotas: 5000, maxUsuarios: 10, features: ['emitir_nfse', 'modulo_financeiro', 'api_integracao'] },
    { nome: 'Enterprise', slug: 'enterprise', precoMensal: 0, limiteNotas: 0, maxUsuarios: 999, features: ['emitir_nfse', 'modulo_financeiro', 'api_integracao', 'suporte_prioritario'] },
  ];

  for (const p of planos) {
    await prisma.plan.upsert({
      where: { slug: p.slug },
      update: p,
      create: p,
    });
  }
  console.log('[SEED] ✅ Planos criados/verificados');

  // 2. Tenant padrão com plano Pro
  const tenantId = 'default-tenant-id';
  const defaultUserEmail = process.env.DEFAULT_USER_EMAIL || 'admin@empresa.com';
  const defaultUserPassword = process.env.DEFAULT_USER_PASSWORD || 'admin123';

  const planPro = await prisma.plan.findUnique({ where: { slug: 'pro' } });

  const tenant = await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: {
      id: tenantId,
      subdomain: 'default',
      status: 'active',
      razaoSocial: process.env.RAZAO_SOCIAL || 'Empresa Padrão NFSe',
      nomeFantasia: 'Empresa Padrão',
      cnpj: process.env.CNPJ_PRESTADOR || '00000000000000',
      inscricaoMunicipal: process.env.INSCRICAO_MUNICIPAL || '000000',
      ie: process.env.IE || '',
      endereco: {},
      planId: planPro.id,
      planStatus: 'active',
      planInicio: new Date(),
    },
  });
  console.log('[SEED] ✅ Tenant criado/verificado:', tenant.razaoSocial);

  await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      certificateType: 'A1',
      certificateContent: null,
      certificatePassword: null,
      nfseVersion: process.env.NFSE_VERSION || 'v2',
      ambiente: process.env.NFSE_HOMOLOGACAO === 'true' ? 'homologacao' : 'producao',
      features: { emitir_nfse: true, modulo_financeiro: false, modulo_estoque: false },
      apiKeys: {},
    },
  });
  console.log('[SEED] ✅ TenantSettings criado/verificado');

  const hashedPassword = await bcrypt.hash(defaultUserPassword, 10);
  await prisma.user.upsert({
    where: { email: defaultUserEmail },
    update: {},
    create: {
      tenantId: tenant.id,
      email: defaultUserEmail,
      password: hashedPassword,
      nome: 'Administrador',
      role: 'admin',
      status: 'active',
    },
  });
  console.log('[SEED] ✅ Usuário admin criado/verificado:', defaultUserEmail);

  // 3. Usuário master (super admin)
  const masterEmail = process.env.MASTER_EMAIL || 'master@admin.com';
  const masterPassword = process.env.MASTER_PASSWORD || 'master@123456';

  await prisma.user.upsert({
    where: { email: masterEmail },
    update: {},
    create: {
      id: 'master-user-id',
      tenantId: tenant.id,
      email: masterEmail,
      password: await bcrypt.hash(masterPassword, 10),
      nome: 'Master Administrador',
      role: 'master',
      status: 'active',
    },
  });
  console.log('[SEED] ✅ Usuário master criado/verificado:', masterEmail);

  console.log('\n[SEED] ✅ Seed completo!');
  console.log('[SEED] Login master: POST /api/auth/login');
  console.log('[SEED] { "email": "' + masterEmail + '", "password": "' + masterPassword + '" }');
}

main()
  .catch((e) => {
    console.error('[SEED] ❌ Erro durante seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
