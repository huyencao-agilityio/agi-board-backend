#!/bin/sh
# Uploads the preset board backgrounds in assets/backgrounds/ to the IMAGES R2 bucket, at the object keys
# prisma/seed.sql stores (system/backgrounds/<key>.jpg and system/backgrounds/thumbs/<key>.jpg).
# Safe to re-run: each put overwrites the object.
#   sh scripts/upload-backgrounds.sh --local                   # local R2 used by wrangler dev (pnpm db:seed)
#   sh scripts/upload-backgrounds.sh --remote --env staging    # deployed bucket (deploy workflow)
set -eu
mode=${1:?--local or --remote}
if [ "$mode" = --remote ]; then
  [ "${2:-}" = --env ] && [ -n "${3:-}" ] || { echo "usage: $0 --remote --env <staging|production>" >&2; exit 1; }
  bucket="agi-board-images-$3" # bucket names follow wrangler.jsonc r2_buckets
else
  bucket=agi-board-images-local
fi

cd "$(dirname "$0")/../assets/backgrounds"
# Every image the seed points to must exist here, or boards would show a broken background.
for key in $(grep -o "system/backgrounds/[a-z_/]*\.jpg" ../../prisma/seed.sql | sed 's#^system/backgrounds/##'); do
  [ -f "$key" ] || { echo "missing assets/backgrounds/$key (referenced by prisma/seed.sql)" >&2; exit 1; }
done
for file in *.jpg thumbs/*.jpg; do
  pnpm -s exec wrangler r2 object put "$bucket/system/backgrounds/$file" --file "$file" \
    --content-type image/jpeg "$mode" >/dev/null
  echo "uploaded system/backgrounds/$file"
done
