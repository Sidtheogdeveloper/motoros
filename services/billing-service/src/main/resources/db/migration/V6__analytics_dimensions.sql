-- Preserve business dates and identifiers when an aggregate is replayed or reconciled.
CREATE FUNCTION reporting_outbox_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path TO billing,pg_temp AS $$
DECLARE d jsonb;
BEGIN
  IF NEW.producer = 'billing' AND (NEW.aggregate_type IN ('invoices','payments','estimates')) THEN
    EXECUTE format('select to_jsonb(x) from %I.%I x where tenant_id=$1 and id=$2',
                   TG_TABLE_SCHEMA, NEW.aggregate_type)
      INTO d USING NEW.tenant_id, NEW.aggregate_id;
    NEW.payload = NEW.payload || jsonb_strip_nulls(CASE NEW.aggregate_type WHEN 'invoices' THEN jsonb_build_object('issuedAt',d->'issued_at') WHEN 'payments' THEN jsonb_build_object('paymentAt',d->'created_at') ELSE jsonb_build_object('decidedAt',d->'decided_at') END);
    NEW.source_snapshot = NEW.payload;
  END IF;
  RETURN NEW;
END $$;

-- PostgreSQL runs same-event triggers in name order, after outbox_envelope here.
CREATE TRIGGER reporting_outbox_fields BEFORE INSERT ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION reporting_outbox_fields();

-- The existing bounded reconciliation worker restores the added fields for earlier rows.
DELETE FROM reconciliation_sources;
