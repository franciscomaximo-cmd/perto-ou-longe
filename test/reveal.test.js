'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { precisionOf, relativeError } = require('../public/reveal/precision');
const { ThemeDeck, REVEAL_THEMES } = require('../server/themes');
const { Room } = require('../server/rooms');

// --- Precisão -----------------------------------------------------------------------------

test('precisão: palpite igual à resposta é 0 (em cheio)', () => {
  assert.equal(precisionOf(206, 206), 0);
  assert.equal(precisionOf(0, 0), 0);
  assert.equal(precisionOf(-5, -5), 0);
});

test('precisão: 100% de erro dá 1 e erros maiores dão mais de 1', () => {
  assert.equal(precisionOf(200, 100), 1);
  assert.equal(precisionOf(0, 100), 1);
  assert.ok(precisionOf(300, 100) > 1);
  assert.ok(precisionOf(1247, 10) > precisionOf(300, 100));
});

test('precisão: escala logarítmica, com 1%, 10% e 50% bem distintos', () => {
  const p1 = precisionOf(101, 100);
  const p10 = precisionOf(110, 100);
  const p50 = precisionOf(150, 100);
  assert.ok(p1 > 0 && p1 < p10 && p10 < p50 && p50 < 1);
  // Bem distintos: cada um pelo menos 0,2 acima do anterior.
  assert.ok(p10 - p1 > 0.2 && p50 - p10 > 0.2, `${p1} ${p10} ${p50}`);
  // Simétrica: falhar por cima ou por baixo dá o mesmo.
  assert.equal(precisionOf(90, 100), precisionOf(110, 100));
});

test('precisão: resposta 0 mede o erro em unidades (sem dividir por zero)', () => {
  assert.equal(relativeError(1, 0), 1);
  assert.equal(precisionOf(1, 0), 1);
  assert.ok(Number.isFinite(precisionOf(5, 0)) && precisionOf(5, 0) > 1);
  assert.ok(precisionOf(0.1, 0) < 1);
});

// --- Gerador com semente (variação determinística dos temas) -------------------------------

test('gerador com semente: a mesma semente dá sempre os mesmos números', () => {
  const { seeded } = require('../public/reveal/seeded');
  const a = seeded('ABCD|3|jogador-1');
  const b = seeded('ABCD|3|jogador-1');
  const seqA = Array.from({ length: 20 }, a);
  assert.deepEqual(seqA, Array.from({ length: 20 }, b), 'igual em todos os telemóveis e depois de recarregar');
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
  // Outro jogador ou outra ronda: outros números.
  assert.notDeepEqual(Array.from({ length: 5 }, seeded('ABCD|3|jogador-2')), seqA.slice(0, 5));
  assert.notDeepEqual(Array.from({ length: 5 }, seeded('ABCD|4|jogador-1')), seqA.slice(0, 5));
});

// --- Posição de apresentação (resultado visual relativo à ronda) --------------------------

const { presentationOf, MIDDLE_MIN, MIDDLE_MAX } = require('../public/reveal/presentation');

// Como o servidor: distâncias, mais perto, mais longe e "em cheio"; e a posição de cada um.
function showsFor(answer, guesses) {
  const ids = guesses.map((_, i) => `p${i}`);
  const dist = Object.fromEntries(ids.map((id, i) => [id, Math.abs(guesses[i] - answer)]));
  const min = Math.min(...Object.values(dist));
  const max = Math.max(...Object.values(dist));
  const result = {
    closest: ids.filter((id) => dist[id] === min),
    farthest: ids.filter((id) => dist[id] === max),
    exact: min === 0 ? ids.filter((id) => dist[id] === 0) : [],
  };
  const players = ids.map((id, i) => ({ id, precision: precisionOf(guesses[i], answer) }));
  return presentationOf(players, result);
}

test('apresentação: o vencedor fica sempre em cima (nível 0) e nunca falha, mesmo a errar 75%', () => {
  // Pergunta difícil: todos falham por mais de 70%; p0 ganha a falhar por 75%.
  const shows = showsFor(384400, [96100, 40000, 1000000, 2000000]);
  assert.equal(shows.p0.level, 0);
  assert.equal(shows.p0.winner, true);
  assert.equal(shows.p0.miss, false, 'o vencedor nunca falha visualmente');
  assert.equal(shows.p0.exact, false);
  for (const id of ['p1', 'p2']) assert.ok(shows[id].level > 0 && shows[id].level < 1);
  assert.equal(shows.p2.miss, true, 'quem erra mais de 100% (e não ganhou) continua a falhar');
});

test('apresentação: o "mais longe" fica sempre em baixo (nível 1) e falha', () => {
  for (const [answer, guesses] of [[206, [150, 300, 210]], [50, [51, 52, 53, 54]], [10, [12, 9, 1247, 15]]]) {
    const shows = showsFor(answer, guesses);
    const far = Object.entries(shows).filter(([, s]) => s.farthest);
    assert.ok(far.length >= 1);
    for (const [, s] of far) {
      assert.equal(s.level, 1);
      assert.equal(s.miss, true);
      assert.equal(s.winner, false);
    }
  }
});

test('apresentação: os do meio ficam entre o vencedor e o "mais longe", pela ordem dos palpites', () => {
  const guesses = [8000, 9000, 8849, 7500, 10000, 6000, 8800, 12000, 8500, 5000, 20000, 8900];
  const shows = showsFor(8849, guesses);
  assert.equal(shows.p2.level, 0);
  assert.equal(shows.p2.exact, true, '"em cheio" tem destaque extra');
  assert.equal(shows.p10.level, 1);
  const middle = Object.entries(shows).filter(([, s]) => !s.winner && !s.farthest);
  for (const [, s] of middle) assert.ok(s.level >= MIDDLE_MIN && s.level <= MIDDLE_MAX);
  // Mais perto da resposta → nível mais baixo (melhor).
  const miss = (id) => Math.abs(guesses[Number(id.slice(1))] - 8849);
  const byDistance = middle.map(([id]) => id).sort((a, b) => miss(a) - miss(b));
  for (let i = 1; i < byDistance.length; i++) assert.ok(shows[byDistance[i]].level >= shows[byDistance[i - 1]].level);
});

test('apresentação: empate no mais perto — todos os empatados em cima', () => {
  const shows = showsFor(206, [201, 211, 300, 150]);
  for (const id of ['p0', 'p1']) {
    assert.equal(shows[id].level, 0);
    assert.equal(shows[id].winner, true);
  }
  assert.equal(shows.p2.farthest, true);
  // Dois "em cheio": os dois em cima, com destaque.
  const two = showsFor(1974, [1974, 1975, 1974, 1960]);
  assert.ok(two.p0.winner && two.p0.exact && two.p2.winner && two.p2.exact);
  // Todos iguais: todos ganham (nenhum aparece como o pior).
  const all = showsFor(27, [30, 30, 30]);
  for (const s of Object.values(all)) assert.ok(s.winner && s.level === 0 && !s.miss);
});

test('apresentação: palpites iguais (mesma precisão) têm exatamente o mesmo resultado', () => {
  // 80 e 20 falham ambos por 30 (60%).
  const shows = showsFor(50, [51, 80, 20, 150]);
  assert.deepEqual(shows.p1, shows.p2);
  const same = showsFor(27, [30, 30, 30, 25, 40]);
  assert.deepEqual(same.p0, same.p1);
  assert.deepEqual(same.p1, same.p2);
});

// --- Ritmo da revelação -------------------------------------------------------------------

const { revealPace, timeFor } = require('../public/reveal/pace');

test('ritmo: nunca passa de 12 s até à resposta certa e com 3-4 jogadores fica perto do antigo', () => {
  for (let n = 1; n <= 12; n++) assert.ok(revealPace(n).total <= 12000, `${n} jogadores: ${revealPace(n).total} ms`);
  // Antes: 1,5 s por passo (n palpites + resposta = n passos depois do primeiro).
  for (const n of [3, 4]) assert.ok(Math.abs(revealPace(n).total - 1500 * n) <= 900, `${n} jogadores: ${revealPace(n).total} ms`);
});

test('ritmo: os mais longe depressa, os 3 mais perto devagar e pausa antes do vencedor', () => {
  const { before } = revealPace(12);
  for (let i = 1; i <= 8; i++) assert.ok(before[i] >= 450 && before[i] <= 800, `palpite ${i + 1}: ${before[i]} ms`);
  for (const i of [9, 10]) assert.ok(before[i] >= 1400 && before[i] <= 2000, `palpite ${i + 1}: ${before[i]} ms`);
  assert.ok(before[11] > before[10], 'pausa dramática antes do último (o vencedor)');
  assert.equal(timeFor(12, 0), before[1]);
  assert.equal(timeFor(12, 11), revealPace(12).answer);
  // A escala (testes do servidor) mantém as proporções.
  assert.equal(revealPace(6, 0.01).before[5], Math.round(revealPace(6).before[5] * 0.01));
});

// --- Baralho de temas ---------------------------------------------------------------------

// Gerador aleatório com semente, para o teste ser repetível.
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

test('baralho: sai cada tema uma vez por baralho e nunca o mesmo duas vezes seguidas', () => {
  const themes = ['alvo', 'arco', 'bowling', 'karts', 'penalti'];
  for (const seed of [1, 2, 3, 42, 99]) {
    const deck = new ThemeDeck(themes, seeded(seed));
    const drawn = Array.from({ length: themes.length * 40 }, () => deck.next());
    for (let i = 1; i < drawn.length; i++) assert.notEqual(drawn[i], drawn[i - 1], `seguidos na posição ${i} (semente ${seed})`);
    for (let i = 0; i < drawn.length; i += themes.length) {
      assert.deepEqual([...drawn.slice(i, i + themes.length)].sort(), [...themes].sort(), 'cada baralho tem todos os temas');
    }
  }
});

test('baralho: 40 rondas sem temas seguidos repetidos e com baralhos em ordens novas', () => {
  // Como no jogo: o baralho de cada sala, com Math.random (sem semente).
  for (let run = 0; run < 25; run++) {
    const room = new Room(`T${run}`, () => {});
    const deck = room.themeDeck;
    room.destroy();
    const n = REVEAL_THEMES.length;
    const drawn = Array.from({ length: 40 }, () => deck.next());
    for (let i = 1; i < drawn.length; i++) assert.notEqual(drawn[i], drawn[i - 1], `tema repetido seguido na ronda ${i + 1}`);
    const decks = [];
    for (let i = 0; i < drawn.length; i += n) decks.push(drawn.slice(i, i + n).join(','));
    // 40 rondas podem acabar a meio de um baralho: os completos têm todos os temas; o último,
    // se estiver a meio, não tem nenhum repetido.
    const full = decks.filter((d) => d.split(',').length === n);
    for (const d of full) assert.deepEqual(d.split(',').sort(), [...REVEAL_THEMES].sort(), 'cada baralho tem todos os temas');
    const last = decks[decks.length - 1].split(',');
    assert.equal(new Set(last).size, last.length, 'sem temas repetidos no último baralho');
    for (let i = 1; i < full.length; i++) assert.notEqual(full[i], full[i - 1], `baralho ${i + 1} na mesma ordem do anterior`);
    assert.ok(new Set(full).size > 1, 'os baralhos não saem sempre na mesma ordem');
  }
});

test('baralho: cada sala tem o seu próprio baralho', () => {
  const a = new Room('AAAA', () => {});
  const b = new Room('BBBB', () => {});
  assert.notEqual(a.themeDeck, b.themeDeck);
  a.themeDeck.next();
  assert.equal(b.themeDeck.pile.length, 0, 'tirar um tema numa sala não mexe no baralho da outra');
  a.destroy();
  b.destroy();
});

test('baralho: com 2 temas alterna sempre; com 1 tema repete esse', () => {
  const two = new ThemeDeck(['a', 'b'], seeded(7));
  const drawn = Array.from({ length: 20 }, () => two.next());
  for (let i = 1; i < drawn.length; i++) assert.notEqual(drawn[i], drawn[i - 1]);
  const one = new ThemeDeck(['alvo']);
  assert.deepEqual([one.next(), one.next()], ['alvo', 'alvo']);
});

test('o tema é escolhido pelo servidor e é igual para todos os jogadores', () => {
  const room = new Room('TEST', () => {});
  const ids = ['Ana', 'Rui', 'Eva'].map((n, i) => {
    const p = room.addPlayer(n);
    room.connect(p.id, `s${i}`);
    return p.id;
  });
  room.themeDeck = new ThemeDeck(['a', 'b', 'c']);
  room.updateSettings(ids[0], { categories: ['historia'] }); // só perguntas de números
  room.startGame(ids[0]);
  const themes = ids.map((id) => room.stateFor(id).question.theme);
  assert.ok(['a', 'b', 'c'].includes(themes[0]));
  assert.deepEqual(themes, [themes[0], themes[0], themes[0]]);
  // Quem recarrega (novo pedido de estado) vê o mesmo tema.
  assert.equal(room.stateFor(ids[1]).question.theme, themes[0]);
  room.destroy();
});

test('perguntas de mapa não têm tema de revelação', () => {
  const room = new Room('TEST', () => {});
  const ids = ['Ana', 'Rui', 'Eva'].map((n, i) => {
    const p = room.addPlayer(n);
    room.connect(p.id, `s${i}`);
    return p.id;
  });
  room.updateSettings(ids[0], { categories: ['geografia'], rounds: 12 });
  room.startGame(ids[0]);
  let sawMap = false;
  for (let i = 0; i < 12; i++) {
    const q = room.stateFor(ids[0]).question;
    if (q.type === 'map') { sawMap = true; assert.equal(q.theme, null); } else assert.ok(REVEAL_THEMES.includes(q.theme));
    room.forceAdvance(ids[0]);
    room.revealSkip(ids[0]);
    if (room.phase === 'reveal' && room.round < room.questions.length) room.nextQuestion(ids[0]);
  }
  assert.ok(sawMap);
  room.destroy();
});

test('cada tema do servidor tem o seu ficheiro em public/reveal/ e está carregado no jogo', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  for (const id of REVEAL_THEMES) {
    const file = path.join(__dirname, '..', 'public', 'reveal', `${id}.js`);
    assert.ok(fs.existsSync(file), `falta public/reveal/${id}.js`);
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`register\\('${id}'`), `${id}.js não se regista`);
    assert.match(html, new RegExp(`reveal/${id}\\.js`), `index.html não carrega reveal/${id}.js`);
  }
  // A posição de apresentação carrega-se antes do código comum (index.js usa-a).
  assert.ok(html.indexOf('reveal/presentation.js') > 0 && html.indexOf('reveal/presentation.js') < html.indexOf('reveal/index.js'));
});
