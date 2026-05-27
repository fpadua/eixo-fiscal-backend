module.exports = {
  port: process.env.PORT || 3001,
  version: process.env.VERSION || 'v2',
  homologacao: process.env.HOMOLOGACAO === 'true',
  isMock: process.env.MOCK === 'false',
  tpAmb: process.env.TP_AMB || '1',
  endpoint: process.env.NFSE_ENDPOINT || '',
  frontendUrl: process.env.FRONTEND_URL || '',
};
