const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const UserRepository = require('../../repositories/user.repository');

const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[FATAL] JWT_SECRET não configurado. Encerrando.');
    process.exit(1);
  }
  return secret;
})();

function validarSenha(senha) {
  const erros = [];
  if (senha.length < 8) erros.push('mínimo 8 caracteres');
  if (!/[A-Z]/.test(senha)) erros.push('uma letra maiúscula');
  if (!/\d/.test(senha)) erros.push('um número');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(senha)) erros.push('um símbolo');
  return erros;
}

class AuthService {
  constructor(tenantId) {
    this.tenantId = tenantId;
    this.userRepository = new UserRepository(tenantId);
  }

  async login(email, password) {
    let user = this.tenantId
      ? await this.userRepository.findByEmail(email)
      : await this.userRepository.findByEmailGlobal(email);

    if (!user && this.tenantId) {
      const globalUser = await this.userRepository.findByEmailGlobal(email);
      if (globalUser?.role === 'master' && !globalUser.tenantId) {
        user = globalUser;
      }
    }
    
    if (!user) {
      return { success: false, error: 'Credenciais inválidas' };
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return { success: false, error: 'Credenciais inválidas' };
    }

    if (user.status === 'pending') {
      return { success: false, error: 'Email não verificado. Verifique sua caixa de entrada.' };
    }

    if (user.status !== 'active') {
      return { success: false, error: 'Credenciais inválidas' };
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        tokenVersion: user.tokenVersion,
      },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { id: user.id, tokenVersion: user.tokenVersion },
      JWT_SECRET + '_refresh',
      { expiresIn: '7d' }
    );

    return {
      success: true,
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        nome: user.nome,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }

  async register(data) {
    const erros = validarSenha(data.password);
    if (erros.length > 0) {
      return { success: false, error: `Senha inválida: ${erros.join(', ')}.` };
    }

    const existingUser = await this.userRepository.findByEmail(data.email);
    
    if (existingUser) {
      return { success: false, error: 'Não foi possível completar o cadastro.' };
    }

    if (this.tenantId) {
      const prisma = require('../../lib/prisma');
      const tenant = await prisma.tenant.findUnique({
        where: { id: this.tenantId },
        include: { plan: true, _count: { select: { users: { where: { status: 'active' } } } } },
      });

      if (tenant?.plan && tenant.plan.maxUsuarios > 0) {
        if (tenant._count.users >= tenant.plan.maxUsuarios) {
          return { success: false, error: `Limite de ${tenant.plan.maxUsuarios} usuários do plano atingido.` };
        }
      }
    }

    // Criar usuário com status 'pending' — precisa verificar email
    const user = await this.userRepository.create({
      ...data,
      status: 'pending',
    });

    // Gerar token de verificação (24h)
    const verifyToken = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET + '_verify',
      { expiresIn: '24h' }
    );

    // URL de verificação
    const baseUrl = process.env.FRONTEND_URL || `http://localhost:3000`;
    const verifyUrl = `${baseUrl}/auth/verify?token=${verifyToken}`;

    // Log da URL de verificação (útil em dev sem serviço de email)
    console.log(`[EMAIL] Verificação: ${verifyUrl}`);

    // Tentar enviar email se Resend estiver configurado
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
              first_name: data.nome,
              verification_url: verifyUrl,
            },
          };
        } else {
          emailPayload.html = `<p>Olá ${data.nome},</p><p>Confirme seu cadastro clicando no link abaixo:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>Este link expira em 24 horas.</p>`;
        }

        const emailResp = await resend.emails.send(emailPayload);
      }
    } catch (emailErr) {
      console.warn('[EMAIL] Falha ao enviar email:', emailErr.message);
    }

    return {
      success: true,
      user: { id: user.id, email: user.email, nome: user.nome, role: user.role },
      verifyUrl,
    };
  }

  async getProfile(userId) {
    const user = await this.userRepository.findById(userId);
    
    if (!user) {
      return { success: false, error: 'Usuário não encontrado' };
    }

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        nome: user.nome,
        role: user.role,
        tenantId: user.tenantId,
        tenant: user.tenant,
      },
    };
  }

  async changePassword(userId, oldPassword, newPassword) {
    const erros = validarSenha(newPassword);
    if (erros.length > 0) {
      return { success: false, error: `Senha inválida: ${erros.join(', ')}.` };
    }

    const user = await this.userRepository.findById(userId);
    
    if (!user) {
      return { success: false, error: 'Usuário não encontrado' };
    }

    const isValid = await bcrypt.compare(oldPassword, user.password);
    
    if (!isValid) {
      return { success: false, error: 'Senha atual incorreta' };
    }

    await this.userRepository.updatePassword(userId, newPassword);

    return { success: true, message: 'Senha alterada com sucesso' };
  }

  async verifyEmail(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET + '_verify');
      const prisma = require('../../lib/prisma');

      const user = await prisma.user.findUnique({ where: { id: decoded.id } });
      if (!user) return { success: false, error: 'Usuário não encontrado' };
      if (user.status !== 'pending') return { success: false, error: 'Conta já verificada' };

      await prisma.user.update({
        where: { id: decoded.id },
        data: { status: 'active' },
      });

      return { success: true, message: 'Email verificado com sucesso!' };
    } catch {
      return { success: false, error: 'Link de verificação inválido ou expirado' };
    }
  }

  async refreshAccessToken(refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, JWT_SECRET + '_refresh');
      const user = await this.userRepository.findById(decoded.id);
      if (!user || user.tokenVersion !== decoded.tokenVersion) {
        return { success: false, error: 'Refresh token inválido' };
      }

      const newToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId, tokenVersion: user.tokenVersion },
        JWT_SECRET,
        { expiresIn: '15m' }
      );

      return { success: true, token: newToken };
    } catch {
      return { success: false, error: 'Refresh token inválido ou expirado' };
    }
  }

  async revokeTokens(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user) return { success: false, error: 'Usuário não encontrado' };

    const prisma = require('../../lib/prisma');
    await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });

    return { success: true, message: 'Sessões revogadas' };
  }
}

module.exports = AuthService;
