ALTER TABLE appointments ADD CONSTRAINT check_in_state_valid CHECK(check_in_state IS NULL OR check_in_state IN ('PENDING','RETRY_REQUIRED','COMPLETE'));
ALTER TABLE appointments ADD CONSTRAINT appointment_duration_consistent CHECK(expected_end_time=requested_start_time+estimated_duration_minutes*interval '1 minute');
CREATE INDEX appointment_customer ON appointments(tenant_id,customer_id,requested_start_time,id);
CREATE INDEX appointment_vehicle ON appointments(tenant_id,vehicle_id,requested_start_time,id);
CREATE INDEX appointment_audit ON appointment_status_history(tenant_id,appointment_id,created_at,id);
