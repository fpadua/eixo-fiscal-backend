const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');

router.use(authMiddleware);

let metricas = {
  totalEmitidas: 0,
  totalCanceladas: 0,
  totalSubstituidas: 0,
  valorTotal: 0,
  ultimoMes: {
    emitidas: 0,
    valor: 0
  }
};

router.get('/', (req, res) => {
  res.json({
    sucesso: true,
    ...metricas
  });
});

router.post('/atualizar', (req, res) => {
  const { totalEmitidas, totalCanceladas, totalSubstituidas, valorTotal, ultimoMes } = req.body;
  if (totalEmitidas !== undefined) metricas.totalEmitidas = totalEmitidas;
  if (totalCanceladas !== undefined) metricas.totalCanceladas = totalCanceladas;
  if (totalSubstituidas !== undefined) metricas.totalSubstituidas = totalSubstituidas;
  if (valorTotal !== undefined) metricas.valorTotal = valorTotal;
  if (ultimoMes) metricas.ultimoMes = ultimoMes;
  
  res.json({ sucesso: true, metricas });
});

module.exports = router;