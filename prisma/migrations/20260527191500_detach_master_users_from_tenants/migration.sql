UPDATE "users"
SET "tenantId" = NULL
WHERE "role" = 'master';
