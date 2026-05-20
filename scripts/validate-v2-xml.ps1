param(
  [string]$XmlPath = "backend/storage/xml/gerar_nfse_v2_101_teste.xml",
  [string]$SchemaPath = "docs/schema_v101.xsd",
  [string]$DsigSchemaPath = "docs/xmldsig-core-schema.xsd"
)

$resolvedXml = (Resolve-Path $XmlPath).Path
$resolvedSchema = (Resolve-Path $SchemaPath).Path
$resolvedDsig = (Resolve-Path $DsigSchemaPath).Path

$schemas = New-Object System.Xml.Schema.XmlSchemaSet

$schemaSettings = New-Object System.Xml.XmlReaderSettings
$schemaSettings.DtdProcessing = [System.Xml.DtdProcessing]::Parse
$schemaSettings.XmlResolver = New-Object System.Xml.XmlUrlResolver

$dsigReader = [System.Xml.XmlReader]::Create($resolvedDsig, $schemaSettings)
[void]$schemas.Add("http://www.w3.org/2000/09/xmldsig#", $dsigReader)
$dsigReader.Close()

[void]$schemas.Add("http://www.sped.fazenda.gov.br/nfse", $resolvedSchema)
$schemas.Compile()

$settings = New-Object System.Xml.XmlReaderSettings
$settings.ValidationType = [System.Xml.ValidationType]::Schema
$settings.Schemas = $schemas

$errors = New-Object System.Collections.Generic.List[string]
$settings.add_ValidationEventHandler({
  param($sender, $eventArgs)
  $errors.Add(($eventArgs.Severity.ToString() + ": " + $eventArgs.Message))
})

try {
  $reader = [System.Xml.XmlReader]::Create($resolvedXml, $settings)
  while ($reader.Read()) { }
  $reader.Close()
} catch {
  $errors.Add("Exception: " + $_.Exception.Message)
}

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Output "VALID"
