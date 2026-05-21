const crypto = require('crypto');
const forge = require('node-forge'); // Adicione esta linha para importar a biblioteca

const prisma = require('../lib/prisma');

class TenantRepository {
  async findById(id) {
    return prisma.tenant.findUnique({
      where: { id },
      include: { settings: true },
    });
  }

  async findBySubdomain(subdomain) {
    return prisma.tenant.findUnique({
      where: { subdomain },
      include: { settings: true },
    });
  }

  async findAll(options = {}) {
    const { page = 1, limit = 50, status } = options;
    const skip = (page - 1) * limit;

    const where = status ? { status } : {};

    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        include: { _count: { select: { users: true, clients: true, invoices: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.tenant.count({ where }),
    ]);

    return { tenants, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async create(data) {
    return prisma.tenant.create({
      data: {
        subdomain: data.subdomain,
        status: data.status || 'active',
        razaoSocial: data.razaoSocial,
        nomeFantasia: data.nomeFantasia,
        cnpj: data.cnpj,
        inscricaoMunicipal: data.inscricaoMunicipal,
        ie: data.ie,
        endereco: data.endereco || {},
        logoUrl: data.logoUrl,
        settings: data.settings ? {
          create: data.settings,
        } : undefined,
      },
      include: { settings: true },
    });
  }

  async update(id, data) {
    return prisma.tenant.update({
      where: { id },
      data,
      include: { settings: true },
    });
  }

  async delete(id) {
    return prisma.tenant.update({
      where: { id },
      data: { status: 'inactive' },
    });
  }

  async updateSettings(tenantId, settingsData) {
    return prisma.tenantSettings.upsert({
      where: { tenantId },
      update: settingsData,
      create: { tenantId, ...settingsData },
    });
  }
}

class TenantSettingsRepository {
  constructor(tenantId) {
    this.tenantId = tenantId;
  }

  async find() {
    return prisma.tenantSettings.findUnique({
      where: { tenantId: this.tenantId },
    });
  }

  async update(data) {
    return prisma.tenantSettings.upsert({
      where: { tenantId: this.tenantId },
      update: data,
      create: { tenantId: this.tenantId, ...data },
    });
  }

  async getEncryptionKey() {
    const key = process.env.CERT_ENCRYPTION_KEY;
    if (!key) {
      throw new Error('CERT_ENCRYPTION_KEY não configurada');
    }
    return require('crypto').createHash('sha256').update(key).digest();
  }

  async updateCertificate(certificateContent, certificatePassword, certificateType = 'A1', certExpiresAt) {
    const encryptionKey = await this.getEncryptionKey();

    const ivCert = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, ivCert);
    const encryptedContent = Buffer.concat([
      ivCert,
      cipher.update(Buffer.from(certificateContent)),
      cipher.final()
    ]);

    const ivPwd = crypto.randomBytes(16);
    const cipherPwd = crypto.createCipheriv('aes-256-cbc', encryptionKey, ivPwd);
    const encryptedPassword = Buffer.concat([
      ivPwd,
      cipherPwd.update(Buffer.from(certificatePassword || '')),
      cipherPwd.final()
    ]).toString('base64');

    return prisma.tenantSettings.upsert({
      where: { tenantId: this.tenantId },
      update: {
        certificateType,
        certificateContent: encryptedContent,
        certificatePassword: encryptedPassword,
        certExpiresAt,
      },
      create: {
        tenantId: this.tenantId,
        certificateType,
        certificateContent: encryptedContent,
        certificatePassword: encryptedPassword,
        certExpiresAt,
      },
    });
  }

  async decryptCertificate() {
    const settings = await this.find();

    if (!settings?.certificateContent) {
      return null;
    }

    try {
      const encryptionKey = await this.getEncryptionKey();

      const encryptedBuffer = Buffer.isBuffer(settings.certificateContent)
        ? settings.certificateContent
        : Buffer.from(settings.certificateContent);

      const iv = encryptedBuffer.subarray(0, 16);
      const data = encryptedBuffer.subarray(16);

      const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
      const decryptedContent = Buffer.concat([
        decipher.update(data),
        decipher.final()
      ]);

      let decryptedPassword = '';
      if (settings.certificatePassword) {
        let pwdBuffer;
        if (settings.certificatePassword) {
          const base64Str = typeof settings.certificatePassword === 'string'
            ? settings.certificatePassword
            : settings.certificatePassword.toString();
          pwdBuffer = Buffer.from(base64Str, 'base64');
        } else {
          pwdBuffer = null;
        }

        if (pwdBuffer) {
          const ivPwd = pwdBuffer.subarray(0, 16);
          const pwdData = pwdBuffer.subarray(16);
          const decipherPwd = crypto.createDecipheriv('aes-256-cbc', encryptionKey, ivPwd);
          decryptedPassword = Buffer.concat([
            decipherPwd.update(pwdData),
            decipherPwd.final()
          ]).toString('utf8');
        }
      }

      // Validação da senha do PKCS#12 usando node-forge
      try {
        // Tenta decodificar o PKCS#12. Se a senha estiver incorreta, a biblioteca lançará um erro.
        // Primeiro, converte o Buffer para uma string binária que o forge pode interpretar.
        const binaryString = decryptedContent.toString('binary');
        const asn1 = forge.asn1.fromDer(forge.util.createBuffer(binaryString));
        // Usa a API correta de node-forge para importar PKCS#12.
        // Se a senha estiver errada, uma exceção será lançada aqui.
        forge.pkcs12.pkcs12FromAsn1(asn1, false, decryptedPassword);
        console.log('[CERT] Senha do certificado PKCS#12 validada com sucesso.');
      } catch (p12Error) {
        console.error('[CERT] Erro na validação da senha do PKCS#12:', p12Error.message);
        // Lança um erro específico para que o chamador possa tratá-lo
        throw new Error('Senha do certificado PKCS#12 inválida.');
      }

      return {
        certificateContent: decryptedContent,
        certificatePassword: decryptedPassword,
        certificateType: settings.certificateType,
      };
    } catch (error) {
      console.error('[TenantSettings] Erro ao descriptografar certificado:', error);
      // Propaga o erro para que o nfsecontroller possa capturá-lo
      throw error; // Importante para que o erro seja tratado no controller
    }
  }

  async saveGeneratedXml(xmlBuffer, filename) {
    const path = require('path');
    const fs = require('fs');
    const storageDir = path.resolve(__dirname, '..', '..', 'storage', 'xml');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    const timestamp = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(storageDir, `${this.tenantId}_${timestamp}_${safeName}`);
    fs.writeFileSync(filePath, xmlBuffer);
    return filePath;
  }

  async getFeatures() {
    const settings = await this.find();
    return settings?.features || {};
  }

  async updateFeatures(features) {
    return prisma.tenantSettings.update({
      where: { tenantId: this.tenantId },
      data: { features },
    });
  }
}

module.exports = { TenantRepository, TenantSettingsRepository };