const { Router } = require('express');
const multer = require('multer');
const ctrl = require('../controllers/ui-config.controller');
const companyCtrl = require('../controllers/company.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const { requirePermissao } = require('../middleware/plan.middleware');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router();

router.use(authMiddleware);
router.use(requirePermissao('configuracoes'));

router.get('/nfse-ui', ctrl.getConfig);
router.put('/nfse-ui', ctrl.updateConfig);
router.post('/certificate', upload.single('certificate'), companyCtrl.uploadCertificate);
router.get('/certificate', companyCtrl.getCertificateInfo);
router.get('/certificate/expiration', companyCtrl.getCertExpiration);
router.put('/certificate/alert-days', companyCtrl.updateCertAlertDays);
router.get('/tenant', companyCtrl.getTenantInfo);
router.put('/tenant', companyCtrl.updateTenant);

module.exports = router;

