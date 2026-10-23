#!/usr/bin/env bash
# Web-App auf Cloudflare Pages veröffentlichen (Projekt „karteikartents“ → https://karteikartents.pages.dev).
# Lädt nur die App-Dateien hoch (kein content/, kein großes Video; Pages erlaubt max. 25 MB je Datei).
# Video in kleiner Fassung: KarteikartenApp/exports/werbung/Video/… (unter 10 MB).
set -euo pipefail
cd "$(dirname "$0")"
DIST="$(mktemp -d)"; trap 'rm -rf "$DIST"' EXIT
git ls-files | grep -v -E '^(content/|README\.md$|video/|\.gitignore$|deploy-cloudflare\.sh$)' | while read -r f; do
  mkdir -p "$DIST/$(dirname "$f")"; cp "$f" "$DIST/$f"
done
mkdir -p "$DIST/video"
cp video/vorschau.jpg "$DIST/video/"
SMALL="../KarteikartenApp/exports/werbung/Video/Karteikarten · YouTube (GitHub, unter 10 MB).mp4"
[ -f "$SMALL" ] && cp "$SMALL" "$DIST/video/karteikarten.mp4"
XDG_CONFIG_HOME="$HOME/.karteikarten-cloudflare" CLOUDFLARE_ACCOUNT_ID=2ed9bdeb029732b12a561b0c49fb786f \
  npx --yes wrangler@4.147.0 pages deploy "$DIST" --project-name karteikartents --branch main --commit-dirty=true
