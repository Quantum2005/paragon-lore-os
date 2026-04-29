#!/usr/bin/env bash
set -euo pipefail

SHA="$(git rev-parse HEAD)"
echo "Deploying commit SHA: ${SHA}"
echo "worker.js first 20 lines:"
sed -n '1,20p' worker.js

npm run predeploy:check
npx wrangler deploy
