ALTER TABLE required_parts DROP CONSTRAINT required_parts_status_check;
ALTER TABLE required_parts ADD CONSTRAINT required_parts_status_check CHECK(status IN ('REQUESTED','RECEIVED','USED','FULFILLED','CANCELLED'));
ALTER TABLE required_parts ADD COLUMN inventory_reservation_id uuid;
ALTER TABLE required_parts ADD CONSTRAINT verified_fulfillment_source CHECK((status='FULFILLED')=(inventory_reservation_id IS NOT NULL));
CREATE UNIQUE INDEX one_inventory_installation_per_request ON required_parts(tenant_id,inventory_reservation_id) WHERE inventory_reservation_id IS NOT NULL;
