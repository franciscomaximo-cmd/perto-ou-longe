# Perto ou Longe

Jogo multijogador para telemóveis. Todos respondem com um número à mesma pergunta e depois votam em quem acham que ficou **mais longe** da resposta certa.

- Quem fica **mais perto** ganha 1 ponto. Se acertar no número exato, ganha 2.
- Há também perguntas de mapa ("Onde fica o Paquistão?"): cada um toca num mapa-mundo em branco. Conta a distância em km até ao país; tocar dentro do país é acertar em cheio.
- Quem vota no **mais longe** ganha 1 ponto.
- Empates dão ponto a todos. Ninguém pode votar em si próprio.
- Se numa ronda responderem menos de 3 jogadores (o autor da pergunta não responde, alguém não respondeu a tempo…), não há votação: passa logo à revelação, sem pontos de voto.
- No fim, se houver empate no 1.º lugar, os empatados vão a desempate: só eles respondem a uma pergunta extra, sem votação, e quem fica mais perto ganha ("venceu o desempate" na classificação). Se voltarem a empatar, sai outra pergunta. Os empates mais abaixo ficam como empate. O desempate decide a ordem, não dá pontos, e usa só perguntas com resposta grande (≥ 100) ou com casas decimais.
- Os números escrevem-se à portuguesa: vírgula decimal ("12,5") e ponto de milhares ("1.200").
- De 3 a 12 jogadores.
- O anfitrião (quem cria a sala) define, na configuração da sala, o número de perguntas (de 3 a 30, 10 por defeito), o tempo para responder e para votar (de 15 a 180 s, ou sem limite) e as categorias: Geografia, Desporto, História, Cultura Portuguesa, Adivinha o Preço e Ciência e Curiosidades (ou todas). Se as categorias escolhidas não tiverem perguntas suficientes, o anfitrião é avisado e o jogo fica mais curto.
- **Perguntas dos jogadores** (opção do anfitrião, mínimo 4 jogadores): cada um escreve uma pergunta com resposta em número antes de começar. Quando sai a pergunta de alguém, essa pessoa não responde nem conta para mais perto ou mais longe, mas vota. Com 3 jogadores sobravam 2 a responder e cada um só podia votar no outro, por isso são precisos 4.
- **Revelação em passos**, avançada pelo anfitrião (todos veem o mesmo): os palpites aparecem um a um, do mais longe para o mais perto, numa reta numérica (valores muito afastados ficam na ponta, a tracejado, com uma seta) ou no mapa, com uma linha até ao país; depois a resposta certa, quem votou em quem e, por fim, os pontos e a classificação.
- **Prémios no fim**: mais certeiro (mais vezes o mais perto; em empate, o menor erro médio relativo), mais longe da realidade (mais vezes o mais longe) e melhor a ler os outros (mais votos certos). Em empate aparecem todos.
- As perguntas são de conhecimento: nenhuma se resolve com contas. As de "Adivinha o Preço" são preços em euros em Portugal, sempre com o ano de referência na pergunta.

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
server/geo.js          perguntas de mapa: distância de um ponto a um país
server/questions.json  banco de perguntas
scripts/gerar-mapa.js  gera public/mapa.svg a partir do world-atlas
public/                cliente (HTML/CSS/JS sem build)
test/                  testes (node --test)
```

Para adicionar perguntas, acrescenta entradas a `server/questions.json`:
`{ "text": "…?", "answer": 123, "unit": "metros", "category": "geografia" }` (o campo `unit` é opcional).
Categorias: `geografia`, `desporto`, `historia`, `cultura`, `precos`, `ciencia` (os nomes que aparecem
no jogo estão em `CATEGORIES`, em `server/rooms.js`).

Perguntas de mapa: `{ "type": "map", "country": "586", "label": "Paquistão", "article": "o", "category": "geografia" }`.
O texto da pergunta é montado a partir do artigo: `"o"`/`"a"` dá "Onde fica o Paquistão?", `"os"`/`"as"`
dá "Onde ficam as Filipinas?" e `""` (sem artigo) dá "Onde fica Angola?". Um `"note"` opcional
acrescenta uma explicação entre parênteses ("Onde fica a Geórgia (o país)?").
O `country` é o código ISO numérico do país, tal como aparece no `world-atlas` (países à escala 1:110m;
alguns países pequenos, como Malta ou Singapura, não existem a esta escala). Cerca de um quarto das
perguntas de cada jogo são de mapa; os desempates usam sempre perguntas de números.
