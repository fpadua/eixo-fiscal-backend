const { Router } = require('express');
const ctrl = require('../controllers/plano.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const { requirePermissao } = require('../middleware/plan.middleware');

const router = Router();

router.use(authMiddleware);

router.get('/', ctrl.listar);
router.post('/:id/assinar', requirePermissao('meu_plano'), ctrl.assinar);

module.exports = router;