# StreamHub

Chat unificado (Twitch + Kick + YouTube) e troca de título/jogo em um clique, feito para quem transmite pelo OBS.

## Como rodar
1. `npm install` (uma vez) e depois `npm start` — ou dê duplo clique em `iniciar.bat`.
2. Abra http://localhost:3737. Em **Contas**, siga o passo a passo de cada plataforma (cada uma pede um app próprio gratuito).
3. Para testar o visual sem estar ao vivo: **Ajustes → Modo demonstração**.

## No OBS
- **Dock do chat:** Docks → Docks de Navegador Personalizados → URL `http://localhost:3737/`.
- **Chat na tela da live:** fonte *Navegador* → `http://localhost:3737/overlay.html` (fundo transparente).
  Parâmetros: `?platforms=twitch,kick&size=22&fade=20`.

## O que faz cada plataforma
| | Ler chat | Enviar | Título | Jogo |
|---|---|---|---|---|
| Twitch | IRC (sem login) + emotes 7TV | sim (login) | sim | sim |
| Kick | Pusher (não oficial) | sim (login) | sim | sim |
| YouTube | API oficial (polling) | sim (login) | sim | não (limite da API) |

## Pegadinhas
- Kick: o chat usa o websocket não oficial; se a busca do Chatroom ID for bloqueada, informe o ID manualmente.
- YouTube: cota gratuita ≈ 3h30 de live por dia com leitura a cada 8s; ajuste em Ajustes.
- Credenciais ficam em `data/config.json` (fora do git).
