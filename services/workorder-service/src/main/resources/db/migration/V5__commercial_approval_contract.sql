ALTER TABLE work_orders ADD COLUMN commercial_estimate_id uuid,ADD COLUMN commercial_revision int,ADD COLUMN quality_passed_at timestamptz;
ALTER TABLE work_orders ADD CONSTRAINT commercial_revision_pair CHECK((commercial_estimate_id IS NULL)=(commercial_revision IS NULL));
CREATE INDEX commercial_jobs ON work_orders(tenant_id,commercial_estimate_id) WHERE commercial_estimate_id IS NOT NULL;
