CREATE TABLE messaging_runtime_metadata(key varchar(80) PRIMARY KEY,value varchar(200) NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX published_outbox_recovery ON outbox_events(created_at,event_id) WHERE status='PUBLISHED';
