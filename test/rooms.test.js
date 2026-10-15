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
  assert.deepEqual(room.settings, { rounds: DEFAULT_ROUNDS, answerTime: 30, voteTime: 10, categories: [], playerQuestions: false });
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
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
  startWithNumber(room, ids[0]);
  room.submitAnswer(ids[0], 1);
  room.submitAnswer(ids[1], 2);
  room.submitAnswer(ids[2], 3);
  room.disconnect(ids[3], 'socket-3');
  assert.equal(room.phase, 'voting');
});

test('com menos de 3 respostas não há votação nem pontos de voto', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  startWithNumber(room, ana);
  room.submitAnswer(ana, 200);
  room.submitAnswer(rui, 100);
  room.disconnect(eva, 'socket-2'); // a Eva não responde
  assert.equal(room.phase, 'reveal', 'passa direto à revelação');
  const r = room.stateFor(ana).result;
  assert.equal(r.voting, false);
  assert.deepEqual(r.votes, {});
  assert.deepEqual(r.correctVoters, []);
  // 2 palpites + resposta certa + pontos (sem o passo dos votos)
  assert.deepEqual([r.step, r.steps], [1, 4]);
  assert.deepEqual(scoresOf(room), { [ana]: 1, [rui]: 0, [eva]: 0 }, 'só o ponto de mais perto');
});

test('sem respostas, a revelação vai direto ao fim da ronda', () => {
  const { room, ids } = setup();
  startWithNumber(room, ids[0]);
  room.forceAdvance(ids[0]);
  const r = room.stateFor(ids[1]).result;
  assert.equal(r.voting, false);
  assert.equal(r.step, r.steps);
  assert.equal(r.steps, 2);
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

test('empates abaixo do 1.º lugar ficam como empate, sem desempate', () => {
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
  const [ana, rui, eva, to] = ids;
  room.updateSettings(ana, { rounds: 3 });
  playToLastReveal(room, ana);
  room.players.get(ana).score = 5;
  room.players.get(rui).score = 2;
  room.players.get(eva).score = 2;
  room.players.get(to).score = 0;
  room.nextQuestion(ana);
  assert.equal(room.phase, 'end');
  assert.deepEqual(room.stateFor(to).standings, [[ana], [rui, eva], [to]]);
  assert.equal(room.stateFor(to).tiebreakWinner, null);
});

test('desempate do 1.º lugar: só os empatados respondem e o vencedor fica marcado', () => {
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
  const [ana, rui, eva, to] = ids;
  room.updateSettings(ana, { rounds: 3 });
  playToLastReveal(room, ana);
  room.players.get(ana).score = 3;
  room.players.get(rui).score = 3;
  room.players.get(eva).score = 1;
  room.players.get(to).score = 1; // empate mais abaixo: fica como está
  const before = scoresOf(room);
  room.nextQuestion(ana);

  assert.equal(room.phase, 'tiebreak');
  assert.deepEqual(room.tiebreak.ids, [ana, rui]);
  assert.ok(!room.questions.includes(room.tiebreak.question), 'a pergunta de desempate é nova');
  assert.throws(() => room.submitAnswer(eva, 1), /empatados/);

  const correct = room.tiebreak.question.answer;
  room.submitAnswer(rui, correct + 1);
  room.submitAnswer(ana, correct + 5);
  assert.equal(room.phase, 'tiebreak-reveal');
  const state = room.stateFor(to);
  assert.deepEqual(state.standings, [[rui], [ana], [eva, to]]);
  assert.equal(state.tiebreakPending, false, 'o botão passa a "Ver classificação final"');
  assert.equal(state.tiebreakWinner, rui);
  assert.deepEqual(scoresOf(room), before, 'o desempate não mexe nos pontos');

  room.nextQuestion(ana);
  assert.equal(room.phase, 'end', 'não há desempate para o empate de Eva e Tó');
});

test('se o 1.º lugar voltar a empatar sai outra pergunta, só para esses', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  room.updateSettings(ana, { rounds: 3 });
  playToLastReveal(room, ana); // todos com 0 pontos

  room.nextQuestion(ana);
  assert.deepEqual(room.tiebreak.ids, [ana, rui, eva]);
  const first = room.tiebreak.question;
  let correct = first.answer;
  room.submitAnswer(ana, correct + 3);
  room.submitAnswer(rui, correct - 3);
  room.submitAnswer(eva, correct + 50);
  assert.deepEqual(room.stateFor(ana).standings, [[ana, rui], [eva]]);
  assert.equal(room.stateFor(ana).tiebreakPending, true, 'o botão diz "Continuar desempate"');

  room.nextQuestion(ana);
  assert.equal(room.phase, 'tiebreak');
  assert.deepEqual(room.tiebreak.ids, [ana, rui]);
  assert.notEqual(room.tiebreak.question, first);
  correct = room.tiebreak.question.answer;
  room.submitAnswer(rui, correct + 1);
  room.submitAnswer(ana, correct + 2);
  assert.equal(room.stateFor(ana).tiebreakPending, false);
  room.nextQuestion(ana);
  assert.equal(room.phase, 'end');
  assert.deepEqual(room.stateFor(ana).standings, [[rui], [ana], [eva]]);
  assert.equal(room.stateFor(ana).tiebreakWinner, rui);
});

test('se os perdedores do desempate empatarem entre si, não há novo desempate', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  room.updateSettings(ana, { rounds: 3 });
  playToLastReveal(room, ana);
  room.nextQuestion(ana);
  const correct = room.tiebreak.question.answer;
  room.submitAnswer(ana, correct);
  room.submitAnswer(rui, correct + 3);
  room.submitAnswer(eva, correct - 3);
  assert.deepEqual(room.stateFor(ana).standings, [[ana], [rui, eva]]);
  assert.equal(room.stateFor(ana).tiebreakPending, false);
  room.nextQuestion(ana);
  assert.equal(room.phase, 'end');
});

test('quem se desliga no desempate fica atrás', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  room.updateSettings(ana, { rounds: 3 });
  playToLastReveal(room, ana);
  room.players.get(ana).score = 0;
  room.players.get(rui).score = 4;
  room.players.get(eva).score = 4;
  room.nextQuestion(ana);
  assert.deepEqual(room.tiebreak.ids, [rui, eva]);

  room.submitAnswer(eva, 123);
  room.disconnect(rui, 'socket-1');
  assert.equal(room.phase, 'tiebreak-reveal');
  room.nextQuestion(ana);
  assert.equal(room.phase, 'end');
  assert.deepEqual(room.stateFor(ana).standings, [[eva], [rui], [ana]]);
});

test('perguntas de desempate têm resposta grande ou com casas decimais', () => {
  const { QUESTIONS, goodForTiebreak } = require('../server/rooms');
  const good = QUESTIONS.filter(goodForTiebreak);
  assert.ok(good.length > 100);
  for (const q of good) assert.ok(Math.abs(q.answer) >= 100 || !Number.isInteger(q.answer), q.text);
  const legislatura = QUESTIONS.find((q) => /legislatura/.test(q.text));
  assert.equal(goodForTiebreak(legislatura), false);
  const { room } = setup();
  for (let i = 0; i < 40; i++) assert.ok(goodForTiebreak(room.pickTiebreakQuestion()));
});

test('a revelação avança sozinha e o anfitrião pode saltar para o fim', async () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  room.revealStepMs = 5; // para o teste não demorar
  startWithNumber(room, ana);
  room.submitAnswer(ana, 200);
  room.submitAnswer(rui, 100);
  room.submitAnswer(eva, 50);
  room.forceAdvance(ana); // sem votos
  assert.equal(room.phase, 'reveal');
  // 3 palpites + resposta certa + pontos (com os votos)
  assert.deepEqual([room.stateFor(rui).result.step, room.stateFor(rui).result.steps], [1, 5]);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(room.stateFor(eva).result.step, 5, 'chega sozinha ao último passo e para aí');
  room.nextQuestion(ana);
  assert.equal(room.phase, 'answering');
  room.destroy();
});

test('"Avançar já" atrasado não salta a votação (corrida com a última resposta)', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  startWithNumber(room, ana);
  // O anfitrião carregou a ver a fase de respostas da pergunta 1…
  const seen = { phase: 'answering', round: 1, tb: null };
  room.submitAnswer(ana, 200);
  room.submitAnswer(rui, 100);
  room.submitAnswer(eva, 50); // …mas o último respondeu primeiro e já se passou à votação
  assert.equal(room.phase, 'voting');
  room.forceAdvance(ana, seen);
  assert.equal(room.phase, 'voting', 'o pedido atrasado é ignorado');
  // Com a fase certa, avança normalmente.
  room.forceAdvance(ana, { phase: 'voting', round: 1, tb: null });
  assert.equal(room.phase, 'reveal');
  room.destroy();
});

test('saltar e "Próxima pergunta" com fase antiga são ignorados; sem fase continuam a funcionar', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  startWithNumber(room, ana);
  for (const [id, v] of [[ana, 200], [rui, 100], [eva, 50]]) room.submitAnswer(id, v);
  room.forceAdvance(ana); // sem fase esperada (clientes antigos): aceita
  room.forceAdvance(ana, { phase: 'voting', round: 1, tb: null });
  assert.equal(room.phase, 'reveal');
  room.nextQuestion(ana, { phase: 'reveal', round: 1, tb: null });
  assert.equal(room.round, 2);
  // Segundo clique no mesmo botão (ainda a pensar na pergunta 1): não salta a 2.
  room.nextQuestion(ana, { phase: 'reveal', round: 1, tb: null });
  room.revealSkip(ana, { phase: 'reveal', round: 1, tb: null });
  assert.deepEqual([room.phase, room.round], ['answering', 2]);
  room.destroy();
});

test('saltar a revelação: só o anfitrião, e mostra tudo de uma vez', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  startWithNumber(room, ana);
  for (const [id, v] of [[ana, 200], [rui, 100], [eva, 50]]) room.submitAnswer(id, v);
  room.forceAdvance(ana);
  assert.throws(() => room.revealSkip(rui), /anfitrião/);
  room.revealSkip(ana);
  assert.equal(room.stateFor(eva).result.step, 5);
  assert.equal(room.revealTimer, null, 'a animação parou');
  room.nextQuestion(ana);
  assert.throws(() => room.revealSkip(ana), /revelar/);
  room.destroy();
});

test('cada jogador tem uma cor diferente e um emoji que pode trocar na sala de espera', () => {
  const { room, ids } = setup();
  const players = ids.map((id) => room.players.get(id));
  assert.equal(new Set(players.map((p) => p.color)).size, 3);
  assert.equal(new Set(players.map((p) => p.emoji)).size, 3);
  const free = room.stateFor(ids[0]).emojis.find((e) => !players.some((p) => p.emoji === e));
  room.setEmoji(ids[0], free);
  assert.equal(room.players.get(ids[0]).emoji, free);
  assert.throws(() => room.setEmoji(ids[1], free), /outro jogador/);
  assert.throws(() => room.setEmoji(ids[1], 'x'), /disponível/);
  startWithNumber(room, ids[0]);
  assert.throws(() => room.setEmoji(ids[1], free), /antes de começar/);
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

test('todas as perguntas têm categoria e cada categoria tem pelo menos 15', () => {
  const questions = require('../server/questions.json');
  const counts = {};
  for (const q of questions) counts[q.category] = (counts[q.category] || 0) + 1;
  assert.deepEqual(Object.keys(counts).sort(), ['ciencia', 'cultura', 'desporto', 'geografia', 'historia', 'precos']);
  for (const [cat, n] of Object.entries(counts)) assert.ok(n >= 15, `${cat}: ${n}`);
  for (const q of questions.filter((x) => x.category === 'precos')) {
    assert.equal(q.unit, 'euros', q.text);
    assert.match(q.text, /\b20\d\d\b/, `o preço indica o ano: ${q.text}`);
  }
});

test('só saem perguntas das categorias escolhidas', () => {
  const { room, ids } = setup();
  room.updateSettings(ids[0], { categories: ['desporto', 'historia', 'inventada'], rounds: 12 });
  assert.deepEqual(room.settings.categories, ['desporto', 'historia']);
  room.startGame(ids[0]);
  assert.equal(room.questions.length, 12);
  assert.ok(room.questions.every((q) => ['desporto', 'historia'].includes(q.category)));
  assert.ok(room.questions.every((q) => q.type !== 'map'), 'sem Geografia não há mapas');
  assert.equal(room.stateFor(ids[1]).question.category === 'Desporto' || room.stateFor(ids[1]).question.category === 'História', true);
});

test('escolher todas as categorias é o mesmo que "Todas"', () => {
  const { room, ids } = setup();
  room.updateSettings(ids[0], { categories: ['geografia', 'desporto', 'historia', 'cultura', 'precos', 'ciencia'] });
  assert.deepEqual(room.settings.categories, []);
});

test('se a categoria não chega para as rondas, o jogo fica mais curto e avisa', () => {
  const { room, ids } = setup();
  room.updateSettings(ids[0], { categories: ['precos'], rounds: 30 });
  // Todas as categorias reais já têm mais de 30 perguntas: simula uma com só 16.
  const small = room.questionPool().slice(0, 16);
  room.questionPool = () => small;
  const state = room.stateFor(ids[0]);
  assert.equal(state.plannedRounds, 16);
  room.startGame(ids[0]);
  assert.equal(room.questions.length, 16);
  assert.equal(new Set(room.questions).size, 16);
});

test('Geografia sozinha mistura perguntas de mapa e de números', () => {
  const { room, ids } = setup();
  room.updateSettings(ids[0], { categories: ['geografia'], rounds: 8 });
  room.startGame(ids[0]);
  const maps = room.questions.filter((q) => q.type === 'map').length;
  assert.equal(maps, 2);
});

// --- Perguntas dos jogadores ---------------------------------------------

function setupCustom(names = ['Ana', 'Rui', 'Eva', 'Tó']) {
  const ctx = setup(names);
  ctx.room.updateSettings(ctx.ids[0], { playerQuestions: true, rounds: 5 });
  return ctx;
}

test('perguntas dos jogadores: exigem 4 jogadores e uma pergunta de cada', () => {
  const three = setup();
  three.room.updateSettings(three.ids[0], { playerQuestions: true });
  assert.equal(three.room.stateFor(three.ids[0]).minPlayers, 4);
  assert.throws(() => three.room.startGame(three.ids[0]), /pelo menos 4/);

  const { room, ids } = setupCustom();
  room.submitCustomQuestion(ids[0], { text: 'Quantos primos tenho?', answer: 23 });
  room.submitCustomQuestion(ids[1], { text: 'Quantos gatos tem a minha avó?', answer: 4, unit: 'gatos' });
  assert.throws(() => room.startGame(ids[0]), /Eva, Tó/);
  assert.deepEqual(room.stateFor(ids[2]).customReady, [ids[0], ids[1]]);
  assert.equal(room.stateFor(ids[2]).myQuestion, null, 'não se vê a pergunta dos outros');
  assert.equal(room.stateFor(ids[1]).myQuestion.unit, 'gatos');
});

test('perguntas dos jogadores: saem todas, mesmo com menos rondas pedidas', () => {
  const { room, ids } = setupCustom();
  room.updateSettings(ids[0], { rounds: 3 });
  const lobby = room.stateFor(ids[0]);
  assert.equal(lobby.customNeeded, 4);
  assert.equal(lobby.minRounds, 4, 'o mínimo do regulador sobe para 4');
  assert.equal(lobby.plannedRounds, 4);
  for (const [i, id] of ids.entries()) room.submitCustomQuestion(id, { text: `Pergunta número ${i} de teste?`, answer: i });
  room.startGame(ids[0]);
  assert.equal(room.questions.length, 4);
  assert.deepEqual(room.questions.map((q) => q.author).sort(), [...ids].sort());
});

test('perguntas dos jogadores: validação e limpeza do texto', () => {
  const { room, ids } = setupCustom();
  assert.throws(() => room.submitCustomQuestion(ids[0], { text: 'Curta?', answer: 1 }), /pelo menos/);
  assert.throws(() => room.submitCustomQuestion(ids[0], { text: 'Quantos anos tem o meu pai?', answer: 'cinquenta' }), /número/);
  assert.throws(() => room.submitCustomQuestion(ids[0], { text: 'Quantos anos tem o meu pai?', answer: NaN }), /número/);
  room.submitCustomQuestion(ids[0], {
    text: '  <script>alert(1)</script>\n\nQuantos   anos tem o meu pai?' + 'x'.repeat(300),
    answer: 58,
    unit: 'anos'.repeat(10),
  });
  const q = room.customQuestions.get(ids[0]);
  assert.equal(q.text.length, 120);
  assert.ok(!/\n/.test(q.text));
  assert.equal(q.unit.length, 20);
  // O texto é guardado tal como foi escrito (sem HTML interpretado): o cliente mostra-o com textContent.
  assert.ok(q.text.startsWith('<script>'));

  const off = setup();
  assert.throws(() => off.room.submitCustomQuestion(off.ids[0], { text: 'Quantos anos tem o meu pai?', answer: 58 }), /não ligou/);
});

test('perguntas dos jogadores: o autor não responde, mas vota, e não conta para mais perto/longe', () => {
  const { room, ids } = setupCustom();
  const [ana, rui, eva, to] = ids;
  for (const [i, id] of ids.entries()) room.submitCustomQuestion(id, { text: `Pergunta número ${i} de teste?`, answer: 100 + i });
  room.startGame(ana);
  assert.equal(room.questions.filter((q) => q.author).length, 4);
  assert.equal(room.questions.length, 5);

  // Põe a pergunta da Ana na primeira ronda.
  room.current.question = room.customQuestions.get(ana);
  assert.equal(room.stateFor(rui).question.author, ana);
  assert.throws(() => room.submitAnswer(ana, 100), /é tua/);
  room.submitAnswer(rui, 100); // em cheio
  room.submitAnswer(eva, 90);
  assert.equal(room.phase, 'answering');
  room.submitAnswer(to, 500);
  assert.equal(room.phase, 'voting', 'avança sem esperar pela resposta do autor');

  assert.deepEqual(room.candidatesFor(ana).sort(), [rui, eva, to].sort());
  room.submitVote(ana, to);
  room.submitVote(rui, to);
  room.submitVote(eva, rui);
  room.submitVote(to, eva);
  assert.equal(room.phase, 'reveal');
  const r = room.current.result;
  assert.deepEqual(r.closest, [rui]);
  assert.deepEqual(r.farthest, [to]);
  assert.ok(!(ana in r.distances));
  assert.deepEqual(scoresOf(room), { [ana]: 1, [rui]: 3, [eva]: 0, [to]: 0 });
});

test('perguntas dos jogadores: limpam-se ao voltar à sala de espera', () => {
  const { room, ids } = setupCustom();
  for (const [i, id] of ids.entries()) room.submitCustomQuestion(id, { text: `Pergunta número ${i} de teste?`, answer: i });
  room.startGame(ids[0]);
  while (room.phase !== 'end') {
    if (room.phase === 'tiebreak') finishTiebreaks(room, ids[0]);
    else { room.forceAdvance(ids[0]); room.nextQuestion(ids[0]); }
  }
  room.backToLobby(ids[0]);
  assert.equal(room.customQuestions.size, 0);
});

// --- Prémios -------------------------------------------------------------

// Joga uma ronda de números com respostas e votos dados.
function playRound(room, host, answer, guesses, votes) {
  room.current.question = { text: 'Teste?', answer, category: 'ciencia' };
  for (const [id, v] of Object.entries(guesses)) room.submitAnswer(id, v);
  for (const [voter, target] of Object.entries(votes)) room.submitVote(voter, target);
  if (room.phase !== 'reveal') room.forceAdvance(host);
  if (room.phase !== 'reveal') room.forceAdvance(host);
}

test('prémios: mais certeiro, mais longe e melhor a ler os outros', () => {
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
  const [ana, rui, eva, to] = ids;
  room.updateSettings(ana, { rounds: 3 });
  room.startGame(ana);
  playRound(room, ana, 100, { [ana]: 100, [rui]: 150, [eva]: 300, [to]: 90 }, { [ana]: eva, [rui]: eva, [eva]: to, [to]: rui });
  room.nextQuestion(ana);
  playRound(room, ana, 1000, { [ana]: 990, [rui]: 5000, [eva]: 1200, [to]: 2000 }, { [ana]: rui, [rui]: to, [eva]: rui, [to]: eva });
  room.nextQuestion(ana);
  playRound(room, ana, 10, { [ana]: 50, [rui]: 12, [eva]: 9, [to]: 11 }, { [ana]: rui, [rui]: ana, [eva]: ana, [to]: rui });
  room.nextQuestion(ana);
  finishTiebreaks(room, ana);
  assert.equal(room.phase, 'end');

  const awards = Object.fromEntries(room.stateFor(rui).awards.map((a) => [a.id, a.winners.map((w) => w.id)]));
  // Mais perto: Ana 2 vezes (100 e 990); Eva e Tó 1 vez cada (empatados na 3.ª, a 1 do 10).
  assert.deepEqual(awards.sharp, [ana]);
  // Mais longe: Eva (300), Rui (5000) e Ana (50), uma vez cada: empate entre os três.
  assert.deepEqual(awards.far.sort(), [ana, rui, eva].sort());
  // Votos certos: Ana (Eva, Rui), Rui (Eva, Ana) e Eva (Rui, Ana) com 2; Tó com 0.
  assert.deepEqual(awards.reader.sort(), [ana, rui, eva].sort());
  assert.equal(room.stateFor(rui).awards.find((a) => a.id === 'sharp').winners[0].closest, 2);
});

test('prémios: empate no mais certeiro desfaz-se pelo erro médio', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  room.updateSettings(ana, { rounds: 3 });
  room.startGame(ana);
  playRound(room, ana, 100, { [ana]: 100, [rui]: 120, [eva]: 400 }, {});
  room.nextQuestion(ana);
  playRound(room, ana, 100, { [ana]: 300, [rui]: 105, [eva]: 400 }, {});
  room.nextQuestion(ana);
  playRound(room, ana, 100, { [ana]: 300, [rui]: 300, [eva]: 400 }, {});
  // Ana e Rui: 2 vezes mais perto cada (na 3.ª empatam); Rui tem menor erro médio.
  assert.deepEqual(room.awards().find((a) => a.id === 'sharp').winners.map((w) => w.id), [rui]);
  assert.equal(room.awards().find((a) => a.id === 'reader'), undefined, 'sem votos não há prémio');
});

test('nenhuma pergunta pede contas', () => {
  const { QUESTIONS } = require('../server/rooms');
  for (const q of QUESTIONS) {
    assert.doesNotMatch(q.text, /×|elevado|\bsoma\b|Quanto é|segundos tem|horas tem/, q.text);
  }
});

test('perguntas de mapa: "fica" ou "ficam" conforme o artigo guardado de cada país', () => {
  const { QUESTIONS } = require('../server/rooms');
  const text = (label) => QUESTIONS.find((q) => q.label === label).text;
  assert.equal(text('Filipinas'), 'Onde ficam as Filipinas?');
  assert.equal(text('Camarões'), 'Onde ficam os Camarões?');
  assert.equal(text('Paquistão'), 'Onde fica o Paquistão?');
  assert.equal(text('Angola'), 'Onde fica Angola?');
  assert.equal(text('Geórgia'), 'Onde fica a Geórgia (o país)?');
  for (const q of QUESTIONS.filter((x) => x.type === 'map')) {
    assert.ok(['', 'o', 'a', 'os', 'as'].includes(q.article), `artigo em falta: ${q.label}`);
  }
});

test('monumentos estrangeiros não estão em Geografia', () => {
  const { QUESTIONS } = require('../server/rooms');
  const bigBen = QUESTIONS.find((q) => /Big Ben/.test(q.text));
  assert.equal(bigBen.category, 'ciencia');
  assert.ok(!QUESTIONS.some((q) => q.category === 'geografia' && /Torre Eiffel|Burj|Pisa|Empire State/.test(q.text)));
});

test('o temporizador fecha a fase de respostas (com poucas respostas, sem votação)', async () => {
  const { room, ids } = setup();
  room.settings.answerTime = 0.05; // 50 ms, só para o teste
  startWithNumber(room, ids[0]);
  room.submitAnswer(ids[0], 1);
  room.submitAnswer(ids[1], 2);
  assert.ok(room.stateFor(ids[0]).remainingMs > 0);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(room.phase, 'reveal');
  assert.equal(room.stateFor(ids[0]).result.voting, false);
  room.destroy();
});
