const { Router } = require('express');
const ctrl = require('../controllers/nfse.controller');
const soapService = require('../services/soap.service');
const xmlService = require('../services/xml.service');
const signService = require('../services/sign.service');
const { planGuard } = require('../middleware/plan.middleware');
const { authMiddleware } = require('../middleware/auth.middleware');

const router = Router();

router.use(authMiddleware);

// ─── Emissão ─────────────────────────────────────────────────────────────────
router.post('/emitir', planGuard, ctrl.emitir);
router.post('/emitir-completo', planGuard, ctrl.emitirCompleto);
router.post('/emitir-lote-sincrono', planGuard, ctrl.emitirLoteSincrono);
router.post('/lote/sincrono', planGuard, ctrl.emitirLoteSincrono);

// ─── Testes / Diagnóstico ───────────────────────────────────────────────────
// router.post('/testar-validador', async (req, res) => {
//   try {
//     // Gera um XML mínimo em EnviarLoteRpsEnvio
//     const dadosTeste = {
//       rps: {
//         numero: 1,
//         serie: 'A1',
//         tipo: 1,
//         dataEmissao: '2025-05-06T00:00:00-03:00',
//         status: 1,
//       },
//       servico: {
//         valorServicos: 100,
//         valorDeducoes: 0,
//         valorPis: 0,
//         valorCofins: 0,
//         valorInss: 0,
//         valorIr: 0,
//         valorCsll: 0,
//         issRetido: false,
//         valorIss: 0,
//         outrasRetencoes: 0,
//         aliquota: 0,
//         itemListaServico: '0102',
//         discriminacao: 'Teste',
//         codigoMunicipio: '5208707',
//         exigibilidadeIss: 1,
//       },
//       tomador: null,
//       optanteSimplesNacional: false,
//       incentivoFiscal: false,
//     };

//     const xmlRps = xmlService.gerarXmlLoteRps(dadosTeste, 1);
//     const xmlAssinado = signService.assinar(xmlRps, 'rps:1');

//     // ATENÇÃO: soapService.testarValidador não existe no service atual.
//     // Se você tiver um endpoint específico de validação, implemente-o no soap.service.
//     if (!soapService.testarValidador) {
//       return res.status(501).json({
//         success: false,
//         erro: 'Função soapService.testarValidador não implementada. Ajuste o soap.service para usar o validador da prefeitura.',
//       });
//     }

//     const resultado = await soapService.testarValidador(xmlAssinado);
//     res.json({ success: true, resposta: resultado });
//   } catch (error) {
//     res.status(500).json({ success: false, erro: error.message });
//   }
// });

// Teste com XML mínimo manual (sem builder)
// router.post('/testar-minimo', async (req, res) => {
//   try {
//     const xmlMinimo = `<?xml version="1.0" encoding="UTF-8"?>
// <EnviarLoteRpsEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">
//   <LoteRps versao="2.04" Id="lote:1">
//     <NumeroLote>1</NumeroLote>
//     <Prestador>
//       <CpfCnpj>
//         <Cnpj>43983294000121</Cnpj>
//       </CpfCnpj>
//       <InscricaoMunicipal>6342345</InscricaoMunicipal>
//     </Prestador>
//     <QuantidadeRps>1</QuantidadeRps>
//     <ListaRps>
//       <Rps>
//         <InfDeclaracaoPrestacaoServico Id="rps:1" versao="2.04">
//           <Rps>
//             <IdentificacaoRps>
//               <Numero>1</Numero>
//               <Serie>A1</Serie>
//               <Tipo>1</Tipo>
//             </IdentificacaoRps>
//             <DataEmissao>2025-05-06</DataEmissao>
//             <Status>1</Status>
//           </Rps>
//           <Competencia>2025-05</Competencia>
//           <Servico>
//             <Valores>
//               <ValorServicos>100.00</ValorServicos>
//             </Valores>
//             <ItemListaServico>0102</ItemListaServico>
//             <Discriminacao>Teste</Discriminacao>
//             <CodigoMunicipio>5208707</CodigoMunicipio>
//           </Servico>
//           <Prestador>
//             <CpfCnpj>
//               <Cnpj>43983294000121</Cnpj>
//             </CpfCnpj>
//             <InscricaoMunicipal>6342345</InscricaoMunicipal>
//           </Prestador>
//           <NaturezaOperacao>1</NaturezaOperacao>
//           <OptanteSimplesNacional>2</OptanteSimplesNacional>
//           <IncentivoFiscal>2</IncentivoFiscal>
//         </InfDeclaracaoPrestacaoServico>
//       </Rps>
//     </ListaRps>
//   </LoteRps>
// </EnviarLoteRpsEnvio>`;

//     console.log('[TESTE] XML mínimo:', xmlMinimo);

//     if (!soapService.testarValidador) {
//       return res.status(501).json({
//         success: false,
//         erro: 'Função soapService.testarValidador não implementada. Ajuste o soap.service para usar o validador da prefeitura.',
//       });
//     }

//     const resultado = await soapService.testarValidador(xmlMinimo);
//     res.json({ success: true, resposta: resultado });
//   } catch (error) {
//     res
//       .status(500)
//       .json({ success: false, erro: error.message, resposta: error.response?.data });
//   }
// });

// Rota de teste de conexão HTTP/HTTPS
router.post('/testar-endpoint', async (req, res) => {
  try {
    const resultado = await soapService.testarConexao();
    res.json({ success: resultado.ok, resultado });
  } catch (error) {
    res.status(500).json({ success: false, erro: error.message });
  }
});

// ─── Consulta ────────────────────────────────────────────────────────────────
router.get('/consultar/rps/:numero', ctrl.consultarPorRps);
router.get('/consultar/faixa', ctrl.consultarPorFaixa);

// Consulta SITUAÇÃO de lote (ConsultarSituacaoLoteRps)
router.get('/consultar/lote/situacao/:protocolo', ctrl.consultarSituacaoLote);
// Compat: frontend legado v1 usa /consultar/situacao-lote/:protocolo
router.get('/consultar/situacao-lote/:protocolo', ctrl.consultarSituacaoLote);

// Consulta COMPLETA de lote (ConsultarLoteRps)
router.get('/consultar/lote/:protocolo', ctrl.consultarLoteRps);

// Consulta serviços prestados/tomados
router.get('/consultar/prestados', ctrl.consultarServicosPrestados);
router.get('/consultar/tomados', ctrl.consultarServicosTomados);
router.get('/dados-cadastrais', ctrl.consultarDadosCadastrais);

// ─── Cancelamento / Substituição ────────────────────────────────────────────
router.post('/cancelar', ctrl.cancelar);
router.post('/substituir', ctrl.substituir);

module.exports = router;
