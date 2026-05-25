const { TenantSettingsRepository, TenantRepository } = require('../repositories/tenant.repository');
const UserRepository = require('../repositories/user.repository');
const { z } = require('zod');
const forge = require('node-forge');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function extractCertExpiry(pfxBuffer, password) {
  try {
    const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
    for (const safeContent of p12.safeContents) {
      for (const safeBag of safeContent.safeBags) {
        if (safeBag.type === forge.pki.oids.certBag && safeBag.cert) {
          return safeBag.cert.validity.notAfter;
        }
      }
    }
  } catch (e) {
    console.warn('[CERT] Erro ao extrair validade do certificado:', e.message);
  }
  return null;
}

async function uploadCertificate(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const file = req.file;
    const { password, certificateType } = req.body;

    if (!file) {
      return res.status(400).json({ erro: 'Arquivo de certificado não enviado' });
    }

    if (!password) {
      return res.status(400).json({ erro: 'Senha do certificado é obrigatória' });
    }

    const certExpiresAt = extractCertExpiry(file.buffer, password);
    const settingsRepo = new TenantSettingsRepository(tenantId);
    await settingsRepo.updateCertificate(file.buffer, password, certificateType || 'A1', certExpiresAt);
    // salvar arquivo .pfx na pasta /certs/<cnpj>/
    const fs = require('fs');
    const path = require('path');
    const tenantRepo = new TenantRepository();
    const tenant = await tenantRepo.findById(tenantId);
    if (tenant && tenant.cnpj) {
      const cnpjClean = tenant.cnpj.replace(/\D/g, '');
      const dir = path.join(__dirname, '..', '..', 'certs', cnpjClean);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${cnpjClean}.pfx`);
      fs.writeFileSync(filePath, file.buffer);
    }

    res.json({ success: true, message: 'Certificado salvo com sucesso' });
  } catch (error) {
    console.error('[CERT] Upload error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function getCertificateInfo(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const settingsRepo = new TenantSettingsRepository(tenantId);
    const cert = await settingsRepo.decryptCertificate();

    if (!cert) {
      return res.json({ hasCertificate: false });
    }

    let info = { hasCertificate: true, certificateType: cert.certificateType };

    try {
      const forge = require('node-forge');
      const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(cert.certificateContent));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, cert.certificatePassword);

      for (const safeContent of p12.safeContents) {
        for (const safeBag of safeContent.safeBags) {
          if (safeBag.type === forge.pki.oids.certBag && safeBag.cert) {
            const c = safeBag.cert;

            const rawCn = c.subject.attributes.find(a => a.name === 'commonName')?.value || '';
            const cnParts = rawCn.split(':');
            info.subject = cnParts[0] || rawCn;
            info.cnpj = cnParts.length > 1 ? cnParts.slice(1).join(':') : null;

            if (!info.cnpj) {
              info.cnpj = c.subject.attributes.find(a => a.name === 'organizationName')?.value
                || c.subject.attributes.find(a => a.shortName === 'O')?.value
                || null;
            }

            if (info.cnpj) {
              info.cnpj = info.cnpj.replace(/\D/g, '');
            }

            info.issuer = c.issuer.attributes.find(a => a.name === 'commonName')?.value;
            info.validFrom = c.validity.notBefore;
            info.validTo = c.validity.notAfter;
            break;
          }
        }
      }
    } catch (e) {
      console.warn('[CERT] Could not extract cert info:', e.message);
    }

    res.json(info);
  } catch (error) {
    console.error('[CERT] Get info error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function getCertExpiration(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const settingsRepo = new TenantSettingsRepository(tenantId);
    const settings = await settingsRepo.find();
    const features = settings?.features || {};
    const alertDays = parseInt(features.certAlertDays || process.env.CERT_ALERT_DAYS || '30', 10);

    let expiresAt = settings?.certExpiresAt;
    if (!expiresAt && settings?.certificateContent) {
      try {
        const cert = await settingsRepo.decryptCertificate();
        if (cert) {
          const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(cert.certificateContent));
          const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, cert.certificatePassword);
          for (const sc of p12.safeContents) {
            for (const sb of sc.safeBags) {
              if (sb.type === forge.pki.oids.certBag && sb.cert) {
                expiresAt = sb.cert.validity.notAfter;
                break;
              }
            }
          }
        }
      } catch (e) {
        console.warn('[CERT] Fallback expiry extraction failed:', e.message);
      }
    }

    if (!expiresAt) {
      return res.json({ hasCertificate: false, alertDays });
    }

    const expiresDate = new Date(expiresAt);
    const now = new Date();
    const diffMs = expiresDate.getTime() - now.getTime();
    const daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const expired = diffMs <= 0;
    const expiringSoon = !expired && daysLeft <= alertDays;

    res.json({
      hasCertificate: true,
      expiresAt: expiresDate.toISOString(),
      daysLeft,
      expired,
      expiringSoon,
      alertDays,
      expiresFormatted: expiresDate.toLocaleDateString('pt-BR'),
    });
  } catch (error) {
    console.error('[CERT] Expiration error:', error);
    res.status(500).json({ erro: error.message });
  }
}

const cadastroSchema = z.object({
  subdomain: z.string().min(3).max(50),
  razaoSocial: z.string().min(2),
  nomeFantasia: z.string().optional(),
  cnpj: z.string().min(14).max(18),
  inscricaoMunicipal: z.string().optional(),
  ie: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(6),
  endereco: z.object({
    logradouro: z.string().optional(),
    numero: z.string().optional(),
    complemento: z.string().optional(),
    bairro: z.string().optional(),
    cidade: z.string().optional(),
    codigoMunicipio: z.string().optional(),
    uf: z.string().length(2).optional(),
    cep: z.string().optional(),
  }).optional(),
});

async function registrarTenant(req, res) {
  const parse = cadastroSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
  }

  try {
    const data = parse.data;
    const tenantRepo = new TenantRepository();

    const existingTenant = await tenantRepo.findBySubdomain(data.subdomain);
    if (existingTenant) {
      return res.status(400).json({ erro: 'Subdomínio já cadastrado' });
    }

    const tenant = await tenantRepo.create({
      subdomain: data.subdomain,
      razaoSocial: data.razaoSocial,
      nomeFantasia: data.nomeFantasia,
      cnpj: data.cnpj.replace(/\D/g, ''),
      inscricaoMunicipal: data.inscricaoMunicipal,
      ie: data.ie,
      endereco: data.endereco || {},
      settings: {
        nfseVersion: 'v2',
        ambiente: 'homologacao',
      },
    });

    const userRepo = new UserRepository(tenant.id);
    const user = await userRepo.create({
      email: data.email,
      password: data.password,
      nome: data.razaoSocial,
      role: 'admin',
      status: 'pending',
    });

    // Gerar token de verificação (24h)
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET não configurado');
    const verifyToken = jwt.sign(
      { id: user.id, email: user.email },
      jwtSecret + '_verify',
      { expiresIn: '24h' }
    );

    const baseUrl = `http://${tenant.subdomain}.localhost:3000`;
    const verifyUrl = `${baseUrl}/auth/verify?token=${verifyToken}`;

    console.log(`[REGISTER] URL de verificação: ${verifyUrl}`);

    // Tentar enviar email via Resend
    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        const { Resend } = require('resend');
        const resend = new Resend(resendKey);
        const fromAddr = process.env.EMAIL_FROM || 'onboarding@resend.dev';
        const templateId = process.env.RESEND_TEMPLATE_ID;

        const emailPayload = {
          from: fromAddr,
          to: user.email,
          subject: 'Confirme seu cadastro — NFS-e',
        };

        if (templateId) {
          emailPayload.template = {
            id: templateId,
            variables: {
              first_name: data.razaoSocial,
              verification_url: verifyUrl,
            },
          };
        } else {
          emailPayload.html = `<p>Olá ${data.razaoSocial},</p><p>Confirme seu cadastro clicando no link abaixo:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>Este link expira em 24 horas.</p>`;
        }

        const emailResp = await resend.emails.send(emailPayload);
        console.log('[REGISTER] Resend resposta:', JSON.stringify(emailResp));
        if (emailResp?.error) {
          console.warn('[REGISTER] Resend erro:', emailResp.error.message || emailResp.error);
        }
      }
    } catch (emailErr) {
      console.warn('[REGISTER] Falha ao enviar email (verifique RESEND_API_KEY):', emailErr.message);
    }

    res.status(201).json({
      success: true,
      tenant: { id: tenant.id, subdomain: tenant.subdomain, razaoSocial: tenant.razaoSocial },
      user: { id: user.id, email: user.email, status: 'pending' },
      verifyUrl,
    });
  } catch (error) {
    console.error('[REGISTER] Error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ erro: 'CNPJ já cadastrado' });
    }
    res.status(500).json({ erro: error.message });
  }
}

async function getTenantInfo(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const settingsRepo = new TenantSettingsRepository(tenantId);
    const settings = await settingsRepo.find();
    const features = settings?.features || {};
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) return res.status(404).json({ erro: 'Tenant não encontrado' });
    res.json({
      razaoSocial: tenant.razaoSocial,
      nomeFantasia: tenant.nomeFantasia,
      cnpj: tenant.cnpj,
      inscricaoMunicipal: tenant.inscricaoMunicipal,
      ie: tenant.ie,
      subdomain: tenant.subdomain,
      nfseVersion: settings?.nfseVersion || 'v2',
      ambiente: settings?.ambiente || 'homologacao',
      cidade: tenant.endereco?.cidade || tenant.endereco?.localidade || '',
      endereco: tenant.endereco || {},
    });
  } catch (error) {
    console.error('[TENANT] Info error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function updateCertAlertDays(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const { days } = req.body;
    const val = parseInt(days, 10);
    if (isNaN(val) || val < 1 || val > 365) {
      return res.status(400).json({ erro: 'Dias deve ser entre 1 e 365' });
    }
    const settingsRepo = new TenantSettingsRepository(tenantId);
    const features = (await settingsRepo.find())?.features || {};
    features.certAlertDays = val;
    await settingsRepo.updateFeatures(features);
    res.json({ success: true, certAlertDays: val });
  } catch (error) {
    console.error('[CERT] Update alert days error:', error);
    res.status(500).json({ erro: error.message });
  }
}

const updateTenantSchema = z.object({
  razaoSocial: z.string().min(2).optional(),
  nomeFantasia: z.string().optional(),
  cnpj: z.string().optional(),
  inscricaoMunicipal: z.string().optional(),
  ie: z.string().optional(),
  endereco: z.object({
    logradouro: z.string().optional(),
    numero: z.string().optional(),
    complemento: z.string().optional(),
    bairro: z.string().optional(),
    cidade: z.string().optional(),
    codigoMunicipio: z.string().optional(),
    uf: z.string().length(2).optional(),
    cep: z.string().optional(),
  }).optional(),
});

async function updateTenant(req, res) {
  try {
    const tenantId = req.tenantId || 'default-tenant-id';
    const parse = updateTenantSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() });
    }
    const data = parse.data;
    const tenantRepo = new TenantRepository();
    const updated = await tenantRepo.update(tenantId, {
      ...data,
      cnpj: data.cnpj?.replace(/\D/g, ''),
    });
    res.json({
      success: true,
      tenant: {
        id: updated.id,
        subdomain: updated.subdomain,
        razaoSocial: updated.razaoSocial,
        nomeFantasia: updated.nomeFantasia,
        cnpj: updated.cnpj,
        inscricaoMunicipal: updated.inscricaoMunicipal,
        ie: updated.ie,
      },
    });
  } catch (error) {
    console.error('[TENANT] Update error:', error);
    if (error.code === 'P2002') return res.status(400).json({ erro: 'CNPJ já cadastrado' });
    res.status(500).json({ erro: error.message });
  }
}

module.exports = { uploadCertificate, getCertificateInfo, getCertExpiration, updateCertAlertDays, getTenantInfo, updateTenant, registrarTenant };
