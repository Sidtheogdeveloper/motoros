#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=notification_password="$NOTIFICATION_PASSWORD" --set=analytics_password="$ANALYTICS_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE notification_app LOGIN PASSWORD %L', :'notification_password') WHERE NOT EXISTS(SELECT FROM pg_roles WHERE rolname='notification_app') \gexec
SELECT format('CREATE ROLE analytics_app LOGIN PASSWORD %L', :'analytics_password') WHERE NOT EXISTS(SELECT FROM pg_roles WHERE rolname='analytics_app') \gexec
SELECT 'CREATE SCHEMA notification AUTHORIZATION notification_app' WHERE NOT EXISTS(SELECT FROM pg_namespace WHERE nspname='notification') \gexec
SELECT 'CREATE SCHEMA analytics AUTHORIZATION analytics_app' WHERE NOT EXISTS(SELECT FROM pg_namespace WHERE nspname='analytics') \gexec
SQL
