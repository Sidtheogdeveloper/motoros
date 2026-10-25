CREATE TABLE appointment_reminder_jobs(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,branch_id uuid NOT NULL,appointment_id uuid NOT NULL,starts_at timestamptz NOT NULL,due_at timestamptz NOT NULL,status varchar(20) NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','EMITTED','CANCELLED')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,appointment_id,starts_at),FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id));
CREATE INDEX appointment_reminders_due ON appointment_reminder_jobs(due_at) WHERE status='SCHEDULED';
CREATE FUNCTION schedule_appointment_reminder() RETURNS trigger LANGUAGE plpgsql SET search_path TO booking,pg_temp AS $$ BEGIN
 UPDATE appointment_reminder_jobs SET status='CANCELLED',updated_at=now() WHERE tenant_id=NEW.tenant_id AND appointment_id=NEW.id AND status='SCHEDULED' AND (starts_at<>NEW.requested_start_time OR NEW.appointment_status<>'CONFIRMED');
 IF NEW.appointment_status='CONFIRMED' AND NEW.requested_start_time>now() THEN
  INSERT INTO appointment_reminder_jobs(id,tenant_id,branch_id,appointment_id,starts_at,due_at) VALUES(gen_random_uuid(),NEW.tenant_id,NEW.branch_id,NEW.id,NEW.requested_start_time,greatest(now(),NEW.requested_start_time-interval '24 hours')) ON CONFLICT(tenant_id,appointment_id,starts_at) DO NOTHING;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER appointment_reminder_schedule AFTER INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION schedule_appointment_reminder();
