CREATE TABLE IF NOT EXISTS outbox_events(event_id uuid PRIMARY KEY,event_type varchar(80) NOT NULL,event_version int NOT NULL DEFAULT 1,tenant_id uuid NOT NULL,branch_id uuid,aggregate_id uuid NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now(),correlation_id varchar(64) NOT NULL,payload jsonb NOT NULL,actor_id uuid NOT NULL,delivery_status varchar(20) NOT NULL DEFAULT 'PENDING',attempts int NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE outbox_events ADD COLUMN aggregate_type varchar(80),ADD COLUMN aggregate_version bigint,ADD COLUMN producer varchar(32),ADD COLUMN canonical_type varchar(80),ADD COLUMN causation_id uuid,ADD COLUMN published_at timestamptz,ADD COLUMN status varchar(40) NOT NULL DEFAULT 'LEGACY_REQUIRES_RECONCILIATION',ADD COLUMN claim_token uuid,ADD COLUMN lease_until timestamptz,ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN last_error varchar(80),ADD COLUMN source_snapshot jsonb;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_status CHECK(status IN ('LEGACY_REQUIRES_RECONCILIATION','PENDING','CLAIMED','PUBLISHED','TERMINAL'));
CREATE INDEX outbox_due ON outbox_events(next_attempt_at,created_at) WHERE status IN ('PENDING','CLAIMED');
CREATE TABLE event_aggregate_versions(tenant_id uuid NOT NULL,aggregate_type varchar(80) NOT NULL,aggregate_id uuid NOT NULL,version bigint NOT NULL,PRIMARY KEY(tenant_id,aggregate_type,aggregate_id));
CREATE TABLE processed_events(consumer_name varchar(80) NOT NULL,event_id uuid NOT NULL,tenant_id uuid NOT NULL,event_type varchar(80) NOT NULL,aggregate_id uuid NOT NULL,event_hash varchar(64) NOT NULL,processed_at timestamptz NOT NULL DEFAULT now(),processing_status varchar(20) NOT NULL DEFAULT 'PROCESSED',PRIMARY KEY(consumer_name,event_id));
CREATE TABLE consumer_failures(id uuid PRIMARY KEY,event_id uuid,tenant_id uuid,consumer_name varchar(80) NOT NULL,category varchar(80) NOT NULL,message_body text NOT NULL,attempt_count int NOT NULL DEFAULT 1,status varchar(20) NOT NULL DEFAULT 'OPEN',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(consumer_name,event_id));
CREATE TABLE messaging_admin_audit(id uuid PRIMARY KEY,actor_id uuid NOT NULL,action varchar(80) NOT NULL,failure_id uuid,reason varchar(500) NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE consumer_projection_versions(consumer_name varchar(80) NOT NULL,tenant_id uuid NOT NULL,producer varchar(32) NOT NULL,aggregate_type varchar(80) NOT NULL,aggregate_id uuid NOT NULL,version bigint NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(consumer_name,tenant_id,producer,aggregate_type,aggregate_id));

CREATE FUNCTION normalize_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path TO workorder,pg_temp AS $$
DECLARE d jsonb; tab text; BEGIN
 NEW.producer=TG_TABLE_SCHEMA;
 NEW.canonical_type=CASE NEW.event_type WHEN 'PartReserved' THEN 'PartsReserved' WHEN 'PartConsumed' THEN 'PartsConsumed' WHEN 'PartReservationFailed' THEN 'PartsReservationFailed' ELSE NEW.event_type END;
 tab=CASE WHEN NEW.event_type LIKE 'Estimate%' THEN 'estimates' WHEN NEW.event_type LIKE 'Invoice%' THEN 'invoices' WHEN NEW.event_type LIKE 'Payment%' THEN 'payments' WHEN NEW.event_type='PartReservationFailed' THEN 'reservation_failures' WHEN NEW.event_type LIKE 'PartReserv%' OR NEW.event_type='PartConsumed' THEN 'stock_reservations' WHEN NEW.event_type LIKE 'StockTransfer%' THEN 'stock_transfers' ELSE NULL END;
 IF tab IS NOT NULL THEN EXECUTE format('select to_jsonb(x) from %I.%I x where tenant_id=$1 and id=$2',TG_TABLE_SCHEMA,tab) INTO d USING NEW.tenant_id,NEW.aggregate_id; ELSE d=NEW.source_snapshot; END IF;
 IF d IS NULL THEN NEW.status='LEGACY_REQUIRES_RECONCILIATION'; RETURN NEW; END IF;
 NEW.aggregate_type=coalesce(NEW.aggregate_type,tab);
 NEW.source_snapshot=jsonb_strip_nulls(jsonb_build_object('resourceId',d->'id','customerId',d->'customer_id','vehicleId',d->'vehicle_id','workOrderId',d->'work_order_id','invoiceId',d->'invoice_id','estimateId',d->'estimate_id','partId',d->'part_id','status',coalesce(d->'appointment_status',d->'status'),'resourceVersion',coalesce(d->'version','0'::jsonb),'startsAt',d->'requested_start_time','checkInAt',d->'check_in_at','completedAt',d->'work_completed_at','amount',coalesce(d->'amount',d->'total'),'currency',d->'currency','quantity',d->'quantity','recordType',d->'record_type','revision',d->'revision','sourceBranchId',d->'source_branch_id','destinationBranchId',d->'destination_branch_id'));
 NEW.payload=NEW.source_snapshot;
 INSERT INTO event_aggregate_versions(tenant_id,aggregate_type,aggregate_id,version) VALUES(NEW.tenant_id,NEW.aggregate_type,NEW.aggregate_id,1) ON CONFLICT(tenant_id,aggregate_type,aggregate_id) DO UPDATE SET version=event_aggregate_versions.version+1 RETURNING version INTO NEW.aggregate_version;
 NEW.status='PENDING';NEW.causation_id=coalesce(NEW.causation_id,NEW.event_id);RETURN NEW;
END $$;
CREATE TRIGGER outbox_envelope BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION normalize_outbox();

CREATE FUNCTION capture_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path TO workorder,pg_temp AS $$
DECLARE d jsonb=to_jsonb(NEW); oldrow jsonb; typ text; extra text; t uuid; b uuid; a uuid; BEGIN
 IF TG_OP='UPDATE' THEN oldrow=to_jsonb(OLD); END IF;
 t=coalesce((d->>'tenant_id')::uuid,(d->>'id')::uuid);b=(d->>'branch_id')::uuid;a=(d->>'id')::uuid;
 CASE TG_TABLE_NAME
 WHEN 'appointments' THEN
  IF TG_OP='INSERT' THEN typ='AppointmentBooked';
  ELSIF oldrow->>'appointment_status' IS DISTINCT FROM d->>'appointment_status' THEN typ=CASE d->>'appointment_status' WHEN 'CONFIRMED' THEN 'AppointmentConfirmed' WHEN 'CANCELLED' THEN 'AppointmentCancelled' ELSE NULL END;
  ELSIF oldrow->>'requested_start_time' IS DISTINCT FROM d->>'requested_start_time' THEN typ='AppointmentRescheduled'; END IF;
 WHEN 'work_orders' THEN
  IF TG_OP='INSERT' THEN typ='WorkOrderCreated';
  ELSIF oldrow->>'status' IS DISTINCT FROM d->>'status' THEN typ='WorkOrderStatusChanged';extra=CASE d->>'status' WHEN 'QUALITY_CHECK' THEN 'WorkOrderCompleted' WHEN 'READY_FOR_DELIVERY' THEN 'VehicleReadyForDelivery' WHEN 'DELIVERED' THEN 'VehicleDelivered' ELSE NULL END;
  ELSIF oldrow->>'assigned_technician_id' IS DISTINCT FROM d->>'assigned_technician_id' THEN typ='TechnicianAssigned'; END IF;
 WHEN 'vehicle_check_ins' THEN typ='VehicleCheckedIn';
 WHEN 'inspections' THEN IF d->>'status'='COMPLETED' AND (TG_OP='INSERT' OR oldrow->>'status' IS DISTINCT FROM 'COMPLETED') THEN typ='InspectionCompleted'; END IF;
 WHEN 'tenants' THEN typ='TenantCreated';
 WHEN 'branches' THEN typ='BranchCreated';b=a;
 WHEN 'staff_invitations' THEN typ='StaffInvited';
 WHEN 'customers' THEN typ='CustomerRegistered';
 WHEN 'vehicles' THEN typ=CASE TG_OP WHEN 'INSERT' THEN 'VehicleRegistered' ELSE 'VehicleUpdated' END;
 END CASE;
 IF TG_TABLE_NAME IN ('inspections','vehicle_check_ins') THEN
  SELECT to_jsonb(x)||jsonb_build_object('id',a,'work_order_id',x.id) INTO d FROM work_orders x WHERE x.tenant_id=t AND x.id=(d->>'work_order_id')::uuid;
 END IF;
 IF typ IS NOT NULL THEN
  INSERT INTO outbox_events(event_id,event_type,tenant_id,branch_id,aggregate_id,aggregate_type,correlation_id,payload,actor_id,source_snapshot) VALUES(gen_random_uuid(),typ,t,b,a,TG_TABLE_NAME,coalesce(nullif(current_setting('motoros.correlation_id',true),''),gen_random_uuid()::text),'{}',coalesce((d->>'created_by')::uuid,(d->>'service_advisor_id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid),d);
  IF extra IS NOT NULL THEN INSERT INTO outbox_events(event_id,event_type,tenant_id,branch_id,aggregate_id,aggregate_type,correlation_id,payload,actor_id,source_snapshot) VALUES(gen_random_uuid(),extra,t,b,a,TG_TABLE_NAME,coalesce(nullif(current_setting('motoros.correlation_id',true),''),gen_random_uuid()::text),'{}','00000000-0000-0000-0000-000000000000',d); END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER work_orders_events AFTER INSERT OR UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION capture_lifecycle();
CREATE TRIGGER vehicle_check_ins_events AFTER INSERT ON vehicle_check_ins FOR EACH ROW EXECUTE FUNCTION capture_lifecycle();
CREATE TRIGGER inspections_events AFTER INSERT OR UPDATE ON inspections FOR EACH ROW EXECUTE FUNCTION capture_lifecycle();
