#!/bin/bash
# Lambda handler: the Lambda Web Adapter layer (/opt/bootstrap) runs this and
# proxies invocations to the Next.js standalone server on $PORT.
# .next/cache is a symlink to /tmp/cache, the only writable path on Lambda.
mkdir -p /tmp/cache
exec node server.js
