#!/bin/bash
exec 3<>/dev/tcp/localhost/9000
printf 'GET /health/ready HTTP/1.0\r\n\r\n' >&3
grep -q '200' <&3
