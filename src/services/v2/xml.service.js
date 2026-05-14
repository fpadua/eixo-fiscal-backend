const { XMLBuilder } = require('fast-xml-parser');
const config = require('../../config/nfse.config');

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
});

const NS_NFSE = 'http://www.sped.fazenda.gov.br/nfse';
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';

function gerarIdDPS(codigoMunicipio, tipoInscricao, inscricaoFederal, serie, numero) {
  // Schema: DPS + Cód.Mun (7) + Tipo INsc (1) + INsc Federal (14) + Série DPS (5) + Núm DPS (15) = 45 chars
  const tipo = tipoInscricao === '2' ? '1' : '2';
  const cpfCnpj = String(inscricaoFederal).replace(/\D/g, '').padStart(14, '0');
  const serieStr = String(serie).replace(/\D/g, '').padStart(5, '0').slice(-5);
  // Garante que o número tenha 15 dígitos e comece com 1-9
  const numeroStr = String(numero).replace(/\D/g, '').padStart(15, '0').slice(-15);
  const resultado = `DPS${codigoMunicipio}${tipo}${cpfCnpj}${serieStr}${numeroStr}`;
  
  if (resultado.length !== 45) {
    console.log('[XML] AVISO: ID DPS tem ' + resultado.length + ' chars, esperado 45');
  }
  return resultado;
}

function gerarIdNFSe(codigoMunicipio, ambienteGerador, tipoInscricao, inscricaoFederal, numeroNota, anoMes, codigoNumero) {
  const tipo = tipoInscricao === '2' ? '1' : '2';
  const cpfCnpj = inscricaoFederal.padStart(14, '0');
  const numeroNotaStr = String(numeroNota).padStart(13, '0');
  const codigoNumeroStr = String(codigoNumero).padStart(9, '0');
  const dv = '1';
  return `NFS${codigoMunicipio}${ambienteGerador}${tipo}${cpfCnpj}${numeroNotaStr}${anoMes}${codigoNumeroStr}${dv}`;
}

function gerarXmlDps(dados, numeroLote = null) {
  const now = new Date();
  // Formato: 2026-05-07T10:11:22-03:00 (ajusta para o fuso local do prestador)
  const dhEmissao = now.toISOString().replace(/\.\d+Z$/, '-03:00'); 
  const dCompet = dados.dCompet ? (dados.dCompet.includes('-') ? dados.dCompet : `${dados.dCompet.slice(0, 4)}-${dados.dCompet.slice(4, 6)}-${dados.dCompet.slice(6, 8)}`) : now.toISOString().slice(0, 10);
  // nDPS deve ter 1-15 dígitos e começar com 1-9 (não pode iniciar com 0)
  // O schema exige: [1-9]{1}[0-9]{0,14}
  let numeroDps = dados.numeroDps;
  if (!numeroDps || numeroDps < 1) {
    // Gera número que NÃO começa com zero
    const timestamp = Date.now().toString();
    const baseNum = parseInt(timestamp.slice(-12));
    // Garante número válido (mínimo 7 dígitos, máximo 15, começa com 1-9)
    const num = Math.max(1000000, Math.min(baseNum, 999999999999999));
    numeroDps = String(num); // Sem padding para não ter leading zeros
  } else {
    // Remove zeros à esquerda e garante que comece com 1-9
    numeroDps = String(parseInt(numeroDps));
  }
  const serieDps = dados.serieDps ? dados.serieDps.replace(/\D/g, '').slice(-5).padStart(5, '0') : '00001';

  const prestador = dados.prestador || config.prestador;
  const cnpjPrestador = (prestador.cnpj || '').replace(/\D/g, '');
  const tipoInscricao = cnpjPrestador.length === 14 ? '1' : '2';

  const codigoMunicipio = dados.codigoMunicipio || config.codigoMunicipioGoiania;
  const idDps = gerarIdDPS(codigoMunicipio, tipoInscricao, cnpjPrestador, serieDps, numeroDps);

  const tribNac = dados.servico?.cTribNac || dados.itemListaServico?.replace('.', '') || '010100';
  const cNBS = dados.servico?.cNBS || '';
  const xDescServ = dados.servico?.discriminacao || dados.discriminacao || 'Serviços prestados';
  const cTribMun = dados.servico?.cTribMun || '';

  const vServicos = Number(dados.servico?.valorServicos || dados.valorServicos || 0);
  const vDescIncond = Number(dados.servico?.vDescIncond || dados.vDescIncond || 0);
  const vDescCond = Number(dados.servico?.vDescCond || dados.vDescCond || 0);
  const pAliq = Number(dados.servico?.aliquota || dados.aliquota || 2);

  const vBC = vServicos - vDescIncond - vDescCond;
  const vIssqn = (vBC * pAliq / 100);
  const issRetido = dados.servico?.issRetido || dados.issRetido || false;
  const vRetIss = issRetido ? vIssqn : 0;

  const tribISSQN = dados.tribISSQN || dados.tributacao || 1;
  const tpRetISSQN = issRetido ? 2 : 1;

  const opSimpNac = dados.optanteSimplesNacional ? 3 : 1;
  const regApTribSN = dados.regApTribSN || dados.regimeApuracao || 1;

  // Endereço completo do prestador (obrigatório pelo schema)
  const prestadorEndereco = prestador.endereco || {};

  const xmlDps = {
    '@_xmlns': NS_NFSE,
    infDPS: {
      '@_Id': idDps,
      tpAmb: dados.tpAmb || config.tpAmb,
      dhEmi: dhEmissao,
      verAplic: dados.verAplic || 'NFSe-GYN-v2',
      serie: serieDps,
      nDPS: String(numeroDps),
      dCompet: dCompet,
      tpEmit: dados.tpEmit || 1,
      cLocEmi: codigoMunicipio,
      prest: {
        ...(cnpjPrestador.length === 14 ? { CNPJ: cnpjPrestador } : { CPF: cnpjPrestador }),
        IM: String(prestador.inscricaoMunicipal || '').replace(/\D/g, ''),
        xNome: prestador.razaoSocial || '',
        ...(prestadorEndereco.xLgr ? {
          enderPrest: {
            xLgr: prestadorEndereco.logradouro || prestadorEndereco.xLgr || '',
            nro: prestadorEndereco.numero || prestadorEndereco.nro || '',
            xCpl: prestadorEndereco.complemento || prestadorEndereco.xCpl || '',
            xBairro: prestadorEndereco.bairro || prestadorEndereco.xBairro || '',
            cMun: prestadorEndereco.codigoMunicipio || codigoMunicipio,
            xMun: prestadorEndereco.municipio || prestadorEndereco.xMun || 'Goiânia',
            UF: prestadorEndereco.uf || 'GO',
            CEP: String(prestadorEndereco.cep || '00000000').replace(/\D/g, ''),
          }
        } : {}),
        ...(dados.fonePrest ? { fone: dados.fonePrest } : {}),
        ...(dados.emailPrest ? { email: dados.emailPrest } : {}),
        regTrib: {
          opSimpNac: opSimpNac,
          ...(opSimpNac === 3 ? { regApTribSN: regApTribSN } : {}),
          ...(dados.regEspTrib ? { regEspTrib: dados.regEspTrib } : {}),
        },
      },
      ...(dados.tomador ? {
        tom: {
          ...(dados.tomador.cnpj ? { CNPJ: String(dados.tomador.cnpj || '').replace(/\D/g, '') } : {}),
          ...(dados.tomador.cpf ? { CPF: String(dados.tomador.cpf || '').replace(/\D/g, '') } : {}),
          ...(dados.tomador.IM ? { IM: String(dados.tomador.IM).replace(/\D/g, '') } : {}),
          xNome: dados.tomador.razaoSocial || '',
          ...(dados.tomador.endereco ? {
            enderTom: {
              xLgr: dados.tomador.endereco.logradouro || '',
              nro: dados.tomador.endereco.numero || '',
              ...(dados.tomador.endereco.complemento ? { xCpl: dados.tomador.endereco.complemento } : {}),
              xBairro: dados.tomador.endereco.bairro || '',
              cMun: dados.tomador.endereco.codigoMunicipio || codigoMunicipio,
              xMun: dados.tomador.endereco.municipio || '',
              UF: dados.tomador.endereco.uf || 'GO',
              CEP: String(dados.tomador.endereco.cep || '00000000').replace(/\D/g, ''),
            },
          } : {}),
          ...(dados.tomador.fone ? { fone: dados.tomador.fone } : {}),
          ...(dados.tomador.email ? { email: dados.tomador.email } : {}),
        },
      } : {}),
      serv: {
        locPrest: {
          cLocPrestacao: dados.servico?.cLocPrestacao || codigoMunicipio,
        },
        cServ: {
          cTribNac: tribNac,
          ...(cTribMun ? { cTribMun: cTribMun } : {}),
          xDescServ: xDescServ,
          ...(cNBS ? { cNBS: cNBS } : {}),
        },
      },
      valores: {
        vServPrest: {
          vServ: vServicos.toFixed(2),
        },
        ...(vDescIncond > 0 || vDescCond > 0 ? {
          vDescCondIncond: {
            ...(vDescIncond > 0 ? { vDescIncond: vDescIncond } : {}),
            ...(vDescCond > 0 ? { vDescCond: vDescCond } : {}),
          },
        } : {}),
        trib: {
          tribMun: {
            tribISSQN: tribISSQN,
            ...(dados.cPaisResult ? { cPaisResult: dados.cPaisResult } : {}),
            tpRetISSQN: tpRetISSQN,
            ...(pAliq > 0 ? { pAliq: pAliq.toFixed(4) } : {}),
          },
          totTrib: {
            indTotTrib: 0
          },
          ...(dados.tribFed ? {
            tribFed: {
              ...(dados.tribFed.vRetIRRF ? { vRetIRRF: Number(dados.tribFed.vRetIRRF).toFixed(2) } : {}),
              ...(dados.tribFed.vRetCSLL ? { vRetCSLL: Number(dados.tribFed.vRetCSLL).toFixed(2) } : {}),
            },
          } : {}),
        },
      },
      ...(dados.pag ? { pag: dados.pag } : {}),
    },
  };

  return builder.build(xmlDps);
}

function gerarXmlLoteDps(listaDps, numeroLote, cnpjPrestador, inscricaoMunicipal) {
  const idLote = `LOTE${numeroLote}`;
  const cnpj = cnpjPrestador.replace(/\D/g, '');
  const tipoInscricao = cnpj.length === 14 ? '1' : '2';

  const listaDpsXml = listaDps.map(dps => dps.xml).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<LoteDps xmlns="${NS_NFSE}" ${idLote}>
  <NumeroLote>${numeroLote}</NumeroLote>
  <Prestador>
    <CpfCnpj>
      ${cnpj.length === 14 ? `<Cnpj>${cnpj}</Cnpj>` : `<Cpf>${cnpj}</Cpf>`}
    </CpfCnpj>
    <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
  </Prestador>
  <QuantidadeDPS>${listaDps.length}</QuantidadeDPS>
  <ListaDps>
    ${listaDps.map((d, i) => `<DPS>${d.xml}</DPS>`).join('\n')}
  </ListaDps>
</LoteDps>`;

  return xml;
}

function gerarXmlGerarNfse(dados) {
  const dps = dados.dps || dados;
  const xmlDps = gerarXmlDps(dps);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GerarNfseEnvio xmlns="${NS_NFSE}" versao="1.01">
  <DPS versao="1.01">
    ${xmlDps}
  </DPS>
</GerarNfseEnvio>`;

  return xml;
}

function gerarXmlEnviarLoteDpsSincrono(listaDps, numeroLote) {
  const cnpjPrestador = config.prestador.cnpj.replace(/\D/g, '');
  const inscricaoMunicipal = config.prestador.inscricaoMunicipal;

  const listaXml = listaDps.map(dps => gerarXmlDps(dps));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EnviarLoteDpsSincronoEnvio xmlns="${NS_NFSE}" versao="1.01">
  <LoteDps versao="1.01">
    <NumeroLote>${numeroLote}</NumeroLote>
    <Prestador>
      <CpfCnpj>
        ${cnpjPrestador.length === 14 ? `<Cnpj>${cnpjPrestador}</Cnpj>` : `<Cpf>${cnpjPrestador}</Cpf>`}
      </CpfCnpj>
      <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
    </Prestador>
    <QuantidadeDPS>${listaDps.length}</QuantidadeDPS>
    <ListaDps>
      ${listaXml.map(xml => `<DPS>${xml}</DPS>`).join('\n')}
    </ListaDps>
  </LoteDps>
</EnviarLoteDpsSincronoEnvio>`;

  return xml;
}

function gerarXmlRecepcaoLoteDps(listaDps, numeroLote) {
  const cnpjPrestador = config.prestador.cnpj.replace(/\D/g, '');
  const inscricaoMunicipal = config.prestador.inscricaoMunicipal;

  const listaXml = listaDps.map(dps => gerarXmlDps(dps));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EnviarLoteDpsEnvio xmlns="${NS_NFSE}" versao="1.01">
  <LoteDps versao="1.01">
    <NumeroLote>${numeroLote}</NumeroLote>
    <Prestador>
      <CpfCnpj>
        ${cnpjPrestador.length === 14 ? `<Cnpj>${cnpjPrestador}</Cnpj>` : `<Cpf>${cnpjPrestador}</Cpf>`}
      </CpfCnpj>
      <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
    </Prestador>
    <QuantidadeDPS>${listaDps.length}</QuantidadeDPS>
    <ListaDps>
      ${listaXml.map(xml => `<DPS>${xml}</DPS>`).join('\n')}
    </ListaDps>
  </LoteDps>
</EnviarLoteDpsEnvio>`;

  return xml;
}

function gerarXmlCancelamento(numeroNfse, codigoVerificacao, cnpjPrestador, inscricaoMunicipal, motivo) {
  const cnpj = cnpjPrestador.replace(/\D/g, '');
  const codigoMunicipio = config.codigoMunicipioGoiania;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CancelarNfseEnvio xmlns="${NS_NFSE}">
  <pedRegEvento xmlns="${NS_NFSE}">
    <infPedReg>
      <tpAmb>2</tpAmb>
      <verAplic>NFSe-GYN-v2</verAplic>
      <dhEvento>${new Date().toISOString()}</dhEvento>
      <CNPJAutor>${cnpj}</CNPJAutor>
      <chNFSe>${codigoMunicipio}1${cnpj.padStart(14, '0')}${String(numeroNfse).padStart(13, '0')}${new Date().toISOString().slice(0, 4) + new Date().toISOString().slice(5, 7)}0000000011</chNFSe>
      <e101101>
        <xDesc>Cancelamento de NFS-e</xDesc>
        <cMotivo>${motivo || 1}</cMotivo>
        <xMotivo>${motivo === 9 ? 'Outros' : 'Erro na Emissão'}</xMotivo>
      </e101101>
    </infPedReg>
  </pedRegEvento>
</CancelarNfseEnvio>`;

  return xml;
}

function gerarXmlSubstituicao(numeroNfse, codigoVerificacao, novaDps, cnpjPrestador, inscricaoMunicipal, motivo) {
  const cnpj = cnpjPrestador.replace(/\D/g, '');
  const codigoMunicipio = config.codigoMunicipioGoiania;
  const novaDpsXml = gerarXmlDps(novaDps);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<SubstituirNfseEnvio xmlns="${NS_NFSE}">
  <SubstituicaoNfse>
    <NFSe>
      <InfNfse>
        <CodigoMunicipio>${codigoMunicipio}</CodigoMunicipio>
        <NumeroNfse>${numeroNfse}</NumeroNfse>
        <CodigoVerificacao>${codigoVerificacao}</CodigoVerificacao>
      </InfNfse>
    </NFSe>
  </SubstituicaoNfse>
  <pedRegEvento xmlns="${NS_NFSE}">
    <infPedReg>
      <tpAmb>2</tpAmb>
      <verAplic>NFSe-GYN-v2</verAplic>
      <dhEvento>${new Date().toISOString()}</dhEvento>
      <CNPJAutor>${cnpj}</CNPJAutor>
      <chNFSe>${codigoMunicipio}1${cnpj.padStart(14, '0')}${String(numeroNfse).padStart(13, '0')}${new Date().toISOString().slice(0, 4) + new Date().toISOString().slice(5, 7)}0000000011</chNFSe>
      <e105102>
        <xDesc>Cancelamento de NFS-e por Substituição</xDesc>
        <cMotivo>${motivo || 99}</cMotivo>
        <xMotivo>Substituição por nova NFS-e</xMotivo>
      </e105102>
    </infPedReg>
  </pedRegEvento>
  <DPS>
    ${novaDpsXml}
  </DPS>
</SubstituirNfseEnvio>`;

  return xml;
}

function gerarXmlConsultaPorDps(numeroDps, serieDps, cnpjPrestador, inscricaoMunicipal) {
  const cnpj = cnpjPrestador.replace(/\D/g, '');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarNfseDpsEnvio xmlns="${NS_NFSE}">
  <IdentificacaoDps>
    <SerieDPS>${serieDps || '00001'}</SerieDPS>
    <NumDPS>${numeroDps}</NumDPS>
  </IdentificacaoDps>
  <Prestador>
    <CpfCnpj>
      ${cnpj.length === 14 ? `<Cnpj>${cnpj}</Cnpj>` : `<Cpf>${cnpj}</Cpf>`}
    </CpfCnpj>
    <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
  </Prestador>
</ConsultarNfseDpsEnvio>`;

  return xml;
}

function gerarXmlConsultaPorFaixa(numeroInicial, numeroFinal, pagina, cnpjPrestador, inscricaoMunicipal) {
  const cnpj = cnpjPrestador.replace(/\D/g, '');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarNfseFaixaEnvio xmlns="${NS_NFSE}">
  <Prestador>
    <CpfCnpj>
      ${cnpj.length === 14 ? `<Cnpj>${cnpj}</Cnpj>` : `<Cpf>${cnpj}</Cpf>`}
    </CpfCnpj>
    <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
  </Prestador>
  <Faixa>
    <NumeroNfseInicial>${numeroInicial}</NumeroNfseInicial>
    <NumeroNfseFinal>${numeroFinal}</NumeroNfseFinal>
  </Faixa>
  <Pagina>${pagina || 1}</Pagina>
</ConsultarNfseFaixaEnvio>`;

  return xml;
}

function gerarXmlConsultaServicosPrestados(dataInicial, dataFinal, cnpjPrestador, inscricaoMunicipal, pagina) {
  const cnpj = cnpjPrestador.replace(/\D/g, '');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarNfseServicoPrestadoEnvio xmlns="${NS_NFSE}">
  <Prestador>
    <CpfCnpj>
      ${cnpj.length === 14 ? `<Cnpj>${cnpj}</Cnpj>` : `<Cpf>${cnpj}</Cpf>`}
    </CpfCnpj>
    <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
  </Prestador>
  ${(dataInicial || dataFinal) ? `
  <PeriodoEmissao>
    <DataInicial>${dataInicial}</DataInicial>
    <DataFinal>${dataFinal}</DataFinal>
  </PeriodoEmissao>` : ''}
  <Pagina>${pagina || 1}</Pagina>
</ConsultarNfseServicoPrestadoEnvio>`;

  return xml;
}

function gerarXmlConsultaServicosTomados(cnpjConsulente, inscricaoMunicipal, dataInicial, dataFinal, pagina) {
  const cnpj = cnpjConsulente.replace(/\D/g, '');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarNfseServicoTomadoEnvio xmlns="${NS_NFSE}">
  <Consulente>
    <CpfCnpj>
      ${cnpj.length === 14 ? `<Cnpj>${cnpj}</Cnpj>` : `<Cpf>${cnpj}</Cpf>`}
    </CpfCnpj>
  </Consulente>
  <Tomador>
    <CpfCnpj>
      ${cnpj.length === 14 ? `<Cnpj>${cnpj}</Cnpj>` : `<Cpf>${cnpj}</Cpf>`}
    </CpfCnpj>
  </Tomador>
  ${(dataInicial || dataFinal) ? `
  <PeriodoEmissao>
    <DataInicial>${dataInicial}</DataInicial>
    <DataFinal>${dataFinal}</DataFinal>
  </PeriodoEmissao>` : ''}
  <Pagina>${pagina || 1}</Pagina>
</ConsultarNfseServicoTomadoEnvio>`;

  return xml;
}

function gerarXmlConsultaLote(protocolo, cnpjPrestador, inscricaoMunicipal) {
  const cnpj = cnpjPrestador.replace(/\D/g, '');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarLoteDpsEnvio xmlns="${NS_NFSE}">
  <Prestador>
    <CpfCnpj>
      ${cnpj.length === 14 ? `<Cnpj>${cnpj}</Cnpj>` : `<Cpf>${cnpj}</Cpf>`}
    </CpfCnpj>
    <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
  </Prestador>
  <Protocolo>${protocolo}</Protocolo>
</ConsultarLoteDpsEnvio>`;

  return xml;
}

function gerarXmlConsultaSituacaoLote(protocolo, cnpjPrestador, inscricaoMunicipal) {
  const cnpj = cnpjPrestador.replace(/\D/g, '');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarSituacaoLoteDpsEnvio xmlns="${NS_NFSE}">
  <Prestador>
    <CpfCnpj>
      ${cnpj.length === 14 ? `<Cnpj>${cnpj}</Cnpj>` : `<Cpf>${cnpj}</Cpf>`}
    </CpfCnpj>
    <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
  </Prestador>
  <Protocolo>${protocolo}</Protocolo>
</ConsultarSituacaoLoteDpsEnvio>`;

  return xml;
}

function gerarXmlConsultaUrlNfse(numeroNfse, cnpjPrestador, inscricaoMunicipal) {
  const cnpj = cnpjPrestador.replace(/\D/g, '');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarUrlNfseEnvio xmlns="${NS_NFSE}">
  <Prestador>
    <CpfCnpj>
      ${cnpj.length === 14 ? `<Cnpj>${cnpj}</Cnpj>` : `<Cpf>${cnpj}</Cpf>`}
    </CpfCnpj>
    <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
  </Prestador>
  <NumeroNfse>${numeroNfse}</NumeroNfse>
</ConsultarUrlNfseEnvio>`;

  return xml;
}

function gerarXmlConsultaDadosCadastrais(cnpjPrestador, inscricaoMunicipal) {
  const cnpj = cnpjPrestador.replace(/\D/g, '');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarDadosCadastraisEnvio xmlns="${NS_NFSE}">
  <Prestador>
    <CpfCnpj>
      ${cnpj.length === 14 ? `<Cnpj>${cnpj}</Cnpj>` : `<Cpf>${cnpj}</Cpf>`}
    </CpfCnpj>
    <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
  </Prestador>
</ConsultarDadosCadastraisEnvio>`;

  return xml;
}

function gerarXmlConsultaDpsDisponivel(cnpjPrestador, inscricaoMunicipal, pagina) {
  const cnpj = cnpjPrestador.replace(/\D/g, '');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarDpsDisponivelEnvio xmlns="${NS_NFSE}">
  <Prestador>
    <CpfCnpj>
      ${cnpj.length === 14 ? `<Cnpj>${cnpj}</Cnpj>` : `<Cpf>${cnpj}</Cpf>`}
    </CpfCnpj>
    <InscricaoMunicipal>${inscricaoMunicipal}</InscricaoMunicipal>
  </Prestador>
  <Pagina>${pagina || 1}</Pagina>
</ConsultarDpsDisponivelEnvio>`;

  return xml;
}

module.exports = {
  gerarXmlDps,
  gerarXmlLoteDps,
  gerarXmlGerarNfse,
  gerarXmlEnviarLoteDpsSincrono,
  gerarXmlRecepcaoLoteDps,
  gerarXmlCancelamento,
  gerarXmlSubstituicao,
  gerarXmlConsultaPorDps,
  gerarXmlConsultaPorFaixa,
  gerarXmlConsultaServicosPrestados,
  gerarXmlConsultaServicosTomados,
  gerarXmlConsultaLote,
  gerarXmlConsultaSituacaoLote,
  gerarXmlConsultaUrlNfse,
  gerarXmlConsultaDadosCadastrais,
  gerarXmlConsultaDpsDisponivel,
  gerarIdDPS,
  gerarIdNFSe,
};
