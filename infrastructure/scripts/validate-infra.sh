#!/bin/sh
set -eu
exec node infrastructure/scripts/cloud.mjs validate "$@"
