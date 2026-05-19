const express = require('express');
const router = express.Router();
const controller = require('../../controllers/v2/nfse.controller');
const { planGuard } = require('../../middleware/plan.middleware');
const { authMiddleware } = require('../../middleware/auth.middleware');

router.use(authMiddleware);

router.post('/emitir-completo', planGuard, controller.gerarNfse);
router.post('/lote/sincrono', planGuard, controller.enviarLoteDpsSincrono);
router.post('/lote', planGuard, controller.recepcionarLoteDps);
router.get('/consultar/lote/:protocolo', controller.consultarLoteDps);
router.get('/consultar/situacao-lote/:protocolo', controller.consultarSituacaoLote);
router.get('/consultar/dps/:numero', controller.consultarNfsePorDps);
router.get('/consultar/faixa', controller.consultarNfsePorFaixa);
router.get('/consultar/prestados', controller.consultarNfseServicoPrestado);
router.get('/consultar/tomados', controller.consultarNfseServicoTomado);
router.post('/cancelar', controller.cancelarNfse);
router.post('/substituir', controller.substituirNfse);
router.get('/consultar/url/:numero', controller.consultarUrlNfse);
router.get('/dados-cadastrais', controller.consultarDadosCadastrais);
router.get('/dps-disponivel', controller.consultarDpsDisponivel);

module.exports = router;
