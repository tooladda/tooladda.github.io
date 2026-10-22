#!/usr/bin/env bash
set -euo pipefail

# Submit ToolAdda URLs to IndexNow (Bing, Yandex, etc.)
# Run from the /c/Projects/toolsa folder in MINGW64/Git Bash AFTER the key file is live at:
#   https://tooladda.online/42e7905bc10d06e4a3dfaa7a9fd01576.txt
# Usage:  bash submit-indexnow.sh

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

JSON_FILE="indexnow-submit.json"

if [[ ! -f "$JSON_FILE" ]]; then
  echo "Missing $JSON_FILE" >&2
  exit 1
fi

KEY="$(sed -nE 's/.*"key": "([^"]+)".*/\1/p' "$JSON_FILE" | head -n 1)"
KEY_LOCATION="$(sed -nE 's/.*"keyLocation": "([^"]+)".*/\1/p' "$JSON_FILE" | head -n 1)"

if [[ -z "$KEY" || -z "$KEY_LOCATION" ]]; then
  echo "Could not parse key/keyLocation from $JSON_FILE" >&2
  exit 1
fi

echo "Checking verification file at $KEY_LOCATION ..."
REMOTE_KEY="$(curl -fsSL "$KEY_LOCATION" | tr -d '\r\n')"

if [[ "$REMOTE_KEY" != "$KEY" ]]; then
  echo "Verification failed: expected '$KEY' but received '$REMOTE_KEY'." >&2
  echo "Ensure the key file is published at $KEY_LOCATION and is accessible over HTTPS." >&2
  exit 1
fi

echo "Verification OK. Submitting URLs..."

RESPONSE_FILE="$(mktemp)"
set +e
curl -sS --fail-with-body -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "User-Agent: toolsa-indexnow-submit/1.0" \
  --data @"$JSON_FILE" \
  -o "$RESPONSE_FILE" \
  -w "\nHTTP status: %{http_code}\n"
STATUS=$?
set -e

cat "$RESPONSE_FILE"
rm -f "$RESPONSE_FILE"

exit "$STATUS"
# 200 or 202 = accepted. 403 = key file not found/verified on the domain yet.
