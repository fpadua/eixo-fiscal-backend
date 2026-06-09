const { Router } = require('express');
const ctrl = require('../controllers/admin.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const { masterAuth } = require('../middleware/master.middleware');

const router = Router();

router.use(authMiddleware, masterAuth);

router.get('/dashboard', ctrl.dashboard);
router.get('/tenants', ctrl.listarTenants);
router.put('/tenants/:id', ctrl.atualizarTenant);
router.put('/tenants/:id/nfse-ui', ctrl.atualizarTenantNfseUi);
router.get('/usuarios', ctrl.listarUsuarios);
router.put('/usuarios/:id', ctrl.atualizarUsuario);
router.get('/configuracoes', ctrl.getConfiguracoes);
router.get('/relatorios', ctrl.relatoriosDashboard);
router.get('/planos', ctrl.listarPlanos);
router.post('/planos', ctrl.criarPlano);
router.put('/planos/:id', ctrl.atualizarPlano);
router.delete('/planos/:id', ctrl.deletarPlano);
router.get('/pagamentos', ctrl.listarPagamentos);

module.exports = router;