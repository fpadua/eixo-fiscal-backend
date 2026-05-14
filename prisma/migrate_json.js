const fs = require('fs/promises');
const path = require('path');

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const TENANT_ID = 'default-tenant-id';
const DATA_DIR = path.join(__dirname, '../data');

async function migrate() {
  console.log('[MIGRATION] Iniciando migração de dados JSON → PostgreSQL...\n');

  try {
    const tenantExists = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });

    if (!tenantExists) {
      console.error('[MIGRATION] ❌ Tenant padrão não encontrado. Execute o seed primeiro: npm run db:seed');
      process.exit(1);
    }

    console.log('[MIGRATION] ✅ Tenant encontrado:', tenantExists.razaoSocial);

    await migrateClients();
    await migrateRascunhos();
    await migrateDrafts();

    console.log('\n[MIGRATION] ✅ Migração concluída com sucesso!');
  } catch (error) {
    console.error('[MIGRATION] ❌ Erro durante migração:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function migrateClients() {
  const clientsPath = path.join(DATA_DIR, 'clientes.json');

  try {
    const data = await fs.readFile(clientsPath, 'utf-8');
    const clients = JSON.parse(data || '[]');

    console.log(`[MIGRATION] Migrando ${clients.length} clientes...`);

    let migrated = 0;
    let skipped = 0;

    for (const client of clients) {
      const existing = await prisma.client.findFirst({
        where: { tenantId: TENANT_ID, cpfCnpj: client.documento },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await prisma.client.create({
        data: {
          tenantId: TENANT_ID,
          tipoPessoa: client.documento?.length === 14 ? 'PJ' : 'PF',
          nomeRazaoSocial: client.razaoSocial || 'Sem nome',
          cpfCnpj: client.documento,
          email: client.email,
          telefone: client.telefone,
          endereco: client.endereco || {},
          dataCadastro: client.createdAt ? new Date(client.createdAt) : new Date(),
        },
      });
      migrated++;
    }

    console.log(`[MIGRATION] ✅ Clientes migrados: ${migrated} (ignorados: ${skipped})`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('[MIGRATION] ℹ️  Arquivo clientes.json não encontrado, pulando...');
      return;
    }
    throw error;
  }
}

async function migrateRascunhos() {
  const rascunhosPath = path.join(DATA_DIR, 'rascunhos.json');

  try {
    const data = await fs.readFile(rascunhosPath, 'utf-8');
    const rascunhos = JSON.parse(data || '[]');

    console.log(`[MIGRATION] Migrando ${rascunhos.length} rascunhos...`);

    let migrated = 0;
    let skipped = 0;

    for (const rascunho of rascunhos) {
      if (!rascunho.clientId && !rascunho.cpfCnpj) {
        console.warn('[MIGRATION] ⚠️ Rascunho sem cliente, pulando:', rascunho.id);
        skipped++;
        continue;
      }

      let clientId = rascunho.clientId;

      if (!clientId && rascunho.cpfCnpj) {
        const client = await prisma.client.findFirst({
          where: { tenantId: TENANT_ID, cpfCnpj: rascunho.cpfCnpj },
        });
        clientId = client?.id;
      }

      if (!clientId) {
        const newClient = await prisma.client.create({
          data: {
            tenantId: TENANT_ID,
            tipoPessoa: rascunho.cpfCnpj?.length === 14 ? 'PJ' : 'PF',
            nomeRazaoSocial: rascunho.tomadorNome || 'Cliente Importado',
            cpfCnpj: rascunho.cpfCnpj || '00000000000000',
            email: rascunho.tomadorEmail,
            telefone: rascunho.tomadorTelefone,
            endereco: {},
          },
        });
        clientId = newClient.id;
      }

      await prisma.invoice.create({
        data: {
          tenantId: TENANT_ID,
          clientId,
          numeroNota: rascunho.numeroRps,
          serie: rascunho.serie || 'A',
          tipoNfse: 'NFS-e',
          status: 'rascunho',
          xmlEnviado: rascunho.xmlEnviado,
          valorTotal: rascunho.servicoValor,
          dataEmissao: rascunho.dataEmissao ? new Date(rascunho.dataEmissao) : null,
        },
      });
      migrated++;
    }

    console.log(`[MIGRATION] ✅ Rascunhos migrados: ${migrated} (ignorados: ${skipped})`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('[MIGRATION] ℹ️  Arquivo rascunhos.json não encontrado, pulando...');
      return;
    }
    throw error;
  }
}

async function migrateDrafts() {
  const draftsPath = path.join(DATA_DIR, 'rascunhos.json');

  try {
    const data = await fs.readFile(draftsPath, 'utf-8');
    const drafts = JSON.parse(data || '[]');

    console.log(`[MIGRATION] Migrando ${drafts.length} rascunhos de formulário...`);

    let migrated = 0;
    for (const draft of drafts) {
      await prisma.draft.create({
        data: {
          tenantId: TENANT_ID,
          nome: draft.nome || 'Rascunho',
          formData: draft.dados || {},
          createdAt: draft.createdAt ? new Date(draft.createdAt) : new Date(),
          updatedAt: draft.updatedAt ? new Date(draft.updatedAt) : new Date(),
        },
      });
      migrated++;
    }

    console.log(`[MIGRATION] ✅ Rascunhos de formulário migrados: ${migrated}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('[MIGRATION] ℹ️  Arquivo rascunhos.json não encontrado (formulário), pulando...');
      return;
    }
    throw error;
  }
}

migrate();