ALTER TABLE work_order_tasks ADD COLUMN approved_estimate_id uuid, ADD COLUMN origin_quality_check_id uuid;
ALTER TABLE quality_checks ADD CONSTRAINT quality_check_tenant_id UNIQUE(tenant_id,id);
ALTER TABLE work_order_tasks ADD CONSTRAINT task_quality_origin FOREIGN KEY(tenant_id,origin_quality_check_id) REFERENCES quality_checks(tenant_id,id);
