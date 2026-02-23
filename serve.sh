#!/bin/bash
PORT=8080
IP=$(ipconfig getifaddr en0)
echo "Serving Subtext at http://$IP:$PORT"
python3 -m http.server $PORT
