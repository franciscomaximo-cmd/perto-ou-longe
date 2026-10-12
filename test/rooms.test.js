'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Room, GameError, clampTime, TOTAL_ROUNDS } = require('../server/rooms');

function setup(names = ['Ana', 'Rui', 'Eva']) {
  const room = new Room('TEST', () => {});
  const ids = names.map((n, i) => {
    const p = room.addPlayer(n);
    room.connect(p.id, `socket-${i}`);
    return p.id;
  });
  return { room, ids };
}

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
  assert.deepEqual(room.settings, { answerTime: 30, voteTime: 10 });
});

test('clampTime: 0 desliga, limites entre 10 e 180', () => {
  assert.equal(clampTime(0), 0);
  assert.equal(clampTime('abc'), 0);
  assert.equal(clampTime(3), 10);
  assert.equal(clampTime(999), 180);
});

test('respostas ficam escondidas até à revelação', () => {
  const { room, ids } = setup();
  room.startGame(ids[0]);
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
  room.startGame(ana);
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
  assert.deepEqual(scores, { [ana]: 2, [rui]: 1, [eva]: 0 });
  assert.equal(room.stateFor(rui).result.answers[eva], correct + 1000);
});

test('um jogador desligado não bloqueia a ronda', () => {
  const { room, ids } = setup();
  room.startGame(ids[0]);
  room.submitAnswer(ids[0], 1);
  room.submitAnswer(ids[1], 2);
  room.disconnect(ids[2], 'socket-2');
  assert.equal(room.phase, 'voting');
});

test('o jogo termina ao fim de 10 perguntas', () => {
  const { room, ids } = setup();
  room.startGame(ids[0]);
  for (let i = 1; i <= TOTAL_ROUNDS; i++) {
    assert.equal(room.round, i);
    room.forceAdvance(ids[0]);
    room.nextQuestion(ids[0]);
  }
  assert.equal(room.phase, 'end');
  const asked = new Set(room.questions.map((q) => q.text));
  assert.equal(asked.size, TOTAL_ROUNDS);
});

test('o temporizador fecha a fase de respostas', async () => {
  const { room, ids } = setup();
  room.settings.answerTime = 0.05; // 50 ms, só para o teste
  room.startGame(ids[0]);
  room.submitAnswer(ids[0], 1);
  room.submitAnswer(ids[1], 2);
  assert.ok(room.stateFor(ids[0]).remainingMs > 0);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(room.phase, 'voting');
  room.destroy();
});
