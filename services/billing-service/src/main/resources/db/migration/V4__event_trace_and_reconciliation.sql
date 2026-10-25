ALTER TABLE outbox_events ADD COLUMN traceparent varchar(128);
CREATE TABLE reconciliation_sources(aggregate_type varchar(80) NOT NULL,tenant_id uuid NOT NULL,aggregate_id uuid NOT NULL,fingerprint varchar(32) NOT NULL,event_id uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(aggregate_type,tenant_id,aggregate_id));
CREATE FUNCTION capture_event_trace() RETURNS trigger LANGUAGE plpgsql SET search_path TO billing,pg_temp AS $$ BEGIN
 NEW.traceparent=nullif(current_setting('motoros.traceparent',true),'');
 IF nullif(current_setting('motoros.causation_id',true),'') IS NOT NULL THEN NEW.causation_id=current_setting('motoros.causation_id',true)::uuid; END IF;RETURN NEW;
END $$;
CREATE TRIGGER outbox_trace BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION capture_event_trace();
