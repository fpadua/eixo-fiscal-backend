const { Router } = require('express');
const ctrl = require('../controllers/rascunho.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const { requirePermissao } = require('../middleware/plan.middleware');

const router = Router();

router.use(authMiddleware);
router.use(requirePermissao('rascunho'));

router.get('/', ctrl.listar);
router.get('/:id', ctrl.buscar);
router.post('/', ctrl.criar);
router.put('/:id', ctrl.atualizar);
router.delete('/:id', ctrl.deletar);

module.exports = router;