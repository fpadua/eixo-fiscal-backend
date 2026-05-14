const UserRepository = require('./user.repository');
const ClientRepository = require('./client.repository');
const InvoiceRepository = require('./invoice.repository');
const DraftRepository = require('./draft.repository');
const { TenantRepository, TenantSettingsRepository } = require('./tenant.repository');

module.exports = {
  UserRepository,
  ClientRepository,
  InvoiceRepository,
  DraftRepository,
  TenantRepository,
  TenantSettingsRepository,
};