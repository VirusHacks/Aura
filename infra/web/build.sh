#!/bin/bash
# Builds the Next.js app and packages the standalone server as a Lambda zip at
# infra/web/.build/web.zip. AEROSCOPE_AQ_API_URL / AEROSCOPE_AQ_API_KEY must be
# set here if the app should use the data API: the zones route is prerendered
# from the demo dataset when they are absent at build time.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/infra/web/.build"
APP="$OUT/app"

cd "$ROOT"
npm run build

rm -rf "$OUT"
mkdir -p "$APP"
cp -R .next/standalone/. "$APP/"
cp -R .next/static "$APP/.next/static"
[ -d public ] && cp -R public "$APP/public"
rm -rf "$APP/.next/cache"
ln -s /tmp/cache "$APP/.next/cache"
cp infra/web/run.sh "$APP/run.sh"
chmod +x "$APP/run.sh"

# Build-time secrets must not ship in the bundle; Lambda env vars supply them.
rm -f "$APP"/.env*

# Native modules traced from macOS would not load on Lambda (linux/arm64):
# swap sharp's platform binaries for the Lambda ones.
if [ -d "$APP/node_modules/sharp" ]; then
  SHARP_VERSION="$(node -p "require('$APP/node_modules/sharp/package.json').version")"
  TMP="$(mktemp -d)"
  (cd "$TMP" && npm init -y >/dev/null && npm install --no-audit --no-fund \
    --os=linux --cpu=arm64 --libc=glibc "sharp@$SHARP_VERSION" >/dev/null)
  rm -rf "$APP"/node_modules/@img/sharp-darwin-* "$APP"/node_modules/@img/sharp-libvips-darwin-*
  cp -R "$TMP"/node_modules/@img/*linux-arm64* "$APP/node_modules/@img/"
  rm -rf "$TMP"
fi
if find "$APP/node_modules" -path '*darwin*' -name '*.node' 2>/dev/null | grep -q .; then
  echo "error: macOS native modules in bundle:" >&2
  find "$APP/node_modules" -path '*darwin*' -name '*.node' >&2
  exit 1
fi

(cd "$APP" && zip -qry "$OUT/web.zip" .)
echo "packaged $(du -h "$OUT/web.zip" | cut -f1) -> $OUT/web.zip"
