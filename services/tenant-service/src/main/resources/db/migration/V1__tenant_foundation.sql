CREATE TABLE tenants(id uuid PRIMARY KEY,name varchar(120) NOT NULL,created_at timestamptz NOT NULL);
CREATE TABLE branches(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),name varchar(100) NOT NULL,city varchar(100) NOT NULL,created_at timestamptz NOT NULL,UNIQUE(tenant_id,name));
CREATE INDEX branches_tenant_idx ON branches(tenant_id);
CREATE TABLE staff_users(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),email varchar(254) NOT NULL UNIQUE,password_hash varchar(100) NOT NULL,role varchar(40) NOT NULL CHECK(role='BRAND_OWNER'));
