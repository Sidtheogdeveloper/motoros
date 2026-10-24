ALTER TABLE stock_reservations ADD COLUMN approved_estimate_id uuid, ADD COLUMN approved_revision int;
ALTER TABLE stock_reservations ADD CONSTRAINT consumption_approval_pair CHECK((approved_estimate_id IS NULL)=(approved_revision IS NULL));
ALTER TABLE stock_transfer_items ADD COLUMN missing_quantity numeric(15,3) NOT NULL DEFAULT 0 CHECK(missing_quantity>=0);
ALTER TABLE stock_transfer_items ADD CONSTRAINT transfer_receipt_conservation CHECK(received_quantity+damaged_quantity+missing_quantity<=quantity);
