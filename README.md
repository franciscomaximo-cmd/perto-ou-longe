# Perto ou Longe

Jogo multijogador para telemóveis. Todos respondem com um número à mesma pergunta e depois votam em quem acham que ficou **mais longe** da resposta certa.

- Quem fica **mais perto** ganha 1 ponto. Se acertar no número exato, ganha 2.
- Quem vota no **mais longe** ganha 1 ponto.
- Empates dão ponto a todos. Ninguém pode votar em si próprio.
- De 3 a 12 jogadores.
- O anfitrião (quem cria a sala) define, na configuração da sala, o número de perguntas (de 3 a 30, 10 por defeito) e o tempo para responder e para votar (de 15 a 180 s, ou sem limite).
- As perguntas são de conhecimento: nenhuma se resolve com contas.

## Correr localmente

```bash
npm install
npm start        # http://localhost:3000
npm run dev      # reinicia sozinho ao mudar o código
npm test
```

Para testar com telemóveis na mesma rede Wi-Fi, abre `http://<IP-do-computador>:3000`.

## Publicar no Render (gratuito)

1. Põe o projeto num repositório GitHub.
2. No Render: **New → Blueprint** e escolhe o repositório (usa o `render.yaml`).
   Em alternativa, usa **New → Web Service** com Build `npm install`, Start `npm start` e o plano **Free**.
3. Partilha o endereço `https://<nome>.onrender.com`.

Notas do plano gratuito:
- O serviço adormece após ~15 min sem visitas e o primeiro acesso demora cerca de 30 a 50 s a acordar.
- O estado do jogo vive só em memória, por isso as salas perdem-se quando o serviço reinicia ou adormece.

## Estrutura

```
server/index.js        Express + Socket.IO, eventos
server/rooms.js        salas, fases, temporizadores, estado visível a cada jogador
server/game.js         pontuação (lógica pura)
server/questions.json  banco de perguntas
public/                cliente (HTML/CSS/JS sem build)
test/                  testes (node --test)
```

Para adicionar perguntas, acrescenta entradas a `server/questions.json`:
`{ "text": "…?", "answer": 123, "unit": "metros" }` (o campo `unit` é opcional).
