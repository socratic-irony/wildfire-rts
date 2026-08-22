#!/usr/bin/env bash
# Double-click this file in Finder to launch Wildfire RTS.
# Opens a browser tab once Vite is ready, then keeps the server running.
# Close the Terminal window (or Ctrl-C) to stop.

cd "$(dirname "$0")"

PORT=5173
URL="http://localhost:$PORT"

# Kill any leftover Vite on this port so the port is free
lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null || true

# Start Vite in the background, tee output so we can watch for "ready"
npm run dev 2>&1 &
VITE_PID=$!

echo "Starting Wildfire RTS dev server (pid $VITE_PID)..."
echo "Waiting for Vite on $URL ..."

# Poll until Vite is accepting connections (max 30 s)
for i in $(seq 1 60); do
  if curl -s -o /dev/null "$URL"; then
    break
  fi
  sleep 0.5
done

echo "Server ready — opening $URL"
open "$URL"

# Keep script alive so the Terminal window stays open (Ctrl-C to stop)
wait $VITE_PID
