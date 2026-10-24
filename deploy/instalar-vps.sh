#!/usr/bin/env bash
# Instalação única na VPS (pode rodar de novo sem problema). No Git Bash:  ./deploy/instalar-vps.sh
# Depois disso, basta dar push na main: o timer da VPS puxa e reconstrói sozinho.
# O env (com a chave de acesso) e a pasta data/ (tokens) ficam só no servidor.
set -euo pipefail

VPS="${VPS:-root@179.198.107.45}"
DOMAIN="${DOMAIN:-stream.hygor.com.br}"
HERE="$(cd "$(dirname "$0")" && pwd)"

scp -q "$HERE/atualizar.sh" "$VPS:/usr/local/bin/atualizar-streamhub"
scp -q "$HERE/atualizar-streamhub.service" "$HERE/atualizar-streamhub.timer" "$VPS:/etc/systemd/system/"
ssh "$VPS" "
  set -e
  chmod +x /usr/local/bin/atualizar-streamhub
  mkdir -p /srv/streamhub/data
  if [ ! -f /srv/streamhub/streamhub.env ]; then
    KEY=\$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)
    printf 'PUBLIC_URL=https://$DOMAIN\nSTREAMHUB_KEY=%s\n' \"\$KEY\" > /srv/streamhub/streamhub.env
    chmod 600 /srv/streamhub/streamhub.env
  fi
  /usr/local/bin/atualizar-streamhub
  systemctl daemon-reload
  systemctl enable --now atualizar-streamhub.timer
"
echo "==> Pronto: https://$DOMAIN/?key=SUA_CHAVE"
echo "    Chave: ssh $VPS 'grep STREAMHUB_KEY /srv/streamhub/streamhub.env'"
