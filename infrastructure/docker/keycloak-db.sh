#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=kc_password="$KEYCLOAK_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE keycloak_app LOGIN PASSWORD %L', :'kc_password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='keycloak_app') \gexec
SELECT 'CREATE DATABASE keycloak OWNER keycloak_app' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='keycloak') \gexec
SQL
