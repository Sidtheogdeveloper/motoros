#!/bin/sh
set -eu
exec node infrastructure/scripts/smoke-test.mjs "$@"
