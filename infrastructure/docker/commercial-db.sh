#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=inventory_password="$INVENTORY_PASSWORD" --set=billing_password="$BILLING_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE inventory_app LOGIN PASSWORD %L', :'inventory_password') WHERE NOT EXISTS(SELECT FROM pg_roles WHERE rolname='inventory_app') \gexec
SELECT format('CREATE ROLE billing_app LOGIN PASSWORD %L', :'billing_password') WHERE NOT EXISTS(SELECT FROM pg_roles WHERE rolname='billing_app') \gexec
SELECT 'CREATE SCHEMA inventory AUTHORIZATION inventory_app' WHERE NOT EXISTS(SELECT FROM pg_namespace WHERE nspname='inventory') \gexec
SELECT 'CREATE SCHEMA billing AUTHORIZATION billing_app' WHERE NOT EXISTS(SELECT FROM pg_namespace WHERE nspname='billing') \gexec
SQL
