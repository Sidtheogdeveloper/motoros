ALTER TABLE vehicles ADD CONSTRAINT vehicle_vin_format CHECK(vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{17}$');
ALTER TABLE customer_contacts ADD COLUMN review_reason varchar(500);
