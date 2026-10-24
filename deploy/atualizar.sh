#!/bin/sh
# Mantém o StreamHub da VPS igual à branch main do GitHub e reconstrói o container
# quando há commit novo. Instalado em /usr/local/bin/atualizar-streamhub e rodado pelo timer.
set -e
exec 9>/run/atualizar-streamhub.lock
flock -n 9 || exit 0

DIR=/srv/streamhub/app
REPO=https://github.com/devhygor/StreamHub.git

if [ ! -d "$DIR/.git" ]; then
  rm -rf "$DIR"
  git clone -q --depth 1 -b main "$REPO" "$DIR"
  old=none
else
  old=$(git -C "$DIR" rev-parse HEAD)
  git -C "$DIR" fetch -q --depth 1 origin main
  git -C "$DIR" reset -q --hard FETCH_HEAD
fi
new=$(git -C "$DIR" rev-parse HEAD)

running=$(docker ps -q -f name=streamhub-streamhub-1)
if [ "$old" != "$new" ] || [ -z "$running" ]; then
  echo "StreamHub: $old -> $new, reconstruindo"
  cd "$DIR/deploy"
  docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
  docker image prune -f >/dev/null
fi
