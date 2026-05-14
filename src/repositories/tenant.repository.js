const crypto = require('crypto');

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
      const encryptionKey = this.getEncryptionKey();

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
        const pwdBuffer = Buffer.isBuffer(settings.certificatePassword)
          ? settings.certificatePassword
          : Buffer.from(settings.certificatePassword);

        const ivPwd = pwdBuffer.subarray(0, 16);
        const pwdData = pwdBuffer.subarray(16);
        const decipherPwd = crypto.createDecipheriv('aes-256-cbc', encryptionKey, ivPwd);
        decryptedPassword = Buffer.concat([
          decipherPwd.update(pwdData),
          decipherPwd.final()
        ]).toString('utf8');
      }

      return {
        certificateContent: decryptedContent,
        certificatePassword: decryptedPassword,
        certificateType: settings.certificateType,
      };
    } catch (error) {
      console.error('[TenantSettings] Erro ao descriptografar certificado:', error);
      return null;
    }
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