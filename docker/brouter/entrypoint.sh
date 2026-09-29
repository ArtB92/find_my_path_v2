#!/bin/sh
set -eu
cd /opt/brouter

# Routing data lives in a volume: downloaded once (a few hundred MB per tile), reused afterwards.
for tile in $BROUTER_TILES; do
  if [ ! -s "segments4/$tile.rd5" ]; then
    echo "Downloading routing data $tile.rd5 (first start only)..."
    curl -fL --retry 3 -o "segments4/$tile.rd5.part" "https://brouter.de/brouter/segments4/$tile.rd5"
    mv "segments4/$tile.rd5.part" "segments4/$tile.rd5"
  fi
done

echo "BRouter listening on :17777"
exec java $JAVA_OPTS -cp brouter.jar btools.server.RouteServer segments4 profiles2 customprofiles 17777 "$BROUTER_THREADS" 0.0.0.0
