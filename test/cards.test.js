'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Cards = require('../server/cards');
const { continentOf } = require('../server/continents');
const { Room } = require('../server/rooms');

const Q = { text: 'Quantos ossos tem o corpo humano adulto?', answer: 206 };
const MAP_Q = { type: 'map', text: 'Onde fica o Paquistão?', country: '586', label: 'Paquistão' };

// Sala com o jogo começado (sem rondas especiais, para os pontos serem previsíveis).
function game(names = ['Ana', 'Rui', 'Eva'], settings = {}) {
  const room = new Room('TEST', () => {});
  const ids = names.map((n, i) => {
    const p = room.addPlayer(n);
    room.connect(p.id, `s${i}`);
    return p.id;
  });
  Object.assign(room.settings, { specialRounds: false }, settings);
  for (const p of room.players.values()) p.ready = true;
  room.startGame(ids[0]);
  room.current.question = Q;
  return { room, ids };
}
// Dá estas cartas a um jogador (em vez das do baralho).
const give = (room, id, types) => room.hands.set(id, types.map((type) => ({ type, used: false })));
const toReveal = (room, host) => { while (room.phase === 'answering' || room.phase === 'voting') room.forceAdvance(host); };
const setScores = (room, ids, scores) => ids.forEach((id, i) => { room.players.get(id).score = scores[i]; });
const pointsOf = (room, viewer) => room.stateFor(viewer).result.points;

// --- Baralho ------------------------------------------------------------------------------------

test('cartas: 2 cartas diferentes para cada jogador no início do jogo; o baralho do Duelo e o "Mais tempo"', () => {
  assert.deepEqual(Cards.CARDS, ['aposta', 'rouba', 'cabula', 'copiar', 'tpc', 'atestado', 'tempo', 'grupo']);
  assert.ok(!Cards.deckFor({ duel: true, answerTime: 30 }).includes('copiar'));
  assert.ok(!Cards.deckFor({ duel: true, answerTime: 30 }).includes('grupo'));
  assert.ok(Cards.deckFor({ answerTime: 30 }).includes('tempo'));
  assert.ok(!Cards.deckFor({ answerTime: 0 }).includes('tempo'), 'sem tempo limite, "Mais tempo" não sai');
  for (let run = 0; run < 30; run++) {
    const { room, ids } = game(['Ana', 'Rui', 'Eva', 'Tó'], { answerTime: 30 });
    for (const id of ids) {
      const hand = room.stateFor(id).myHand;
      assert.equal(hand.length, 2);
      assert.notEqual(hand[0].type, hand[1].type, 'diferentes');
      assert.ok(hand.every((c) => Cards.CARDS.includes(c.type) && !c.used));
    }
    room.destroy();
  }
  // Opção desligada: ninguém tem cartas. E não passam para o jogo seguinte.
  const off = game(undefined, { cards: false });
  assert.equal(off.room.stateFor(off.ids[0]).myHand, null);
  off.room.destroy();
  const { room, ids } = game();
  give(room, ids[0], ['aposta', 'tpc']);
  room.hands.get(ids[0])[0].used = true;
  room.phase = 'end';
  room.backToLobby(ids[0]);
  assert.equal(room.stateFor(ids[0]).myHand, null, 'na sala de espera não há cartas');
  for (const p of room.players.values()) p.ready = true;
  room.startGame(ids[0]);
  assert.ok(room.stateFor(ids[0]).myHand.every((c) => !c.used), 'jogo novo, cartas novas');
  room.destroy();
});

test('cartas no Duelo: sem "Copiar" nem "Trabalho de grupo"; "Rouba" a quem vai à frente', () => {
  for (let run = 0; run < 30; run++) {
    const { room, ids } = game(['Ana', 'Rui'], { mode: 'duelo', answerTime: 30 });
    for (const id of ids) assert.ok(room.stateFor(id).myHand.every((c) => !['copiar', 'grupo'].includes(c.type)));
    room.destroy();
  }
  const { room, ids } = game(['Ana', 'Rui'], { mode: 'duelo' });
  const [ana, rui] = ids;
  setScores(room, ids, [1, 4]);
  give(room, ana, ['rouba', 'tpc']);
  room.useCard(ana, { card: 'rouba' });
  room.submitAnswer(ana, 200);
  room.submitAnswer(rui, 100);
  assert.deepEqual(pointsOf(room, ana), { [ana]: 1, [rui]: -1 });
  assert.deepEqual([room.players.get(ana).score, room.players.get(rui).score], [2, 3]);
  room.destroy();
});

// --- Cada carta ---------------------------------------------------------------------------------

test('💰 Aposta: mais perto ganha a aposta (em cheio +1), mais longe perde-a, no meio nada', () => {
  const run = (amount, answers, scores = [5, 5, 5]) => {
    const { room, ids } = game();
    setScores(room, ids, scores);
    give(room, ids[0], ['aposta', 'tpc']);
    room.useCard(ids[0], { card: 'aposta', amount });
    ids.forEach((id, i) => room.submitAnswer(id, answers[i]));
    toReveal(room, ids[0]);
    const r = room.stateFor(ids[1]).result;
    room.destroy();
    return { gain: r.points[ids[0]] || 0, outcome: r.cards[0] };
  };
  assert.equal(run(3, [200, 100, 50]).gain, 3, 'mais perto: +3 em vez de +1');
  assert.equal(run(2, [206, 100, 50]).gain, 3, 'em cheio: aposta + 1');
  assert.equal(run(2, [10, 100, 200]).gain, -2, 'mais longe: perde 2');
  assert.equal(run(2, [100, 200, 10]).gain, 0, 'no meio: nada muda');
  assert.equal(run(3, [10, 100, 200], [1, 5, 5]).gain, -1, 'nunca abaixo de 0 (tinha 1)');
  const { id, ...outcome } = run(3, [200, 100, 50]).outcome;
  assert.ok(id);
  assert.deepEqual(outcome, { type: 'aposta', result: 'won', amount: 3, points: 3 });
  const invalid = game();
  give(invalid.room, invalid.ids[0], ['aposta', 'tpc']);
  for (const amount of [0, 4, '2', undefined, 1.5]) {
    assert.throws(() => invalid.room.useCard(invalid.ids[0], { card: 'aposta', amount }), /Aposta 1, 2 ou 3/);
  }
  invalid.room.destroy();
});

test('🦊 Rouba ao primeiro: rouba 1 ao líder; se for o líder, ponto normal; vários ladrões, o líder perde só 1', () => {
  // Rui (2.º) fica mais perto e rouba à Ana (líder).
  {
    const { room, ids } = game();
    const [ana, rui, eva] = ids;
    setScores(room, ids, [5, 3, 0]);
    give(room, rui, ['rouba', 'tpc']);
    room.useCard(rui, { card: 'rouba' });
    room.submitAnswer(ana, 100);
    room.submitAnswer(rui, 200);
    room.submitAnswer(eva, 50);
    toReveal(room, ana);
    const r = room.stateFor(eva).result;
    assert.deepEqual(r.points, { [rui]: 1, [ana]: -1 });
    assert.deepEqual(r.cards, [{ id: rui, type: 'rouba', result: 'stole', victim: ana, points: 1, stolen: 1 }]);
    assert.deepEqual([room.players.get(ana).score, room.players.get(rui).score], [4, 4]);
    room.destroy();
  }
  // O próprio líder (ou um dos líderes empatados) fica só com o ponto normal.
  {
    const { room, ids } = game();
    setScores(room, ids, [5, 5, 0]);
    give(room, ids[1], ['rouba', 'tpc']);
    room.useCard(ids[1], { card: 'rouba' });
    room.submitAnswer(ids[0], 100);
    room.submitAnswer(ids[1], 200);
    room.submitAnswer(ids[2], 50);
    toReveal(room, ids[0]);
    const r = room.stateFor(ids[0]).result;
    assert.deepEqual(r.points, { [ids[1]]: 1 });
    assert.equal(r.cards[0].result, 'leader');
    room.destroy();
  }
  // Não ficou mais perto: nada.
  {
    const { room, ids } = game();
    setScores(room, ids, [5, 3, 0]);
    give(room, ids[1], ['rouba', 'tpc']);
    room.useCard(ids[1], { card: 'rouba' });
    ['200', '100', '50'].forEach((v, i) => room.submitAnswer(ids[i], Number(v)));
    toReveal(room, ids[0]);
    assert.equal(room.stateFor(ids[0]).result.cards[0].result, 'notClosest');
    assert.deepEqual(pointsOf(room, ids[0]), { [ids[0]]: 1 });
    room.destroy();
  }
  // Dois ladrões empatados no mais perto: os dois ganham 1, o líder perde só 1.
  const out = Cards.applyCards({
    points: { b: 1, c: 1 }, closest: ['b', 'c'], farthest: ['a'], distances: { a: 50, b: 1, c: 1 },
    scores: { a: 6, b: 2, c: 1 }, uses: { b: { type: 'rouba' }, c: { type: 'rouba' } },
  });
  assert.deepEqual(out.points, { a: -1, b: 1, c: 1 });
  // Líderes empatados: perde o que ficou mais longe nesta ronda.
  const two = Cards.applyCards({
    points: { c: 1 }, closest: ['c'], farthest: ['b'], distances: { a: 10, b: 90, c: 1 },
    scores: { a: 4, b: 4, c: 1 }, uses: { c: { type: 'rouba' } },
  });
  assert.deepEqual(two.points, { b: -1, c: 1 });
});

test('📝 Cábula: intervalo largo com a resposta (só para quem usa); no mapa, o continente', () => {
  for (let i = 0; i < 300; i++) {
    for (const q of [Q, { text: 'Em que ano foi criada a Fanta?', answer: 1940 }, { text: 'Qual a área do Vaticano?', answer: 0.44 }, { text: 'Quantas patas tem uma aranha?', answer: 8 }, { text: 'x?', answer: 10343066 }]) {
      const h = Cards.cabulaHint(q, continentOf);
      assert.equal(h.kind, 'range');
      assert.ok(h.min <= q.answer && q.answer <= h.max, `${q.answer} em [${h.min}, ${h.max}]`);
      assert.ok(h.min >= 0, 'sem negativos numa resposta positiva');
      assert.ok(h.max - h.min >= (/^Em que ano/.test(q.text) ? 80 : Math.abs(q.answer) * 0.5), `largo: [${h.min}, ${h.max}]`);
    }
  }
  assert.deepEqual(Cards.cabulaHint(MAP_Q, continentOf), { kind: 'continent', text: 'Ásia' });
  assert.equal(continentOf('643'), 'Europa e Ásia');
  // Só no estado de quem a usou.
  const { room, ids } = game();
  give(room, ids[0], ['cabula', 'tpc']);
  room.useCard(ids[0], { card: 'cabula' });
  const mine = room.stateFor(ids[0]).myCard;
  assert.equal(mine.type, 'cabula');
  assert.ok(mine.hint.min <= 206 && mine.hint.max >= 206);
  for (const other of ids.slice(1)) {
    const st = room.stateFor(other);
    assert.equal(st.myCard, null);
    assert.ok(!JSON.stringify(st).includes('"hint"'), 'a pista nunca vai para os outros');
  }
  room.destroy();
});

test('👀 Copiar pelo colega: só de quem já entregou; o palpite só vai para quem copiou', () => {
  const { room, ids } = game();
  const [ana, rui, eva] = ids;
  give(room, ana, ['copiar', 'tpc']);
  assert.throws(() => room.useCard(ana, { card: 'copiar', target: rui }), /já entregou/, 'o Rui ainda não entregou');
  assert.throws(() => room.useCard(ana, { card: 'copiar', target: ana }), /já entregou/);
  room.submitAnswer(rui, 321);
  room.useCard(ana, { card: 'copiar', target: rui });
  assert.deepEqual(room.stateFor(ana).myCard, { type: 'copiar', target: rui, copied: 321 });
  assert.equal(room.stateFor(eva).myCard, null);
  assert.ok(!JSON.stringify(room.stateFor(eva)).includes('321'), 'a Eva não vê o palpite do Rui');
  // Copiar é opcional: a Ana responde o que quiser.
  room.submitAnswer(ana, 210);
  assert.equal(room.current.answers.get(ana), 210);
  room.destroy();
});

test('📚 Trabalho de casa feito: os pontos ganhos contam a dobrar (e com "Pontos a dobrar", ×4)', () => {
  const { room, ids } = game();
  give(room, ids[0], ['tpc', 'aposta']);
  room.useCard(ids[0], { card: 'tpc' });
  ['206', '100', '50'].forEach((v, i) => room.submitAnswer(ids[i], Number(v)));
  room.submitVote(ids[0], ids[2]); // voto certo: +1
  room.submitVote(ids[1], ids[2]);
  room.submitVote(ids[2], ids[1]);
  assert.equal(pointsOf(room, ids[0])[ids[0]], 6, '(2 em cheio + 1 voto) × 2');
  room.destroy();
  // Com a ronda especial "Pontos a dobrar".
  const d = game();
  d.room.current.special = { type: 'dobrar', introUntil: 0, textUntil: null };
  give(d.room, d.ids[0], ['tpc', 'aposta']);
  d.room.useCard(d.ids[0], { card: 'tpc' });
  ['200', '100', '50'].forEach((v, i) => d.room.submitAnswer(d.ids[i], Number(v)));
  toReveal(d.room, d.ids[0]);
  assert.equal(pointsOf(d.room, d.ids[0])[d.ids[0]], 4, '1 × 2 (ronda) × 2 (carta)');
  d.room.destroy();
});

test('🩹 Atestado médico: não perde pontos nem é roubado', () => {
  // Rouba contra Atestado médico: o roubo falha e o ladrão fica com o ponto normal.
  const { room, ids } = game();
  const [ana, rui, eva] = ids;
  setScores(room, ids, [5, 2, 0]);
  give(room, ana, ['atestado', 'tpc']);
  give(room, rui, ['rouba', 'tpc']);
  room.useCard(ana, { card: 'atestado' });
  room.useCard(rui, { card: 'rouba' });
  room.submitAnswer(ana, 100);
  room.submitAnswer(rui, 200);
  room.submitAnswer(eva, 50);
  toReveal(room, ana);
  const r = room.stateFor(eva).result;
  assert.deepEqual(r.points, { [rui]: 1 }, 'a Ana não perde nada; o Rui fica com o ponto normal');
  const byType = Object.fromEntries(r.cards.map((c) => [c.type, c]));
  assert.equal(byType.rouba.result, 'protected');
  assert.equal(byType.atestado.result, 'blockedTheft');
  room.destroy();
  // Dois líderes, um com atestado: roubado é o outro.
  const two = Cards.applyCards({
    points: { c: 1 }, closest: ['c'], farthest: ['a'], distances: { a: 90, b: 10, c: 1 },
    scores: { a: 4, b: 4, c: 1 }, uses: { c: { type: 'rouba' }, a: { type: 'atestado' } },
  });
  assert.deepEqual(two.points, { b: -1, c: 1 });
});

test('⏰ Mais tempo: +15 s só para quem a usa (e só com tempo limite)', () => {
  const noLimit = game();
  give(noLimit.room, noLimit.ids[0], ['tempo', 'tpc']);
  assert.throws(() => noLimit.room.useCard(noLimit.ids[0], { card: 'tempo' }), /tempo limite/);
  noLimit.room.destroy();
  const { room, ids } = game(['Ana', 'Rui', 'Eva'], { answerTime: 20 });
  // (O jogo começou com 20 s: a ronda 1 já tem o temporizador.)
  room.current.question = Q;
  give(room, ids[0], ['tempo', 'tpc']);
  room.useCard(ids[0], { card: 'tempo' });
  const mine = room.stateFor(ids[0]).remainingMs;
  const other = room.stateFor(ids[1]).remainingMs;
  assert.ok(mine - other > 14000 && mine - other <= 15000, `Ana: ${mine} ms; Rui: ${other} ms`);
  // Passado o tempo normal: o Rui já não responde; a Ana ainda pode.
  room.current.baseDeadline = Date.now() - 1;
  room.current.extra.set(ids[0], Date.now() + 10000);
  assert.throws(() => room.submitAnswer(ids[1], 100), /tempo acabou/);
  room.submitAnswer(ids[0], 200);
  // Os que ficaram sem tempo não seguram a ronda: com a Ana entregue, avança.
  assert.notEqual(room.phase, 'answering');
  room.destroy();
});

test('🤝 Trabalho de grupo: se o colega ficar mais perto, também ganha 1 ponto', () => {
  const run = (answers, special) => {
    const { room, ids } = game();
    if (special) room.current.special = { type: special, introUntil: 0, textUntil: null };
    give(room, ids[0], ['grupo', 'tpc']);
    assert.throws(() => room.useCard(ids[0], { card: 'grupo', target: ids[0] }), /colega/);
    room.useCard(ids[0], { card: 'grupo', target: ids[1] });
    ids.forEach((id, i) => room.submitAnswer(id, answers[i]));
    toReveal(room, ids[0]);
    const p = pointsOf(room, ids[2]);
    room.destroy();
    return [p[ids[0]] || 0, p[ids[1]] || 0];
  };
  assert.deepEqual(run([100, 200, 50]), [1, 1], 'o Rui ficou mais perto: a Ana também ganha 1');
  assert.deepEqual(run([200, 100, 50]), [1, 0], 'a Ana ficou mais perto: só o ponto dela');
  assert.deepEqual(run([100, 50, 200]), [0, 0], 'o Rui não ficou mais perto');
  assert.deepEqual(run([100, 200, 50], 'dobrar'), [2, 2], 'com "Pontos a dobrar"');
});

// --- Combinações com as rondas especiais --------------------------------------------------------

test('combinações: Aposta em "Pontos a dobrar" (ganho ×2, perda não) e em "Último lugar ataca"', () => {
  const run = (answers, amount, special, scores = [5, 5, 5]) => {
    const { room, ids } = game();
    setScores(room, ids, scores);
    room.current.special = { type: special, introUntil: 0, textUntil: null };
    give(room, ids[0], ['aposta', 'tpc']);
    room.useCard(ids[0], { card: 'aposta', amount });
    ids.forEach((id, i) => room.submitAnswer(id, answers[i]));
    toReveal(room, ids[0]);
    const p = pointsOf(room, ids[1]);
    room.destroy();
    return p[ids[0]] || 0;
  };
  assert.equal(run([200, 100, 50], 3, 'dobrar'), 6, 'ganha 3 × 2');
  assert.equal(run([10, 100, 200], 3, 'dobrar'), -3, 'perde 3 (as perdas não dobram)');
  // "Último lugar ataca": a Ana vai à frente e fica mais perto, mas o ponto não é dela; a aposta
  // também não (não ficou com o ponto do mais perto) e não perde (não foi a mais longe).
  assert.equal(run([200, 100, 50], 3, 'ultimo', [6, 3, 0]), 0);
  // A Eva (último lugar) com aposta e o ponto do último lugar: ganha a aposta.
  const { room, ids } = game();
  setScores(room, ids, [6, 3, 0]);
  room.current.special = { type: 'ultimo', introUntil: 0, textUntil: null };
  give(room, ids[2], ['aposta', 'tpc']);
  room.useCard(ids[2], { card: 'aposta', amount: 2 });
  [200, 10, 100].forEach((v, i) => room.submitAnswer(ids[i], v));
  toReveal(room, ids[0]);
  assert.equal(pointsOf(room, ids[0])[ids[2]], 2);
  room.destroy();
});

test('combinações: Rouba em "Pontos a dobrar" rouba 2; "Toda a turma ganha" com Trabalho de casa', () => {
  const { room, ids } = game();
  setScores(room, ids, [5, 3, 0]);
  room.current.special = { type: 'dobrar', introUntil: 0, textUntil: null };
  give(room, ids[1], ['rouba', 'tpc']);
  room.useCard(ids[1], { card: 'rouba' });
  [100, 200, 50].forEach((v, i) => room.submitAnswer(ids[i], v));
  toReveal(room, ids[0]);
  assert.deepEqual(pointsOf(room, ids[0]), { [ids[1]]: 2, [ids[0]]: -2 });
  room.destroy();
  const t = game();
  t.room.current.special = { type: 'todos', introUntil: 0, textUntil: null };
  give(t.room, t.ids[1], ['tpc', 'aposta']);
  t.room.useCard(t.ids[1], { card: 'tpc' });
  [200, 210, 190].forEach((v, i) => t.room.submitAnswer(t.ids[i], v));
  toReveal(t.room, t.ids[0]);
  // O Rui (210, a 4) fica mais perto: (1 + 1 da turma) × 2 = 4; os outros: +1 da turma.
  assert.deepEqual(pointsOf(t.room, t.ids[0]), { [t.ids[0]]: 1, [t.ids[1]]: 4, [t.ids[2]]: 1 });
  t.room.destroy();
});

// --- Validações ---------------------------------------------------------------------------------

test('validações: uma carta por ronda, antes de entregar, só na resposta, nunca no desempate', () => {
  const { room, ids } = game(['Ana', 'Rui', 'Eva'], { answerTime: 30 });
  const [ana, rui, eva] = ids;
  room.current.question = Q;
  give(room, ana, ['tpc', 'atestado']);
  give(room, rui, ['cabula', 'tpc']);
  assert.throws(() => room.useCard(ana, { card: 'rouba' }), /Não tens essa carta/);
  room.useCard(ana, { card: 'tpc' });
  assert.throws(() => room.useCard(ana, { card: 'atestado' }), /Já usaste uma carta nesta ronda/);
  room.submitAnswer(rui, 100);
  assert.throws(() => room.useCard(rui, { card: 'cabula' }), /Já entregaste/);
  room.submitAnswer(ana, 200);
  room.submitAnswer(eva, 50);
  assert.equal(room.phase, 'voting');
  assert.throws(() => room.useCard(eva, { card: 'tpc' }), /enquanto respondes/);
  // A carta fica gasta para o resto do jogo.
  toReveal(room, ana);
  room.nextQuestion(ana);
  room.current.question = Q;
  assert.throws(() => room.useCard(ana, { card: 'tpc' }), /Já usaste essa carta/);
  room.useCard(ana, { card: 'atestado' });
  assert.deepEqual(room.stateFor(ana).myHand.map((c) => c.used), [true, true]);
  // Desligadas: não se usam.
  room.settings.cards = false;
  assert.throws(() => room.useCard(rui, { card: 'cabula' }), /desligadas/);
  room.settings.cards = true;
  // Desempate: não.
  room.phase = 'tiebreak';
  assert.throws(() => room.useCard(rui, { card: 'cabula' }), /desempate/);
  room.destroy();
  // O autor da pergunta não usa cartas nela.
  const c = game();
  c.room.current.question = { ...Q, author: c.ids[1] };
  give(c.room, c.ids[1], ['tpc', 'cabula']);
  assert.throws(() => c.room.useCard(c.ids[1], { card: 'cabula' }), /pergunta é tua/);
  c.room.destroy();
});

test('na revelação, todos veem quem usou o quê (sem a pista); a pontuação nunca desce abaixo de 0', () => {
  const { room, ids } = game();
  setScores(room, ids, [1, 0, 0]);
  give(room, ids[1], ['cabula', 'tpc']);
  give(room, ids[2], ['rouba', 'tpc']);
  room.useCard(ids[1], { card: 'cabula' });
  room.useCard(ids[2], { card: 'rouba' });
  [100, 50, 200].forEach((v, i) => room.submitAnswer(ids[i], v));
  toReveal(room, ids[0]);
  const st = room.stateFor(ids[0]);
  assert.deepEqual(st.result.cards.map((c) => [c.id, c.type, c.result]).sort(), [[ids[1], 'cabula', 'used'], [ids[2], 'rouba', 'stole']].sort());
  assert.ok(!JSON.stringify(st).includes('"hint"'));
  assert.equal(room.players.get(ids[0]).score, 0, 'tinha 1, roubaram-lhe 1');
  // Nas rondas sem cartas, nada muda.
  room.nextQuestion(ids[0]);
  room.current.question = Q;
  [200, 100, 50].forEach((v, i) => room.submitAnswer(ids[i], v));
  toReveal(room, ids[0]);
  assert.deepEqual(room.stateFor(ids[0]).result.cards, []);
  room.destroy();
});
