const { Router } = require('express');
const ctrl = require('../controllers/plano.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

const router = Router();

router.use(authMiddleware);

router.get('/', ctrl.listar);
router.post('/:id/assinar', ctrl.assinar);

module.exports = router;