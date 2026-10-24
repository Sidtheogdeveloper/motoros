CREATE TABLE customers(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,name varchar(120) NOT NULL,email varchar(254),phone varchar(32),created_at timestamptz NOT NULL,UNIQUE(tenant_id,id));
CREATE INDEX customers_tenant_name_idx ON customers(tenant_id,name);
CREATE TABLE vehicles(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,customer_id uuid NOT NULL,registration varchar(32) NOT NULL,make varchar(80) NOT NULL,model varchar(80) NOT NULL,created_at timestamptz NOT NULL,UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id));
CREATE INDEX vehicles_tenant_idx ON vehicles(tenant_id,created_at);
CREATE INDEX vehicles_registration_idx ON vehicles(tenant_id,registration);
