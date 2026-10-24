CREATE TABLE work_orders(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,branch_id uuid NOT NULL,vehicle_id uuid NOT NULL,complaint varchar(2000) NOT NULL,status varchar(40) NOT NULL,version bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,UNIQUE(tenant_id,id));
CREATE INDEX work_orders_branch_idx ON work_orders(tenant_id,branch_id,created_at);
CREATE INDEX work_orders_history_idx ON work_orders(tenant_id,vehicle_id,status);
CREATE TABLE work_order_audit(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,branch_id uuid NOT NULL,work_order_id uuid NOT NULL,actor_id uuid NOT NULL,action varchar(40) NOT NULL,note varchar(1000) NOT NULL,created_at timestamptz NOT NULL,FOREIGN KEY(tenant_id,work_order_id) REFERENCES work_orders(tenant_id,id));
CREATE INDEX work_order_audit_idx ON work_order_audit(tenant_id,work_order_id,created_at);
CREATE TABLE access_audit(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,actor_id uuid NOT NULL,vehicle_id uuid NOT NULL,branch_id uuid NOT NULL,created_at timestamptz NOT NULL);
