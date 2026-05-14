const { Router } = require('express');
const ctrl = require('../controllers/invoice.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

const router = Router();

router.use(authMiddleware);

router.get('/', ctrl.listar);
router.get('/plan-status', ctrl.planStatus);
router.get('/estatisticas', ctrl.estatisticas);
router.get('/cliente/:clientId', ctrl.listarPorCliente);
router.get('/:id', ctrl.buscar);

module.exports = router;