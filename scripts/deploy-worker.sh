#!/usr/bin/env bash
set -euo pipefail

export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-${CLOUDFLARE_TOKEN:-}}}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${CF_ACCOUNT_ID:-}}"

if [[ -z "${CLOUDFLARE_API_TOKEN}" ]]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is empty. Configure GitHub secret CLOUDFLARE_API_TOKEN (or CF_API_TOKEN/CLOUDFLARE_TOKEN)." >&2
  exit 1
fi

if [[ -z "${CLOUDFLARE_ACCOUNT_ID}" ]]; then
  echo "ERROR: CLOUDFLARE_ACCOUNT_ID is empty. Configure GitHub secret CLOUDFLARE_ACCOUNT_ID (or CF_ACCOUNT_ID)." >&2
  exit 1
fi

SHA="$(git rev-parse HEAD)"
echo "Deploying commit SHA: ${SHA}"
echo "Using Cloudflare account: ${CLOUDFLARE_ACCOUNT_ID}"
echo "worker.js first 20 lines:"
sed -n '1,20p' worker.js

npm run predeploy:check
npx wrangler deploy --config wrangler.jsonc
