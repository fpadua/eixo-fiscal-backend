const AuthService = require('../../services/auth/auth.service');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validarEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
    }

    if (!validarEmail(email)) {
      return res.status(400).json({ erro: 'Email inválido' });
    }

    const authService = new AuthService(req.tenantId);
    const result = await authService.login(email, password);

    if (!result.success) {
      return res.status(401).json({ erro: result.error });
    }

    res.json({
      success: true,
      token: result.token,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({ erro: 'Erro ao processar login' });
  }
}

async function register(req, res) {
  try {
    const { email, password, nome } = req.body;

    if (!email || !password || !nome) {
      return res.status(400).json({ erro: 'Email, senha e nome são obrigatórios' });
    }

    if (!validarEmail(email)) {
      return res.status(400).json({ erro: 'Email inválido' });
    }

    if (password.length < 8) {
      return res.status(400).json({ erro: 'Senha deve ter no mínimo 8 caracteres' });
    }

    const authService = new AuthService(req.tenantId);
    const result = await authService.register({ email, password, nome });

    if (!result.success) {
      return res.status(400).json({ erro: result.error });
    }

    res.status(201).json({
      success: true,
      user: result.user,
    });
  } catch (error) {
    console.error('[AUTH] Register error:', error);
    res.status(500).json({ erro: 'Erro ao processar cadastro' });
  }
}

async function profile(req, res) {
  try {
    const authService = new AuthService(req.tenantId);
    const result = await authService.getProfile(req.user.id);

    if (!result.success) {
      return res.status(404).json({ erro: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('[AUTH] Profile error:', error);
    res.status(500).json({ erro: 'Erro ao buscar perfil' });
  }
}

async function changePassword(req, res) {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ erro: 'Senha atual e nova senha são obrigatórias' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ erro: 'Nova senha deve ter pelo menos 6 caracteres' });
    }

    const authService = new AuthService(req.tenantId);
    const result = await authService.changePassword(req.user.id, oldPassword, newPassword);

    if (!result.success) {
      return res.status(400).json({ erro: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('[AUTH] Change password error:', error);
    res.status(500).json({ erro: 'Erro ao alterar senha' });
  }
}

async function refreshToken(req, res) {
  const authService = new AuthService(req.tenantId);
  const result = await authService.refreshAccessToken(req.body.refreshToken);
  if (!result.success) {
    return res.status(401).json({ erro: result.error });
  }
  res.json({ token: result.token });
}

async function revokeTokens(req, res) {
  try {
    const authService = new AuthService(req.tenantId);
    const result = await authService.revokeTokens(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('[AUTH] Revoke error:', error);
    res.status(500).json({ erro: error.message });
  }
}

async function verifyEmail(req, res) {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ erro: 'Token não fornecido' });

    const authService = new AuthService();
    const result = await authService.verifyEmail(token);

    if (!result.success) {
      return res.status(400).json({ erro: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('[AUTH] Verify error:', error);
    res.status(500).json({ erro: error.message });
  }
}

module.exports = { login, register, profile, changePassword, refreshToken, revokeTokens, verifyEmail };