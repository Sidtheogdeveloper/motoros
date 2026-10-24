#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=tenant_password="$TENANT_PASSWORD" --set=customer_password="$CUSTOMER_PASSWORD" --set=workorder_password="$WORKORDER_PASSWORD" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE tenant_app LOGIN PASSWORD :'tenant_password';
CREATE ROLE customer_app LOGIN PASSWORD :'customer_password';
CREATE ROLE workorder_app LOGIN PASSWORD :'workorder_password';
CREATE SCHEMA tenant AUTHORIZATION tenant_app;
CREATE SCHEMA customer AUTHORIZATION customer_app;
CREATE SCHEMA workorder AUTHORIZATION workorder_app;
SQL
