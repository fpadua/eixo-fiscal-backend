// backend/src/services/xml.service.js

const { XMLBuilder } = require('fast-xml-parser');

let config = null;
const _cfgReady = (async () => {
  const { getConfig } = require('../config/configProvider');
  config = await getConfig('default-tenant-id');
})();

async function _ensureConfig() {
  if (!config) await _cfgReady;
}

class XmlService {
  constructor() {
    this.builder = new XMLBuilder({
      format: true,
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      attributesGroupName: '@',
      textNodeName: '#text',
      suppressEmptyNode: true,
      suppressBooleanAttributes: false,
    });
  }

  gerarXmlRps(dados) {
    // ID na tag correta para assinatura
    const infId = `RPS${dados.rps?.numero || '001'}`;

    const xmlObj = {
      'Rps': {
        '@': {
          'xmlns': 'http://nfse.abrasf.org.br'
        },
        'InfDeclaracaoPrestacaoServico': {
          '@': { 'Id': infId },
          'Rps': {
            'IdentificacaoRps': {
              'Numero': String(dados.rps?.numero || ''),
              'Serie': String(dados.rps?.serie || '1'),
              'Tipo': Number(dados.rps?.tipo || 1)
            },
            'DataEmissao': this._formatarData(dados.rps?.dataEmissao),
            'Status': 1
          },
          'Competencia': this._formatarCompetencia(dados.rps?.competencia),
          'Servico': {
            'Valores': {
              // 🔧 CORREÇÃO: Uso de '?' para evitar o crash se 'valores' for undefined
              'ValorServicos': this._formatarMoeda(dados.servico?.valores?.valorServicos),
              'ValorDeducoes': this._formatarMoeda(dados.servico?.valores?.valorDeducoes),
              'ValorPis': this._formatarMoeda(dados.servico?.valores?.valorPis),
              'ValorCofins': this._formatarMoeda(dados.servico?.valores?.valorCofins),
              'ValorInss': this._formatarMoeda(dados.servico?.valores?.valorInss),
              'ValorIr': this._formatarMoeda(dados.servico?.valores?.valorIr),
              'ValorCsll': this._formatarMoeda(dados.servico?.valores?.valorCsll),
              'OutrasRetencoes': this._formatarMoeda(dados.servico?.valores?.outrasRetencoes),
              'ValorIss': this._formatarMoeda(dados.servico?.valores?.valorIss),
              'Aliquota': this._formatarMoeda(dados.servico?.valores?.aliquota),
              'DescontoIncondicionado': this._formatarMoeda(dados.servico?.valores?.descontoIncondicionado),
              'DescontoCondicionado': this._formatarMoeda(dados.servico?.valores?.descontoCondicionado)
            },
            'IssRetido': Number(dados.servico?.issRetido || 2),
            'ItemListaServico': String(dados.servico?.itemListaServico || '01.01'),
            'CodigoCnae': String(dados.servico?.codigoCnae || ''),
            'CodigoTributacaoMunicipio': String(dados.servico?.codigoTributacao || ''),
            'Discriminacao': String(dados.servico?.discriminacao || ''),
            'CodigoMunicipio': String(dados.prestador?.endereco?.codigoMunicipio || ''),
            'ExigibilidadeISS': Number(dados.servico?.exigibilidadeIss || 1),
            'MunicipioIncidencia': String(dados.servico?.municipioIncidencia || dados.prestador?.endereco?.codigoMunicipio || '')
          },
          'Prestador': {
            'CpfCnpj': { 'Cnpj': String(dados.prestador?.cnpj || '').replace(/\D/g, '') },
            'InscricaoMunicipal': String(dados.prestador?.inscricaoMunicipal || '')
          },
          'TomadorServico': {
            'IdentificacaoTomador': {
              'CpfCnpj': { 'Cnpj': String(dados.tomador?.cnpj || '').replace(/\D/g, '') }
            },
            'RazaoSocial': String(dados.tomador?.razaoSocial || ''),
            'Endereco': {
              'Endereco': String(dados.tomador?.endereco?.logradouro || ''),
              'Complemento': String(dados.tomador?.endereco?.complemento || ''),
              'Numero': String(dados.tomador?.endereco?.numero || 'S/N'),
              'Bairro': String(dados.tomador?.endereco?.bairro || ''),
              'CodigoMunicipio': String(dados.tomador?.endereco?.codigoMunicipio || ''),
              'Uf': String(dados.tomador?.endereco?.uf || ''),
              'Cep': String(dados.tomador?.endereco?.cep || '').replace(/\D/g, '')
            },
            'Contato': {
              'Telefone': String(dados.tomador?.contato?.telefone || ''),
              'Email': String(dados.tomador?.contato?.email || '')
            }
          },
          'RegimeEspecialTributacao': Number(dados.regimeEspecialTributacao || 6),
          'OptanteSimplesNacional': Number(dados.optanteSimplesNacional ? 1 : 2),
          'IncentivoFiscal': Number(dados.incentivoFiscal ? 1 : 2)
        }
      }
    };

    let xmlString = this.builder.build(xmlObj);
    return `<?xml version="1.0" encoding="iso-8859-1"?>\n${xmlString}`;
  }

  // Mantém a função de compatibilidade
  gerarXmlGerarNfse(dados) {
    return this.gerarXmlRps(dados);
  }

  gerarXmlLoteRps(xmlRpsString, loteInfo) {
    const numero = loteInfo?.numero ? String(loteInfo.numero) : '1';
    const cnpj = loteInfo?.cnpj ? String(loteInfo.cnpj).replace(/\D/g, '') : '';
    const im = loteInfo?.inscricaoMunicipal ? String(loteInfo.inscricaoMunicipal) : '';
    const rpsLimpo = xmlRpsString ? xmlRpsString.replace(/<\?xml.*?\?>\s*/, '') : '';

    return `<?xml version="1.0" encoding="iso-8859-1"?>
<EnviarLoteRpsEnvio xmlns="http://nfse.abrasf.org.br">
  <LoteRps Id="Lote${numero}">
    <NumeroLote>${numero}</NumeroLote>
    <CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>
    <InscricaoMunicipal>${im}</InscricaoMunicipal>
    <QuantidadeRps>1</QuantidadeRps>
    <ListaRps>${rpsLimpo}</ListaRps>
  </LoteRps>
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#"></Signature>
</EnviarLoteRpsEnvio>`;
  }

  _formatarMoeda(val) {
    if (val === undefined || val === null) return '0.00';
    const num = parseFloat(val);
    return isNaN(num) ? '0.00' : num.toFixed(2);
  }

  _formatarData(d) {
    if (!d) return new Date().toISOString().split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    return new Date(d).toISOString().split('T')[0];
  }

  _formatarCompetencia(c) {
    if (!c) return new Date().toISOString().split('T')[0];
    if (/^\d{4}-\d{2}$/.test(c)) return `${c}-01`;
    return c;
  }

  gerarXmlConsultaServicosPrestados({ dataInicial, dataFinal, pagina }) {
    const { getConfig } = require('../config/configProvider');
    const cnpj = config.prestador.cnpj.replace(/\D/g, '');
    const inscricaoMunicipal = config.prestador.inscricaoMunicipal;
    const ns = 'http://nfse.abrasf.org.br';

    return `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarNfseServicoPrestadoEnvio xmlns="${ns}">
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
  }

  gerarXmlConsultaServicosTomados({ cnpj, dataInicial, dataFinal, pagina }) {
    const { getConfig } = require('../config/configProvider');
    const cnpjPrestador = (cnpj || config.prestador.cnpj).replace(/\D/g, '');
    const ns = 'http://nfse.abrasf.org.br';

    return `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarNfseServicoTomadoEnvio xmlns="${ns}">
  <Consulente>
    <CpfCnpj>
      ${cnpjPrestador.length === 14 ? `<Cnpj>${cnpjPrestador}</Cnpj>` : `<Cpf>${cnpjPrestador}</Cpf>`}
    </CpfCnpj>
  </Consulente>
  <Tomador>
    <CpfCnpj>
      ${cnpjPrestador.length === 14 ? `<Cnpj>${cnpjPrestador}</Cnpj>` : `<Cpf>${cnpjPrestador}</Cpf>`}
    </CpfCnpj>
  </Tomador>
  ${(dataInicial || dataFinal) ? `
  <PeriodoEmissao>
    <DataInicial>${dataInicial}</DataInicial>
    <DataFinal>${dataFinal}</DataFinal>
  </PeriodoEmissao>` : ''}
  <Pagina>${pagina || 1}</Pagina>
</ConsultarNfseServicoTomadoEnvio>`;
  }
}

module.exports = new XmlService();