#!/bin/sh
# Diffs a fresh local D1 with every migration in prisma/migrations applied against prisma/schema.
# `pnpm db:diff >> prisma/migrations/<new file>.sql` writes a new migration; `pnpm db:check` fails on drift.
set -eu
state=$(mktemp -d)
trap 'rm -rf "$state"' EXIT
CI=true pnpm -s wrangler d1 migrations apply DB --local --persist-to "$state" >/dev/null
db=$(find "$state" -name '*.sqlite' ! -name 'metadata.sqlite' | head -n 1)
DATABASE_URL="file:$db" pnpm -s prisma migrate diff --from-config-datasource --to-schema prisma/schema "$@"
