const fs = require('fs');
const path = require('path');
const xmlService = require('../src/services/v2/xml.service');

const outDir = path.resolve(__dirname, '../../docs/modelos-v2-gerados');

const prestador = {
  cnpj: '43983294000121',
  inscricaoMunicipal: '123456',
  razaoSocial: 'Prestador Exemplo NFSe',
  endereco: {
    logradouro: 'Rua Exemplo',
    numero: '1000',
    complemento: 'Sala 01',
    bairro: 'Centro',
    codigoMunicipio: '5208707',
    cep: '74000000',
  },
  fone: '6233334444',
  email: 'homologacao@example.com',
};

const dps = {
  numeroDps: 1,
  serieDps: '1',
  dCompet: '2026-05-21',
  dhEmi: '2026-05-21T12:00:00-03:00',
  prestador,
  optanteSimplesNacional: false,
  regimeApuracao: 1,
  cLocPrestacao: '5208707',
  servico: {
    valorServicos: 100,
    aliquota: 2,
    issRetido: true,
    discriminacao: 'Servicos prestados para homologacao da NFS-e Nacional v2.',
    cTribNac: '010101',
    cTribMun: '10101',
    cNBS: '115021000',
    cLocPrestacao: '5208707',
    cMunIncid: '5208707',
    tribISSQN: '1',
  },
  tomador: {
    cnpj: '11222333000181',
    razaoSocial: 'Tomador Exemplo Ltda',
    email: 'tomador@example.com',
    fone: '6232221111',
    endereco: {
      logradouro: 'Avenida Exemplo',
      numero: '200',
      bairro: 'Centro',
      codigoMunicipio: '5208707',
      municipio: 'Goiania',
      uf: 'GO',
      cep: '74000000',
    },
  },
  IBSCBS: {
    finNFSe: 0,
    cIndOp: '100301',
    indDest: 0,
    valores: {
      trib: {
        gIBSCBS: {
          CST: '000',
          cClassTrib: '000001',
        },
      },
    },
  },
  indTotTrib: 0,
};

const chaveNfse = '52087072243983294000121000000000000126051234567891';

const modelos = {
  'GerarNfseEnvio.xml': xmlService.gerarXmlGerarNfse(dps),
  'EnviarLoteDpsEnvio.xml': xmlService.gerarXmlRecepcaoLoteDps([dps], 1),
  'EnviarLoteDpsSincronoEnvio.xml': xmlService.gerarXmlEnviarLoteDpsSincrono([dps], 1),
  'CancelarNfseEnvio.xml': xmlService.gerarXmlCancelamento({
    chNFSe: chaveNfse,
    documentoAutor: prestador.cnpj,
    motivo: 1,
    tipoEvento: 'e101103',
    xMotivo: 'Erro na emissao',
  }),
  'ConsultarLoteDpsEnvio.xml': xmlService.gerarXmlConsultaLote('202605210000001', prestador.cnpj, prestador.inscricaoMunicipal),
  'ConsultarNfseFaixaEnvio.xml': xmlService.gerarXmlConsultaPorFaixa(1, 50, 1, prestador.cnpj, prestador.inscricaoMunicipal),
  'ConsultarNfseDpsEnvio.xml': xmlService.gerarXmlConsultaPorDps(1, '1', prestador.cnpj, prestador.inscricaoMunicipal),
  'ConsultarNfseServicoPrestadoEnvio.xml': xmlService.gerarXmlConsultaServicosPrestados('2026-05-01', '2026-05-21', prestador.cnpj, prestador.inscricaoMunicipal, 1),
  'ConsultarNfseServicoTomadoEnvio.xml': xmlService.gerarXmlConsultaServicosTomados(prestador.cnpj, prestador.inscricaoMunicipal, '2026-05-01', '2026-05-21', 1),
  'ConsultarDadosCadastraisEnvio.xml': xmlService.gerarXmlConsultaDadosCadastrais(prestador.cnpj, prestador.inscricaoMunicipal),
  'ConsultarDpsDisponivelEnvio.xml': xmlService.gerarXmlConsultaDpsDisponivel(prestador.cnpj, prestador.inscricaoMunicipal, 1),
  'ConsultarUrlNfseEnvio.xml': xmlService.gerarXmlConsultaUrlNfse(1, prestador.cnpj, prestador.inscricaoMunicipal),
};

fs.mkdirSync(outDir, { recursive: true });

for (const [file, xml] of Object.entries(modelos)) {
  fs.writeFileSync(path.join(outDir, file), xml.endsWith('\n') ? xml : `${xml}\n`, 'utf8');
}

console.log(`Modelos XML v2 gerados em ${outDir}`);
for (const file of Object.keys(modelos)) console.log(`- ${file}`);
