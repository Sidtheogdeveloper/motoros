ALTER TABLE odometer_records ADD COLUMN external_reference uuid;
CREATE UNIQUE INDEX odometer_external_reference ON odometer_records(tenant_id,external_reference) WHERE external_reference IS NOT NULL;
