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
      const w = h.max - h.min;
      if (/^Em que ano/.test(q.text)) assert.ok(w >= 20 && w <= 30, `anos: entre 20 e 30 (${h.min}–${h.max})`);
      else assert.ok(w >= Math.abs(q.answer) * 0.38 && w <= Math.abs(q.answer) * 0.6 + 4, `~40% da resposta: [${h.min}, ${h.max}]`);
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
  assert.ok(!JSON.stringify(room.stateFor(eva)).includes('"copied"'), 'a Eva não vê o palpite do Rui');
  assert.equal(room.stateFor(eva).myAnswer, null);
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
  // (Duas leituras do relógio: entre elas pode passar 1 ms ou outro.)
  assert.ok(mine - other > 14900 && mine - other <= 15100, `Ana: ${mine} ms; Rui: ${other} ms`);
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

// --- "Último lugar ataca" com em cheio e Aposta ------------------------------------------------

// Ronda "Último lugar ataca" com a Ana à frente (5), o Rui no meio (3) e a Eva em último (0).
function lastPlace(answers, aposta) {
  const { room, ids } = game();
  setScores(room, ids, [5, 3, 0]);
  room.current.special = { type: 'ultimo', introUntil: 0, textUntil: null };
  if (aposta) {
    give(room, ids[0], [aposta.card || 'aposta', 'tpc']);
    room.useCard(ids[0], aposta.card === 'rouba' ? { card: 'rouba' } : { card: 'aposta', amount: aposta.amount });
  }
  ids.forEach((id, i) => room.submitAnswer(id, answers[i]));
  toReveal(room, ids[0]);
  const r = room.stateFor(ids[1]).result;
  room.destroy();
  return { r, ids };
}

test('"Último lugar ataca": quem é de cima e acerta EM CHEIO fica com o bónus do em cheio (o ponto vai para o último)', () => {
  const { r, ids } = lastPlace([206, 300, 100]);
  assert.deepEqual(r.special.exactBonus, [ids[0]]);
  assert.deepEqual(r.special.awarded, [ids[2]]);
  assert.deepEqual(r.points, { [ids[0]]: 1, [ids[2]]: 1 }, 'Ana: +1 do em cheio; Eva (último lugar): o ponto do mais perto');
});

test('"Último lugar ataca" + Aposta: em cheio ganha o bónus e a aposta; mais perto sem ser em cheio, a aposta não conta', () => {
  {
    const { r, ids } = lastPlace([206, 300, 100], { amount: 3 });
    assert.equal(r.points[ids[0]], 4, 'bónus do em cheio (1) + 3 da aposta');
    const [o] = r.cards;
    assert.equal(o.result, 'exactLastPlace');
    assert.equal(o.points, 4);
    assert.equal(r.points[ids[2]], 1, 'o ponto do mais perto continua a ir para a Eva');
  }
  {
    const { r, ids } = lastPlace([205, 300, 100], { amount: 3 });
    assert.equal(r.points[ids[0]] || 0, 0, 'ficou o mais perto, mas nem ganha nem perde');
    assert.equal(r.cards[0].result, 'closestBlocked');
    assert.equal(r.points[ids[2]], 1);
  }
  // Rouba ao primeiro, de cima e mais perto: não rouba (e diz porquê).
  {
    const { room, ids } = game();
    setScores(room, ids, [5, 3, 0]);
    room.current.special = { type: 'ultimo', introUntil: 0, textUntil: null };
    give(room, ids[1], ['rouba', 'tpc']);
    room.useCard(ids[1], { card: 'rouba' });
    [300, 205, 100].forEach((v, i) => room.submitAnswer(ids[i], v));
    toReveal(room, ids[0]);
    const r = room.stateFor(ids[0]).result;
    assert.equal(r.cards[0].result, 'closestBlocked');
    assert.equal(r.points[ids[1]] || 0, 0);
    room.destroy();
  }
});

test('"Às escuras": a pergunta volta a aparecer na votação e na revelação', () => {
  const { room, ids } = game();
  room.current.special = { type: 'escuras', introUntil: Date.now() - 9000, textUntil: Date.now() - 4000 };
  assert.equal(room.stateFor(ids[0]).question.text, null, 'a responder: escondida');
  [100, 200, 300].forEach((v, i) => room.submitAnswer(ids[i], v));
  assert.equal(room.phase, 'voting');
  assert.equal(room.stateFor(ids[0]).question.text, Q.text, 'na votação: volta');
  assert.equal(room.stateFor(ids[0]).special.hideTextMs, null);
  toReveal(room, ids[0]);
  assert.equal(room.stateFor(ids[0]).question.text, Q.text, 'na revelação: volta');
  room.destroy();
});

test('a origem dos pontos de cada um soma a pontuação (para o ecrã final do duelo explicar o resultado)', () => {
  for (let run = 0; run < 20; run++) {
    const { room, ids } = game(['Ana', 'Rui'], { mode: 'duelo', rounds: 5 });
    const specials = [null, 'dobrar', 'todos', 'ultimo', 'escuras'];
    for (let round = 0; round < 5; round++) {
      room.current.question = Q;
      const sp = specials[(run + round) % specials.length];
      if (sp) room.current.special = { type: sp, introUntil: 0, textUntil: null };
      // Às vezes, cartas.
      if ((run + round) % 2) {
        give(room, ids[0], ['tpc', 'aposta']);
        room.useCard(ids[0], round % 4 ? { card: 'tpc' } : { card: 'aposta', amount: 2 });
      }
      room.submitAnswer(ids[0], [206, 200, 150, 300][(run + round) % 4]);
      room.submitAnswer(ids[1], [210, 206, 190, 100][(run * 3 + round) % 4]);
      toReveal(room, ids[0]);
      if (round < 4) room.nextQuestion(ids[0]);
    }
    const st = room.stateFor(ids[0]);
    for (const id of ids) {
      const p = st.duel.stats[id].points;
      const sum = p.closest + p.exact + p.votes + Object.values(p.specials).reduce((a, b) => a + b, 0) + p.cards;
      assert.equal(sum, room.players.get(id).score, `run ${run}: ${JSON.stringify(p)} → ${room.players.get(id).score}`);
    }
    room.destroy();
  }
});
// --- Fim do duelo: de onde vêm os pontos e ronda a ronda -----------------------------------------

test('fim do duelo: "mais perto" conta quem RECEBEU o ponto; cada ronda especial à parte; ronda a ronda', () => {
  // O duelo do laboratório: 1) "Pontos a dobrar", só a Beatriz responde; 2) "Último lugar ataca",
  // a Beatriz fica mais perto mas o ponto vai para o carlos (último); 3) ronda normal, a Beatriz.
  const { room, ids } = game(['Beatriz', 'carlos'], { mode: 'duelo', rounds: 3 });
  const [bea, carlos] = ids;
  const round = (special, answers) => {
    room.current.question = Q;
    if (special) room.current.special = { type: special, introUntil: 0, textUntil: null };
    answers.forEach((v, i) => { if (v !== null) room.submitAnswer(ids[i], v); });
    toReveal(room, bea);
  };
  round('dobrar', [200, null]);
  assert.deepEqual(room.stateFor(bea).result.points, { [bea]: 2 });
  room.nextQuestion(bea);
  round('ultimo', [200, 150]);
  assert.deepEqual(room.stateFor(bea).result.points, { [carlos]: 1 });
  room.nextQuestion(bea);
  round(null, [200, 150]);
  const { stats, history } = room.stateFor(carlos).duel;
  assert.deepEqual(stats[bea], { won: 2, exact: 0, points: { closest: 2, exact: 0, votes: 0, specials: { dobrar: 1 }, cards: 0 } });
  assert.deepEqual(stats[carlos], { won: 1, exact: 0, points: { closest: 1, exact: 0, votes: 0, specials: {}, cards: 0 } });
  assert.deepEqual([room.players.get(bea).score, room.players.get(carlos).score], [3, 1]);
  // Ronda a ronda (com o nome, o motivo e a ronda especial).
  assert.deepEqual(history.map((h) => [h.round, h.special, h.gains.map((g) => [g.name, g.points, g.reasons])]), [
    [1, 'dobrar', [['Beatriz', 2, ['closest', 'double']]]],
    [2, 'ultimo', [['carlos', 1, ['lastPlace', 'closest']]]],
    [3, null, [['Beatriz', 1, ['closest']]]],
  ]);
  room.destroy();
});

test('origem dos pontos: as rondas especiais não se anulam; ronda a ronda com cartas e em cheio de cima', () => {
  const { room, ids } = game(['Ana', 'Rui'], { mode: 'duelo', rounds: 3 });
  const [ana, rui] = ids;
  // "Pontos a dobrar" (+1) e "Toda a turma ganha" (+1) ficam em linhas próprias.
  room.current.special = { type: 'dobrar', introUntil: 0, textUntil: null };
  room.submitAnswer(ana, 200);
  room.submitAnswer(rui, 100);
  room.nextQuestion(ana);
  room.current.question = Q;
  room.current.special = { type: 'todos', introUntil: 0, textUntil: null };
  room.submitAnswer(ana, 200);
  room.submitAnswer(rui, 210);
  assert.deepEqual(room.stateFor(ana).duel.stats[ana].points.specials, { dobrar: 1, todos: 1 });
  room.nextQuestion(ana);
  // "Último lugar ataca": a Ana (à frente) acerta em cheio com a Aposta (bónus do em cheio +
  // aposta); o Rui é o último e fica com o ponto do mais perto.
  room.current.question = Q;
  room.current.special = { type: 'ultimo', introUntil: 0, textUntil: null };
  give(room, ana, ['aposta', 'tpc']);
  room.useCard(ana, { card: 'aposta', amount: 2 });
  room.submitAnswer(ana, 206);
  room.submitAnswer(rui, 300);
  const st = room.stateFor(rui);
  const last = st.duel.history[2];
  assert.equal(last.special, 'ultimo');
  assert.deepEqual(last.gains.map((g) => [g.name, g.points, g.reasons]), [['Ana', 3, ['exactBonus', 'bet']], ['Rui', 1, ['lastPlace', 'closest']]]);
  // A soma continua a dar a pontuação.
  for (const id of ids) {
    const p = st.duel.stats[id].points;
    assert.equal(p.closest + p.exact + p.votes + Object.values(p.specials).reduce((a, b) => a + b, 0) + p.cards, room.players.get(id).score);
  }
  room.destroy();
  // Roubo: o ladrão ("roubo ao líder") e o roubado ("roubado", com pontos negativos).
  const t = game();
  setScores(t.room, t.ids, [5, 3, 0]);
  give(t.room, t.ids[1], ['rouba', 'tpc']);
  t.room.useCard(t.ids[1], { card: 'rouba' });
  [100, 200, 50].forEach((v, i) => t.room.submitAnswer(t.ids[i], v));
  toReveal(t.room, t.ids[0]);
  assert.deepEqual(t.room.history[0].gains.map((g) => [g.name, g.points, g.reasons]), [['Rui', 1, ['closest', 'steal']], ['Ana', -1, ['stolen']]]);
  // Em "Turma" o histórico também se guarda (mas só o Duelo o mostra); um jogo novo começa do zero.
  assert.equal(t.room.stateFor(t.ids[0]).duel, null);
  t.room.phase = 'end';
  t.room.backToLobby(t.ids[0]);
  for (const p of t.room.players.values()) p.ready = true;
  t.room.startGame(t.ids[0]);
  assert.deepEqual(t.room.history, []);
  t.room.destroy();
});