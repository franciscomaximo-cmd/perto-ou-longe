'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Room, GameError, clampTime, clampRounds, DEFAULT_ROUNDS } = require('../server/rooms');

function setup(names = ['Ana', 'Rui', 'Eva']) {
  const room = new Room('TEST', () => {});
  const ids = names.map((n, i) => {
    const p = room.addPlayer(n);
    room.connect(p.id, `socket-${i}`);
    return p.id;
  });
  return { room, ids };
}

// Começa o jogo com uma pergunta conhecida na primeira ronda (o sorteio pode calhar numa de mapa).
const NUMBER_QUESTION = { text: 'Quantos ossos tem o corpo humano adulto?', answer: 206 };
const MAP_QUESTION = { type: 'map', text: 'Onde fica o Paquistão?', country: '586', label: 'Paquistão' };
function startWith(room, host, question) {
  room.startGame(host);
  room.current.question = question;
}
const startWithNumber = (room, host) => startWith(room, host, NUMBER_QUESTION);

test('o primeiro jogador é o anfitrião e os nomes são únicos', () => {
  const { room, ids } = setup();
  assert.equal(room.hostId, ids[0]);
  assert.throws(() => room.addPlayer('ana'), GameError);
});

test('não começa com menos de 3 jogadores ligados', () => {
  const { room, ids } = setup(['Ana', 'Rui']);
  assert.throws(() => room.startGame(ids[0]), /pelo menos 3/);
});

test('só o anfitrião começa e configura', () => {
  const { room, ids } = setup();
  assert.throws(() => room.startGame(ids[1]), /anfitrião/);
  assert.throws(() => room.updateSettings(ids[1], { answerTime: 30 }), /anfitrião/);
  room.updateSettings(ids[0], { answerTime: 30, voteTime: 5 });
  assert.deepEqual(room.settings, { rounds: DEFAULT_ROUNDS, answerTime: 30, voteTime: 10 });
});

test('clampRounds: entre 3 e 30, 10 por defeito', () => {
  assert.equal(clampRounds('abc'), 10);
  assert.equal(clampRounds(1), 3);
  assert.equal(clampRounds(15), 15);
  assert.equal(clampRounds(500), 30);
});

test('clampTime: 0 desliga, limites entre 10 e 180', () => {
  assert.equal(clampTime(0), 0);
  assert.equal(clampTime('abc'), 0);
  assert.equal(clampTime(3), 10);
  assert.equal(clampTime(999), 180);
});

test('respostas ficam escondidas até à revelação', () => {
  const { room, ids } = setup();
  startWithNumber(room, ids[0]);
  room.submitAnswer(ids[0], 42);
  const seenByRui = room.stateFor(ids[1]);
  assert.equal(seenByRui.myAnswer, null);
  assert.deepEqual(seenByRui.answered, [ids[0]]);
  assert.equal(seenByRui.result, undefined);
  assert.equal(room.stateFor(ids[0]).myAnswer, 42);
});

test('uma ronda completa: responder, votar, revelar e pontuar', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  startWithNumber(room, ana);
  const correct = room.current.question.answer;

  room.submitAnswer(ana, correct);
  room.submitAnswer(rui, correct + 10);
  assert.equal(room.phase, 'answering');
  room.submitAnswer(eva, correct + 1000);
  assert.equal(room.phase, 'voting');

  assert.throws(() => room.submitVote(ana, ana), /ti próprio/);
  room.submitVote(ana, eva);
  room.submitVote(rui, eva);
  room.submitVote(eva, rui);
  assert.equal(room.phase, 'reveal');

  const scores = Object.fromEntries([...room.players.values()].map((p) => [p.id, p.score]));
  // Ana acertou no número exato (2) e no mais longe (1).
  assert.deepEqual(scores, { [ana]: 3, [rui]: 1, [eva]: 0 });
  assert.equal(room.stateFor(rui).result.answers[eva], correct + 1000);
});

test('um jogador desligado não bloqueia a ronda', () => {
  const { room, ids } = setup();
  startWithNumber(room, ids[0]);
  room.submitAnswer(ids[0], 1);
  room.submitAnswer(ids[1], 2);
  room.disconnect(ids[2], 'socket-2');
  assert.equal(room.phase, 'voting');
});

// Joga todas as rondas sem respostas e para na revelação da última.
function playToLastReveal(room, host) {
  room.startGame(host);
  while (room.round < room.questions.length) {
    room.forceAdvance(host);
    room.nextQuestion(host);
  }
  room.forceAdvance(host);
  assert.equal(room.phase, 'reveal');
}

// Responde aos desempates com palpites todos diferentes (o primeiro da lista fica à frente).
function finishTiebreaks(room, host) {
  while (room.phase === 'tiebreak') {
    const correct = room.tiebreak.question.answer;
    room.tiebreak.ids.forEach((id, i) => room.submitAnswer(id, correct + i));
    assert.equal(room.phase, 'tiebreak-reveal');
    room.nextQuestion(host);
  }
}

const scoresOf = (room) => Object.fromEntries([...room.players.values()].map((p) => [p.id, p.score]));

for (const rounds of [DEFAULT_ROUNDS, 5, 30]) {
  test(`o jogo termina ao fim de ${rounds} perguntas, sem repetir`, () => {
    const { room, ids } = setup();
    room.updateSettings(ids[0], { rounds });
    room.startGame(ids[0]);
    assert.equal(room.stateFor(ids[1]).totalRounds, rounds);
    for (let i = 1; i <= rounds; i++) {
      assert.equal(room.round, i);
      room.forceAdvance(ids[0]);
      room.nextQuestion(ids[0]);
    }
    // Ninguém respondeu: estão todos empatados e vão a desempate.
    finishTiebreaks(room, ids[0]);
    assert.equal(room.phase, 'end');
    const asked = new Set(room.questions.map((q) => q.text));
    assert.equal(asked.size, rounds);
  });
}

test('sem empates o jogo termina sem desempate', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  room.updateSettings(ana, { rounds: 3 });
  playToLastReveal(room, ana);
  room.players.get(ana).score = 3;
  room.players.get(rui).score = 2;
  room.players.get(eva).score = 1;
  room.nextQuestion(ana);
  assert.equal(room.phase, 'end');
  assert.deepEqual(room.stateFor(ana).standings, [[ana], [rui], [eva]]);
});

test('só os empatados vão a desempate e quem fica mais perto fica à frente', () => {
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
  const [ana, rui, eva, to] = ids;
  room.updateSettings(ana, { rounds: 3 });
  playToLastReveal(room, ana);
  room.players.get(ana).score = 5;
  room.players.get(rui).score = 2;
  room.players.get(eva).score = 2;
  room.players.get(to).score = 0;
  const before = scoresOf(room);
  room.nextQuestion(ana);

  assert.equal(room.phase, 'tiebreak');
  assert.deepEqual(room.tiebreak.ids, [rui, eva]);
  assert.ok(!room.questions.includes(room.tiebreak.question), 'a pergunta de desempate é nova');
  assert.throws(() => room.submitAnswer(ana, 1), /empatados/);
  assert.throws(() => room.submitAnswer(to, 1), /empatados/);

  const correct = room.tiebreak.question.answer;
  room.submitAnswer(eva, correct + 1);
  room.submitAnswer(rui, correct + 5);
  assert.equal(room.phase, 'tiebreak-reveal');
  assert.deepEqual(room.stateFor(to).standings, [[ana], [eva], [rui], [to]]);
  assert.equal(room.stateFor(to).tiebreakPending, false);
  assert.deepEqual(scoresOf(room), before, 'o desempate não mexe nos pontos');

  room.nextQuestion(ana);
  assert.equal(room.phase, 'end');
});

test('se voltarem a empatar sai outra pergunta, só para os que continuam empatados', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  room.updateSettings(ana, { rounds: 3 });
  playToLastReveal(room, ana); // todos com 0 pontos

  room.nextQuestion(ana);
  assert.deepEqual(room.tiebreak.ids, [ana, rui, eva]);
  const first = room.tiebreak.question;
  let correct = first.answer;
  room.submitAnswer(ana, correct);
  room.submitAnswer(rui, correct + 3);
  room.submitAnswer(eva, correct - 3);
  assert.deepEqual(room.stateFor(ana).standings, [[ana], [rui, eva]]);
  assert.equal(room.stateFor(ana).tiebreakPending, true);

  room.nextQuestion(ana);
  assert.equal(room.phase, 'tiebreak');
  assert.deepEqual(room.tiebreak.ids, [rui, eva]);
  assert.notEqual(room.tiebreak.question, first);
  correct = room.tiebreak.question.answer;
  room.submitAnswer(eva, correct + 1);
  room.submitAnswer(rui, correct + 2);
  room.nextQuestion(ana);
  assert.equal(room.phase, 'end');
  assert.deepEqual(room.stateFor(ana).standings, [[ana], [eva], [rui]]);
});

test('quem se desliga no desempate fica atrás', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  room.updateSettings(ana, { rounds: 3 });
  playToLastReveal(room, ana);
  room.players.get(ana).score = 4;
  room.nextQuestion(ana);
  assert.deepEqual(room.tiebreak.ids, [rui, eva]);

  room.submitAnswer(eva, 123);
  room.disconnect(rui, 'socket-1');
  assert.equal(room.phase, 'tiebreak-reveal');
  room.nextQuestion(ana);
  assert.equal(room.phase, 'end');
  assert.deepEqual(room.stateFor(ana).standings, [[ana], [eva], [rui]]);
});

test('pergunta de mapa: dentro do país conta como acerto em cheio', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  startWith(room, ana, MAP_QUESTION);
  assert.equal(room.stateFor(ana).question.type, 'map');
  assert.throws(() => room.submitAnswer(ana, 42), /mapa/);
  assert.throws(() => room.submitAnswer(ana, { lat: 200, lon: 0 }), /mapa/);

  room.submitAnswer(ana, { lat: 33.7, lon: 73.0 }); // Islamabad
  room.submitAnswer(rui, { lat: 28.6, lon: 77.2 }); // Nova Deli
  room.submitAnswer(eva, { lat: 38.7, lon: -9.1 }); // Lisboa
  room.submitVote(ana, eva);
  room.submitVote(rui, eva);
  room.submitVote(eva, rui);

  const result = room.stateFor(rui).result;
  assert.equal(result.correct, 'Paquistão');
  assert.equal(result.country, '586');
  assert.equal(result.distances[ana], 0);
  assert.ok(result.distances[rui] > 200 && result.distances[rui] < 600, `Nova Deli: ${result.distances[rui]} km`);
  assert.ok(result.distances[eva] > 5000, `Lisboa: ${result.distances[eva]} km`);
  assert.deepEqual(scoresOf(room), { [ana]: 3, [rui]: 1, [eva]: 0 });
});

test('cerca de um quarto das perguntas de cada jogo são de mapa', () => {
  const { room, ids } = setup();
  room.updateSettings(ids[0], { rounds: 12 });
  room.startGame(ids[0]);
  assert.equal(room.questions.filter((q) => q.type === 'map').length, 3);
});

test('todas as perguntas de mapa apontam para um país que existe no mapa', () => {
  const { hasCountry } = require('../server/geo');
  const maps = require('../server/questions.json').filter((q) => q.type === 'map');
  assert.ok(maps.length >= 20);
  for (const q of maps) {
    assert.ok(hasCountry(q.country), q.text);
    assert.ok(q.label, q.text);
  }
});

test('o desempate nunca usa perguntas de mapa', () => {
  const { room, ids } = setup();
  room.updateSettings(ids[0], { rounds: 3 });
  playToLastReveal(room, ids[0]); // todos com 0 pontos
  for (let i = 0; i < 30; i++) {
    assert.notEqual(room.pickTiebreakQuestion().type, 'map');
  }
});

test('nenhuma pergunta pede contas', () => {
  const questions = require('../server/questions.json');
  for (const q of questions) {
    assert.doesNotMatch(q.text, /×|elevado|\bsoma\b|Quanto é|segundos tem|horas tem/, q.text);
  }
});

test('o temporizador fecha a fase de respostas', async () => {
  const { room, ids } = setup();
  room.settings.answerTime = 0.05; // 50 ms, só para o teste
  startWithNumber(room, ids[0]);
  room.submitAnswer(ids[0], 1);
  room.submitAnswer(ids[1], 2);
  assert.ok(room.stateFor(ids[0]).remainingMs > 0);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(room.phase, 'voting');
  room.destroy();
});
