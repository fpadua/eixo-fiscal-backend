function masterAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ erro: 'Não autenticado', code: 'AUTH_REQUIRED' });
  }
  if (req.user.role !== 'master') {
    return res.status(403).json({ erro: 'Acesso restrito ao administrador master', code: 'MASTER_REQUIRED' });
  }
  next();
}

module.exports = { masterAuth };