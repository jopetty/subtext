#!/bin/bash
set -euo pipefail

PORT=8080
IP=$(ipconfig getifaddr en0)

# Keep local assets in sync with cache-busting revision params.
npm run rev:assets >/dev/null

echo "Serving Subtext at http://$IP:$PORT"
python3 -m http.server $PORT
