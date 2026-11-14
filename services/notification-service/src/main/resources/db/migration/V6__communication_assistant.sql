CREATE TABLE communication_drafts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  purpose varchar(40) NOT NULL,
  channel varchar(16) NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP')),
  language varchar(8) NOT NULL CHECK (language IN ('en','ta')),
  tone varchar(16) NOT NULL CHECK (tone IN ('PROFESSIONAL','FRIENDLY','CONCISE')),
  include_details boolean NOT NULL,
  source_envelope jsonb NOT NULL,
  encrypted_preview text NOT NULL,
  facts_hash char(64) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('DRAFT','APPROVED','QUEUED')),
  version bigint NOT NULL DEFAULT 0,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours'
);
CREATE INDEX communication_drafts_scope ON communication_drafts(tenant_id,branch_id,actor_id,updated_at DESC);
CREATE INDEX communication_drafts_expiry ON communication_drafts(expires_at);
ALTER TABLE notification_requests ADD COLUMN assistant_purpose varchar(40);
INSERT INTO notification_templates(template_key,language,subject,body,optional) VALUES
 ('estimate-explanation','en','Your approved workshop estimate','Your workshop estimate is approved. The approved scope and total are recorded in MotorOS.',false),
 ('estimate-explanation','ta','ஒப்புதல் பெற்ற செலவு மதிப்பீடு','உங்கள் பணிமனை மதிப்பீடு ஒப்புதல் பெற்றுள்ளது. ஒப்புதல் பெற்ற விவரங்களும் மொத்தத் தொகையும் MotorOS இல் பதிவாகியுள்ளன.',false);
