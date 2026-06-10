const { Router } = require('express');
const ctrl = require('../controllers/pagamento.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

const router = Router();

router.post('/webhook', ctrl.webhook);
router.post('/criar', authMiddleware, ctrl.criar);
router.post('/enviar-pix-email', authMiddleware, ctrl.enviarPixEmail);

module.exports = router;
