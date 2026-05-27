const { Router } = require('express');
const ctrl = require('../controllers/usuario.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { requirePermissao } = require('../middleware/plan.middleware');

const router = Router();

router.use(authMiddleware);
router.use(requireRole('admin'));
router.use(requirePermissao('gerenciar_usuarios'));

router.get('/', ctrl.listar);
router.post('/', ctrl.criar);
router.put('/:id', ctrl.atualizar);
router.delete('/:id', ctrl.deletar);

module.exports = router;
