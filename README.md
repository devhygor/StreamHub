# StreamHub

Chat unificado (Twitch + Kick + YouTube) e troca de título/jogo em um clique, feito para quem transmite pelo OBS.

## Como rodar
**Na VPS (recomendado, 24h):** https://stream.hygor.com.br/?key=SUA_CHAVE
- Instalação única: `./deploy/instalar-vps.sh` (Git Bash). Cria o container, a chave de acesso e o timer.
- Atualizar: é só dar push na `main`. A VPS puxa a cada 2 min e reconstrói sozinha (`deploy/atualizar.sh`).
- A chave fica em `/srv/streamhub/streamhub.env` (`STREAMHUB_KEY`). Os tokens das contas ficam em `/srv/streamhub/data`.

**No PC (teste/visual):** `npm install`, `npm start` ou `iniciar.bat` e abra http://localhost:3737. O chat da Kick não funciona assim (exige URL pública https).

Em **Contas**, siga o passo a passo de cada plataforma. Modo demonstração em **Ajustes** para ver o visual sem live.

## No OBS
- **Dock do chat:** Docks → Docks de Navegador Personalizados → URL `https://stream.hygor.com.br/?key=SUA_CHAVE`.
- **Chat na tela da live:** fonte *Navegador* → `https://stream.hygor.com.br/overlay.html?key=SUA_CHAVE` (fundo transparente).
  Parâmetros: `?platforms=twitch,kick&size=22&fade=20`.

## O que faz cada plataforma
| | Ler chat | Enviar | Título | Jogo |
|---|---|---|---|---|
| Twitch | IRC (sem login) + emotes 7TV | sim (login) | sim | sim |
| Kick | Webhook oficial (precisa da VPS) | sim (login) | sim | sim |
| YouTube | API oficial (polling) | sim (login) | sim | não (limite da API) |

## Pegadinhas
- Kick: o chat vem por webhook. No app da Kick, cole `https://stream.hygor.com.br/webhooks/kick` em Webhook URL e ative Enable Webhooks. O Pusher antigo foi desligado pela Kick.
- YouTube: cota gratuita ≈ 3h30 de live por dia com leitura a cada 8s; ajuste em Ajustes.
- Credenciais ficam em `data/config.json` (fora do git).
