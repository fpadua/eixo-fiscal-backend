const express = require('express');
const router = express.Router();
const controller = require('../../controllers/v2/nfse.controller');
const { planGuard, requirePermissao } = require('../../middleware/plan.middleware');
const { authMiddleware } = require('../../middleware/auth.middleware');

router.use(authMiddleware);

router.post('/emitir-completo', planGuard, controller.gerarNfse);
router.post('/lote/sincrono', planGuard, controller.enviarLoteDpsSincrono);
router.post('/lote', planGuard, controller.recepcionarLoteDps);
router.get('/consultar/lote/:protocolo', requirePermissao('consultar_status'), controller.consultarLoteDps);
router.get('/consultar/situacao-lote/:protocolo', requirePermissao('consultar_status'), controller.consultarSituacaoLote);
router.get('/consultar/dps/:numero', requirePermissao('consultar_status'), controller.consultarNfsePorDps);
router.get('/consultar/faixa', requirePermissao('consultar_status'), controller.consultarNfsePorFaixa);
router.get('/consultar/prestados', requirePermissao('consultar_status'), controller.consultarNfseServicoPrestado);
router.get('/consultar/tomados', requirePermissao('consultar_status'), controller.consultarNfseServicoTomado);
router.post('/cancelar', requirePermissao('cancelar_substituir'), controller.cancelarNfse);
router.post('/substituir', requirePermissao('cancelar_substituir'), controller.substituirNfse);
router.get('/consultar/url/:numero', requirePermissao('consultar_status'), controller.consultarUrlNfse);
router.get('/dados-cadastrais', requirePermissao('consultar_status'), controller.consultarDadosCadastrais);
router.get('/dps-disponivel', controller.consultarDpsDisponivel);
router.get('/catalogo-fiscal', controller.catalogoFiscal);

module.exports = router;
