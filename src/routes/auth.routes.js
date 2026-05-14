const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth/auth.controller');
const companyCtrl = require('../controllers/company.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const { tenantMiddleware } = require('../middleware/tenant.middleware');

router.post('/login', tenantMiddleware, authController.login);
router.post('/register', authController.register);
router.get('/verify', authController.verifyEmail);
router.post('/refresh', authController.refreshToken);
router.get('/profile', authMiddleware, authController.profile);
router.post('/change-password', authMiddleware, authController.changePassword);
router.post('/revoke-tokens', authMiddleware, authController.revokeTokens);
router.post('/tenant/register', companyCtrl.registrarTenant);

module.exports = router;