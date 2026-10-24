#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=booking_password="$BOOKING_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE booking_app LOGIN PASSWORD %L', :'booking_password') WHERE NOT EXISTS(SELECT FROM pg_roles WHERE rolname='booking_app') \gexec
SELECT 'CREATE SCHEMA booking AUTHORIZATION booking_app' WHERE NOT EXISTS(SELECT FROM pg_namespace WHERE nspname='booking') \gexec
SQL
