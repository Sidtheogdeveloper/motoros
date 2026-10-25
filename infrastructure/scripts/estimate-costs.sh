#!/bin/sh
set -eu
exec node infrastructure/scripts/estimate-costs.mjs "$@"
