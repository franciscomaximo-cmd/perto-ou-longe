'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Room, GameError, clampTime, clampRounds, DEFAULT_ROUNDS } = require('../server/rooms');

// Todos os jogadores dizem que estão prontos e o anfitrião começa. (As regras do "pronto"
// têm os seus próprios testes, em rooms.test.js.)
function startGame(room, hostId) {
  for (const p of room.players.values()) p.ready = true;
  return room.startGame(hostId);
}

// (As rondas especiais ficam desligadas nos testes, para os pontos serem previsíveis; os
// testes das rondas especiais ligam-nas.)
function setup(names = ['Ana', 'Rui', 'Eva']) {
  const room = new Room('TEST', () => {});
  room.settings.specialRounds = false;
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
  startGame(room, host);
  room.current.question = question;
}
const startWithNumber = (room, host) => startWith(room, host, NUMBER_QUESTION);

// --- Pronto para começar e expulsar ----------------------------------------------------------

const readyOf = (room, viewer) => Object.fromEntries(room.stateFor(viewer).players.map((p) => [p.name, p.ready]));

test('pronto: não deixa começar com alguém ligado não pronto; o anfitrião conta como pronto', () => {
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
  const [ana, rui, eva] = ids;
  assert.deepEqual(readyOf(room, rui), { Ana: true, Rui: false, Eva: false, Tó: false }, 'quem entra começa não pronto; o anfitrião está sempre');
  room.setReady(rui, true);
  room.setReady(eva, true);
  assert.throws(() => room.startGame(ana), /Falta 1 jogador ficar pronto: Tó/);
  room.setReady(eva, false);
  assert.throws(() => room.startGame(ana), /Faltam 2 jogadores ficarem prontos: Eva, Tó/);
  assert.throws(() => room.setReady(ana, true), /anfitrião/, 'o anfitrião não precisa');
  room.setReady(eva, true);
  room.setReady(ids[3], true);
  room.startGame(ana);
  assert.equal(room.phase, 'answering');
  assert.throws(() => room.setReady(rui, false), /sala de espera/);
  room.destroy();
});

test('pronto: desligados não bloqueiam; mudar o boneco não tira o pronto', () => {
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
  const [ana, rui, eva, to] = ids;
  room.setReady(rui, true);
  room.setReady(eva, true);
  room.setCharacter(rui, { hat: 'gorro', skin: '#5a3520' });
  assert.equal(room.players.get(rui).ready, true, 'mudar o boneco não tira o pronto');
  room.disconnect(to, 'socket-3'); // o Tó saiu de casa e ficou desligado
  room.startGame(ana);
  assert.equal(room.phase, 'answering');
  room.destroy();
});

test('pronto: mudar a configuração repõe os estados (e avisa); mexer sem mudar nada não', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  room.setReady(rui, true);
  room.setReady(eva, true);
  const v = room.stateFor(rui).rulesVersion;
  room.updateSettings(ana, { rounds: room.settings.rounds }); // igual: não muda nada
  assert.equal(room.players.get(rui).ready, true);
  assert.equal(room.stateFor(rui).rulesVersion, v);
  for (const change of [{ rounds: 15 }, { answerTime: 45 }, { voteTime: 30 }, { categories: ['historia'] }, { playerQuestions: true }]) {
    room.setReady(rui, change.playerQuestions ? false : true);
    room.updateSettings(ana, change);
    assert.equal(room.players.get(rui).ready, false, `depois de ${JSON.stringify(change)}`);
    assert.ok(room.stateFor(rui).rulesVersion > v, 'os clientes mostram "O anfitrião mudou as regras"');
  }
  room.destroy();
});

test('pronto: com perguntas dos jogadores, só fica pronto quem já escreveu a sua', () => {
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
  const [ana, rui] = ids;
  room.updateSettings(ana, { playerQuestions: true });
  assert.throws(() => room.setReady(rui, true), /pergunta/);
  room.submitCustomQuestion(rui, { text: 'Quantos irmãos tem o Rui?', answer: 3 });
  room.setReady(rui, true);
  assert.equal(room.players.get(rui).ready, true);
  room.setReady(rui, false); // desfazer é sempre possível
  room.destroy();
});

test('pronto: "Jogar de novo" repõe os estados; novo anfitrião continua a funcionar', () => {
  const { room, ids } = setup(['Ana', 'Rui', 'Eva']);
  const [ana, rui, eva] = ids;
  startGame(room, ana);
  room.phase = 'end';
  room.backToLobby(ana);
  assert.deepEqual(readyOf(room, rui), { Ana: true, Rui: false, Eva: false });
  // O anfitrião sai: o Rui passa a anfitrião (conta como pronto) e a Ana já não está.
  room.leave(ana);
  assert.equal(room.hostId, rui);
  assert.deepEqual(readyOf(room, rui), { Rui: true, Eva: false });
  room.addPlayer('Zé');
  room.connect([...room.players.values()].find((p) => p.name === 'Zé').id, 'socket-z');
  assert.throws(() => room.startGame(rui), /Faltam 2 jogadores ficarem prontos: Eva, Zé/);
  room.destroy();
});

test('expulsar: só o anfitrião, só na sala de espera; o expulso não volta com a sessão', () => {
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
  const [ana, rui, eva, to] = ids;
  assert.throws(() => room.kick(rui, eva), /anfitrião/);
  assert.throws(() => room.kick(ana, ana), /a ti próprio/);
  const kicked = room.kick(ana, to);
  assert.equal(kicked.name, 'Tó');
  assert.equal(room.players.has(to), false);
  assert.ok(room.kicked.has(to), 'fica marcado: a sessão guardada já não volta a entrar');
  assert.throws(() => room.kick(ana, to), /já não está/);
  // Expulsar quem bloqueava deixa começar.
  room.setReady(rui, true);
  room.setReady(eva, true);
  startGame(room, ana);
  assert.throws(() => room.kick(ana, rui), /sala de espera/);
  room.destroy();
});

test('o primeiro jogador é o anfitrião e os nomes são únicos', () => {
  const { room, ids } = setup();
  assert.equal(room.hostId, ids[0]);
  assert.throws(() => room.addPlayer('ana'), GameError);
});

test('não começa com menos de 3 jogadores ligados', () => {
  const { room, ids } = setup(['Ana', 'Rui']);
  assert.throws(() => startGame(room, ids[0]), /pelo menos 3/);
});

test('só o anfitrião começa e configura', () => {
  const { room, ids } = setup();
  assert.throws(() => startGame(room, ids[1]), /anfitrião/);
  assert.throws(() => room.updateSettings(ids[1], { answerTime: 30 }), /anfitrião/);
  room.updateSettings(ids[0], { answerTime: 30, voteTime: 5 });
  assert.deepEqual(room.settings, { mode: 'turma', rounds: DEFAULT_ROUNDS, answerTime: 30, voteTime: 10, categories: [], playerQuestions: false, specialRounds: false });
  assert.equal(new Room('X', () => {}).settings.specialRounds, true, 'rondas especiais ligadas por defeito');
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

// Joga uma ronda de números com palpites todos diferentes (o 1.º jogador fica mais perto) e
// para na revelação.
function revealNumberRound(room, ids) {
  room.current.question = NUMBER_QUESTION;
  ids.forEach((id, i) => room.submitAnswer(id, NUMBER_QUESTION.answer + i * 7));
  room.forceAdvance(ids[0]);
  assert.equal(room.phase, 'reveal');
}

test('ordem da revelação: escolhida pelo servidor, igual para todos os clientes (e ao recarregar)', () => {
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó', 'Lia', 'Zé']);
  startGame(room, ids[0]);
  revealNumberRound(room, ids);
  const order = room.stateFor(ids[0]).result.order;
  assert.deepEqual([...order].sort(), [...ids].sort(), 'cada palpite aparece uma vez');
  for (const id of ids) assert.deepEqual(room.stateFor(id).result.order, order, 'todos veem a mesma ordem');
  assert.deepEqual(room.stateFor(ids[3]).result.order, order, 'quem recarrega vê a mesma ordem');
  // Não é a antiga ordem previsível (do mais longe para o mais perto).
  const farToNear = [...ids].reverse();
  assert.notDeepEqual(order, farToNear);
  // A ordem não mexe nos pontos: o 1.º jogador continua a ser o mais perto.
  assert.deepEqual(room.stateFor(ids[0]).result.closest, [ids[0]]);
  room.destroy();
});

test('ordem da revelação: muda entre rondas e o último revelado não é sempre o vencedor', () => {
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
  startGame(room, ids[0]);
  const orders = [];
  for (let round = 0; round < 8; round++) {
    revealNumberRound(room, ids);
    orders.push(room.stateFor(ids[1]).result.order.join());
    room.nextQuestion(ids[0]);
  }
  for (let i = 1; i < orders.length; i++) assert.notEqual(orders[i], orders[i - 1], `ronda ${i + 1} repetiu a ordem`);
  assert.ok(new Set(orders).size > 1);
  assert.ok(orders.some((o) => !o.endsWith(ids[0])), 'o vencedor (Ana) nem sempre é o último');
  room.destroy();
});

test('ordem da revelação: nas perguntas de mapa continua do mais longe para o mais perto', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  startWith(room, ana, MAP_QUESTION);
  room.submitAnswer(ana, { lat: 33.7, lon: 73.0 }); // Islamabad
  room.submitAnswer(rui, { lat: 28.6, lon: 77.2 }); // Nova Deli
  room.submitAnswer(eva, { lat: 38.7, lon: -9.1 }); // Lisboa
  room.forceAdvance(ana);
  assert.deepEqual(room.stateFor(rui).result.order, [eva, rui, ana]);
  room.destroy();
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
  startGame(room, host);
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
    startGame(room, ids[0]);
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

test('cada jogador tem uma cor diferente e uma cara (que não tem de ser única), sem emoji', () => {
  const { room, ids } = setup();
  const players = ids.map((id) => room.players.get(id));
  assert.equal(new Set(players.map((p) => p.color)).size, 3);
  for (const p of players) {
    assert.equal(p.emoji, undefined);
    assert.ok(p.character.skin && p.character.hair, 'cada jogador novo recebe uma cara');
  }
  const state = room.stateFor(ids[0]);
  assert.equal(state.emojis, undefined);
  assert.ok(state.players.every((p) => p.character.skin && !('emoji' in p)), 'a cara vai no room:state');
  // Dois jogadores podem ter exatamente a mesma cara.
  const same = {
    skin: '#d9a066', face: 'oval', eyes: 'estrelas', brows: 'grossas', mouth: 'dentes',
    hair: 'moicano', hairColor: '#4dabf7', facial: 'nenhum', faceExtra: 'sardas',
  };
  room.setCharacter(ids[0], same);
  room.setCharacter(ids[1], same);
  assert.deepEqual(room.players.get(ids[0]).character, room.players.get(ids[1]).character);
  assert.equal(typeof room.setEmoji, 'undefined', 'já não há regra de emoji único');
  room.destroy();
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
  startGame(room, ids[0]);
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
  const { CATEGORIES } = require('../server/rooms');
  assert.deepEqual(Object.keys(counts).sort(), CATEGORIES.map((c) => c.id).sort(), 'todas as categorias têm perguntas');
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
  startGame(room, ids[0]);
  assert.equal(room.questions.length, 12);
  assert.ok(room.questions.every((q) => ['desporto', 'historia'].includes(q.category)));
  // Desporto e História também têm algumas perguntas de mapa (cerca de 1 em cada 4 rondas).
  assert.equal(room.questions.filter((q) => q.type === 'map').length, 3);
  assert.equal(room.stateFor(ids[1]).question.category === 'Desporto' || room.stateFor(ids[1]).question.category === 'História', true);
});

test('escolher todas as categorias é o mesmo que "Todas", e "Todas" inclui as novas', () => {
  const { CATEGORIES, QUESTIONS } = require('../server/rooms');
  const { room, ids } = setup();
  room.updateSettings(ids[0], { categories: CATEGORIES.map((c) => c.id) });
  assert.deepEqual(room.settings.categories, []);
  assert.equal(room.questionPool().length, QUESTIONS.length);
  for (const id of ['musica', 'cinema', 'comida', 'animais', 'espaco', 'corpo', 'tecnologia', 'recordes']) {
    assert.ok(room.questionPool().some((q) => q.category === id), id);
  }
  // Sem as novas, já não é "Todas".
  room.updateSettings(ids[0], { categories: ['geografia', 'desporto', 'historia', 'cultura', 'precos', 'ciencia'] });
  assert.equal(room.settings.categories.length, 6);
});

test('perguntas de mapa fora da Geografia: texto próprio e o país como resposta', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  const { QUESTIONS } = require('../server/rooms');
  const machu = QUESTIONS.find((q) => q.type === 'map' && /Machu Picchu/.test(q.text));
  assert.equal(machu.text, 'Onde fica Machu Picchu, a cidade inca?');
  startWith(room, ana, machu);
  room.submitAnswer(ana, { lat: -13.16, lon: -72.55 }); // Machu Picchu
  room.submitAnswer(rui, { lat: -16.5, lon: -68.15 }); // La Paz
  room.submitAnswer(eva, { lat: 38.7, lon: -9.1 }); // Lisboa
  room.forceAdvance(ana);
  const r = room.stateFor(rui).result;
  assert.equal(r.correct, 'Peru');
  assert.equal(r.distances[ana], 0);
  assert.ok(r.distances[rui] > 0 && r.distances[rui] < r.distances[eva]);
});

test('uma categoria nova com mapas também mistura perguntas de mapa; sem mapas, só números', () => {
  const { room, ids } = setup();
  room.updateSettings(ids[0], { categories: ['historia'], rounds: 8 });
  startGame(room, ids[0]);
  assert.equal(room.questions.filter((q) => q.type === 'map').length, 2);
  const other = setup();
  other.room.updateSettings(other.ids[0], { categories: ['corpo'], rounds: 8 });
  startGame(other.room, other.ids[0]);
  assert.equal(other.room.questions.filter((q) => q.type === 'map').length, 0);
});

test('se a categoria não chega para as rondas, o jogo fica mais curto e avisa', () => {
  const { room, ids } = setup();
  room.updateSettings(ids[0], { categories: ['precos'], rounds: 30 });
  // Todas as categorias reais já têm mais de 30 perguntas: simula uma com só 16.
  const small = room.questionPool().slice(0, 16);
  room.questionPool = () => small;
  const state = room.stateFor(ids[0]);
  assert.equal(state.plannedRounds, 16);
  startGame(room, ids[0]);
  assert.equal(room.questions.length, 16);
  assert.equal(new Set(room.questions).size, 16);
});

test('Geografia sozinha mistura perguntas de mapa e de números', () => {
  const { room, ids } = setup();
  room.updateSettings(ids[0], { categories: ['geografia'], rounds: 8 });
  startGame(room, ids[0]);
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
  assert.throws(() => startGame(three.room, three.ids[0]), /pelo menos 4/);

  const { room, ids } = setupCustom();
  room.submitCustomQuestion(ids[0], { text: 'Quantos primos tenho?', answer: 23 });
  room.submitCustomQuestion(ids[1], { text: 'Quantos gatos tem a minha avó?', answer: 4, unit: 'gatos' });
  assert.throws(() => startGame(room, ids[0]), /Eva, Tó/);
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
  startGame(room, ids[0]);
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
  startGame(room, ana);
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
  startGame(room, ids[0]);
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
  startGame(room, ana);
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
  startGame(room, ana);
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

test('reações: só os 6 emojis, só na revelação, no máximo uma a cada 0,7 s por jogador', () => {
  const { REACTIONS, REACTION_GAP_MS } = require('../server/rooms');
  const { room, ids } = setup();
  const [ana, rui] = ids;
  assert.deepEqual(REACTIONS, ['😂', '😱', '👏', '🤦', '🔥', '🤯']);
  assert.throws(() => room.react(ana, '😂', 1000), /durante a revelação/, 'na sala de espera não');
  startWithNumber(room, ana);
  assert.throws(() => room.react(ana, '😂', 1000), /durante a revelação/, 'a responder não');
  for (const id of ids) room.submitAnswer(id, 200);
  for (let i = 0; i < 3 && room.phase !== 'reveal'; i++) room.forceAdvance(ana);
  assert.equal(room.phase, 'reveal');
  assert.deepEqual(room.react(rui, '🔥', 1000), { id: rui, emoji: '🔥' });
  assert.equal(room.react(rui, '😂', 1000 + REACTION_GAP_MS - 1), null, 'depressa demais: ignorada');
  assert.deepEqual(room.react(ana, '😂', 1001), { id: ana, emoji: '😂' }, 'o limite é por jogador');
  assert.deepEqual(room.react(rui, '😂', 1000 + REACTION_GAP_MS), { id: rui, emoji: '😂' });
  assert.throws(() => room.react(rui, 'olá', 9000), /não existe/, 'sem texto livre');
  assert.throws(() => room.react(rui, '💩', 9000), /não existe/);
  assert.throws(() => room.react('ninguém', '😂', 9000), /Não estás/);
  // Também nos resultados (o último passo da revelação) e sem nada guardado no estado.
  room.revealSkip(ana);
  assert.ok(room.react(rui, '👏', 20000));
  assert.ok(!JSON.stringify(room.stateFor(ana)).includes('👏'));
  room.destroy();
});
// --- Chat (sala de espera e fim do jogo) -------------------------------------------------------

test('chat: texto simples até 200 caracteres (mais longo dá erro), limpo e guardado como texto', () => {
  const { CHAT_MAX_LENGTH } = require('../server/rooms');
  const { room, ids } = setup();
  const [ana, rui] = ids;
  assert.equal(CHAT_MAX_LENGTH, 200);
  room.chatSend(ana, 'x'.repeat(200), 1000);
  assert.throws(() => room.chatSend(rui, 'x'.repeat(201), 1000), /no máximo 200 caracteres/);
  // Os emojis contam como um carácter cada.
  room.chatSend(rui, '😂'.repeat(200), 5000);
  assert.throws(() => room.chatSend(ana, '   ', 9000), /Escreve uma mensagem/);
  assert.throws(() => room.chatSend(ana, { text: 'olá' }, 9000), /Escreve uma mensagem/, 'só texto');
  // Quebras de linha e caracteres de controlo viram espaços; o HTML fica como texto (o cliente
  // mostra-o sempre com textContent).
  room.chatSend(ana, '  <img src=x onerror=alert(1)>\n\n olá\u0000 \u202E turma  ', 20000);
  const msgs = room.stateFor(rui).chat.messages.filter((m) => m.kind === 'msg');
  assert.equal(msgs.at(-1).text, '<img src=x onerror=alert(1)> olá turma');
  assert.equal(msgs.at(-1).name, 'Ana');
  assert.equal(msgs.at(-1).from, ana);
  room.destroy();
});

test('chat: no máximo uma mensagem a cada 1,5 s por jogador', () => {
  const { CHAT_GAP_MS } = require('../server/rooms');
  const { room, ids } = setup();
  const [ana, rui] = ids;
  assert.equal(CHAT_GAP_MS, 1500);
  room.chatSend(ana, 'olá', 1000);
  assert.throws(() => room.chatSend(ana, 'outra vez', 1000 + CHAT_GAP_MS - 1), /Espera um bocadinho/);
  room.chatSend(rui, 'eu também posso', 1001); // o limite é por jogador
  room.chatSend(ana, 'agora já dá', 1000 + CHAT_GAP_MS);
  assert.deepEqual(room.chat.filter((m) => m.kind === 'msg').map((m) => m.text), ['olá', 'eu também posso', 'agora já dá']);
  room.destroy();
});

test('chat: o anfitrião silencia (e volta a deixar escrever); expulsos deixam de poder escrever', () => {
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
  const [ana, rui, eva, to] = ids;
  assert.throws(() => room.chatMute(rui, eva, true), /Só o anfitrião/);
  assert.throws(() => room.chatMute(ana, ana, true), /a ti próprio/);
  room.chatMute(ana, rui, true);
  assert.deepEqual(room.stateFor(eva).chat.muted, [rui], 'todos sabem quem está silenciado');
  assert.throws(() => room.chatSend(rui, 'deixem-me falar', 1000), /silenciou-te/);
  room.chatSend(eva, 'eu posso', 1000);
  room.chatMute(ana, rui, false);
  room.chatSend(rui, 'voltei', 3000);
  // Expulso: sai da sala e já não consegue escrever.
  room.kick(ana, to);
  assert.throws(() => room.chatSend(to, 'ainda estou aqui?', 9000), /Não estás nesta sala/);
  assert.ok(room.chat.some((m) => m.kind === 'info' && m.text === 'Tó saiu'));
  room.destroy();
});

test('chat: mensagens automáticas, só as últimas 50, e fechado durante o jogo', () => {
  const { CHAT_KEEP } = require('../server/rooms');
  const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
  const [ana, rui, eva] = ids;
  const infos = () => room.chat.filter((m) => m.kind === 'info').map((m) => m.text);
  assert.deepEqual(infos(), ['Ana entrou na turma', 'Rui entrou na turma', 'Eva entrou na turma', 'Tó entrou na turma']);
  room.updateSettings(ana, { rounds: 5 });
  room.updateSettings(ana, { rounds: 6 }); // seguidas: juntam-se numa só
  assert.equal(infos().filter((t) => t === 'O anfitrião mudou as regras').length, 1);
  room.leave(eva);
  assert.equal(infos().at(-1), 'Eva saiu');
  for (let i = 0; i < 70; i++) room.chatSend(i % 2 ? ana : rui, `mensagem ${i}`, 10000 + i * 1000);
  assert.equal(room.chat.length, CHAT_KEEP);
  assert.equal(room.chat.at(-1).text, 'mensagem 69');
  // Quem entra (ou volta) recebe as recentes no estado.
  assert.equal(room.stateFor(rui).chat.messages.length, CHAT_KEEP);
  // Durante o jogo o chat não vai no estado e não aceita mensagens.
  startWithNumber(room, ana);
  assert.equal(room.stateFor(rui).chat, null);
  assert.throws(() => room.chatSend(rui, 'psst', 999999), /só está aberto/);
  room.destroy();
});
// --- Modo Duelo (2 jogadores) -------------------------------------------------------------------

function duelSetup(names = ['Ana', 'Rui']) {
  const { room, ids } = setup(names);
  room.updateSettings(ids[0], { mode: 'duelo' });
  for (const p of room.players.values()) p.ready = true;
  return { room, ids };
}
// Os dois respondem: a revelação começa logo (sem votação).
function duelRound(room, [a, b], va, vb) {
  room.current.question = NUMBER_QUESTION; // resposta certa: 206
  room.submitAnswer(a, va);
  room.submitAnswer(b, vb);
}

test('duelo: começa só com exatamente 2 jogadores ligados e prontos', () => {
  const { MODES } = require('../server/rooms');
  assert.deepEqual(MODES, ['turma', 'duelo']);
  // Em "Turma", 2 jogadores não chegam.
  const two = setup(['Ana', 'Rui']);
  for (const p of two.room.players.values()) p.ready = true;
  assert.throws(() => two.room.startGame(two.ids[0]), /pelo menos 3/);
  two.room.updateSettings(two.ids[0], { mode: 'duelo' });
  assert.equal(two.room.stateFor(two.ids[1]).settings.mode, 'duelo');
  assert.equal(two.room.stateFor(two.ids[1]).minPlayers, 2);
  assert.throws(() => two.room.startGame(two.ids[0]), /pronto/, 'mudar as regras tira o "pronto"');
  for (const p of two.room.players.values()) p.ready = true;
  two.room.startGame(two.ids[0]);
  assert.equal(two.room.phase, 'answering');
  two.room.destroy();
  // Sozinho: falta o adversário.
  const one = setup(['Ana']);
  one.room.updateSettings(one.ids[0], { mode: 'duelo' });
  assert.throws(() => one.room.startGame(one.ids[0]), /Falta um adversário/);
  one.room.destroy();
  // Um terceiro pode entrar na sala, mas o duelo não começa (o anfitrião pode mudar para Turma).
  const three = duelSetup(['Ana', 'Rui', 'Eva']);
  assert.throws(() => three.room.startGame(three.ids[0]), /só para 2 jogadores \(estão 3 ligados\)/);
  three.room.updateSettings(three.ids[0], { mode: 'turma' });
  for (const p of three.room.players.values()) p.ready = true;
  three.room.startGame(three.ids[0]);
  three.room.destroy();
  // Um terceiro desligado não conta e não fica na pauta do duelo.
  const away = duelSetup(['Ana', 'Rui', 'Eva']);
  away.room.disconnect(away.ids[2], 'socket-2');
  away.room.startGame(away.ids[0]);
  assert.deepEqual([...away.room.players.keys()], away.ids.slice(0, 2));
  assert.deepEqual(away.room.stateFor(away.ids[0]).duel.ids, away.ids.slice(0, 2));
  away.room.destroy();
  // Modo desconhecido volta a "Turma"; no duelo não há perguntas dos jogadores.
  const odd = setup();
  odd.room.updateSettings(odd.ids[0], { mode: 'batalha' });
  assert.equal(odd.room.settings.mode, 'turma');
  odd.room.updateSettings(odd.ids[0], { playerQuestions: true });
  odd.room.updateSettings(odd.ids[0], { mode: 'duelo' });
  assert.equal(odd.room.settings.playerQuestions, false);
  odd.room.updateSettings(odd.ids[0], { playerQuestions: true });
  assert.equal(odd.room.settings.playerQuestions, false);
  odd.room.destroy();
});

test('duelo: sem fase de votação; pontos como no modo normal (1, em cheio 2, empate para os dois)', () => {
  const { room, ids } = duelSetup();
  const [ana, rui] = ids;
  room.startGame(ana);
  // Ana mais perto: 1 ponto; logo a seguir às respostas vem a revelação.
  duelRound(room, ids, 200, 100);
  assert.equal(room.phase, 'reveal');
  const r1 = room.stateFor(ana).result;
  assert.equal(r1.voting, false);
  assert.deepEqual(r1.points, { [ana]: 1 });
  assert.throws(() => room.submitVote(rui, ana), /Já não é possível votar/);
  room.nextQuestion(ana);
  // Rui em cheio: 2 pontos.
  duelRound(room, ids, 300, 206);
  assert.equal(room.phase, 'reveal');
  assert.deepEqual(room.stateFor(ana).result.points, { [rui]: 2 });
  room.nextQuestion(ana);
  // Igualmente perto (um por baixo, outro por cima): ganham os dois.
  duelRound(room, ids, 196, 216);
  assert.deepEqual(room.stateFor(ana).result.points, { [ana]: 1, [rui]: 1 });
  assert.deepEqual(room.stateFor(ana).result.closest.sort(), [ana, rui].sort());
  // Marcador e estatísticas do duelo.
  assert.deepEqual(room.players.get(ana).score, 2);
  assert.deepEqual(room.players.get(rui).score, 3);
  assert.deepEqual(room.stateFor(rui).duel, { ids, stats: { [ana]: { won: 2, exact: 0 }, [rui]: { won: 2, exact: 1 } } });
  room.destroy();
});

test('duelo: empate no fim vai ao desempate; ecrã final sem o quadro de honra da turma', () => {
  const { room, ids } = duelSetup();
  const [ana, rui] = ids;
  room.updateSettings(ana, { rounds: 3 });
  for (const p of room.players.values()) p.ready = true;
  room.startGame(ana);
  for (let i = 0; i < 3; i++) {
    duelRound(room, ids, 200, 212); // os dois a 6: empate em todas as rondas
    room.nextQuestion(ana);
  }
  assert.equal(room.phase, 'tiebreak', '3–3: desempate');
  assert.deepEqual(room.stateFor(ana).tiebreak.ids.sort(), [ana, rui].sort());
  const q = room.tiebreak.question;
  room.submitAnswer(ana, q.answer);
  room.submitAnswer(rui, q.answer + 1000);
  assert.equal(room.phase, 'tiebreak-reveal');
  assert.equal(room.tiebreakWinner, ana);
  room.nextQuestion(ana);
  assert.equal(room.phase, 'end');
  const end = room.stateFor(rui);
  assert.deepEqual(end.standings, [[ana], [rui]]);
  assert.deepEqual(end.awards, [], 'sem prémios de turma');
  assert.deepEqual(end.duel.stats, { [ana]: { won: 3, exact: 0 }, [rui]: { won: 3, exact: 0 } });
  // Com "Turma", os prémios continuam lá.
  room.destroy();
});

test('duelo: os temas de revelação com 2 jogadores (vencedor o melhor, o outro o pior; empate: os dois)', () => {
  const { presentationOf } = require('../public/reveal/presentation');
  const two = presentationOf([{ id: 'a', precision: 0.03 }, { id: 'b', precision: 0.5 }], { closest: ['a'], farthest: ['b'], exact: [] });
  assert.deepEqual([two.a.level, two.a.winner, two.b.level, two.b.farthest], [0, true, 1, true]);
  const tie = presentationOf([{ id: 'a', precision: 0.03 }, { id: 'b', precision: 0.03 }], { closest: ['a', 'b'], farthest: ['a', 'b'], exact: [] });
  assert.deepEqual([tie.a.level, tie.a.winner, tie.b.level, tie.b.winner], [0, true, 0, true]);
});
// --- Rondas especiais ------------------------------------------------------------------------

// Torna a ronda atual especial (como se o servidor a tivesse sorteado).
function makeSpecial(room, type, { textUntil = null } = {}) {
  room.current.special = { type, introUntil: Date.now() - 1, textUntil };
}
// Responde e passa a votação (se houver) até à revelação.
function answerAll(room, ids, values) {
  ids.forEach((id, i) => { if (values[i] !== undefined) room.submitAnswer(id, values[i]); });
}
const toReveal = (room, host) => { while (room.phase === 'answering' || room.phase === 'voting') room.forceAdvance(host); };

test('ronda especial "Pontos a dobrar": todos os pontos da ronda contam a dobrar', () => {
  const { room, ids } = setup();
  const [ana, rui, eva] = ids;
  startWithNumber(room, ana);
  makeSpecial(room, 'dobrar');
  answerAll(room, ids, [206, 100, 50]); // Ana em cheio (2), Eva a mais longe
  room.submitVote(ana, eva); // certo
  room.submitVote(rui, eva); // certo
  room.submitVote(eva, rui); // errado
  assert.equal(room.phase, 'reveal');
  const r = room.stateFor(ana).result;
  assert.deepEqual(r.points, { [ana]: 6, [rui]: 2 }, 'Ana: (2 + 1) × 2; Rui: 1 × 2');
  assert.equal(r.special.type, 'dobrar');
  assert.deepEqual([room.players.get(ana).score, room.players.get(rui).score, room.players.get(eva).score], [6, 2, 0]);
  room.destroy();
});

test('ronda especial "Ronda relâmpago": 10 segundos para responder, seja qual for o tempo escolhido', () => {
  const { LIGHTNING_SECONDS, SPECIAL_INTRO_MS } = require('../server/rooms');
  for (const answerTime of [0, 60]) {
    const { room, ids } = setup();
    room.settings.answerTime = answerTime;
    startWithNumber(room, ids[0]);
    answerAll(room, ids, [1, 2, 3]);
    toReveal(room, ids[0]);
    room.pickSpecial = () => ({ type: 'relampago', introUntil: Date.now() + SPECIAL_INTRO_MS, textUntil: null });
    room.nextQuestion(ids[0]);
    const st = room.stateFor(ids[1]);
    assert.equal(st.special.type, 'relampago');
    assert.equal(st.special.answerSeconds, LIGHTNING_SECONDS);
    // 10 s depois do anúncio (que não conta).
    const left = st.remainingMs;
    assert.ok(left > (LIGHTNING_SECONDS * 1000 + SPECIAL_INTRO_MS) - 300 && left <= LIGHTNING_SECONDS * 1000 + SPECIAL_INTRO_MS, `tempo: ${left} ms (escolhido: ${answerTime} s)`);
    room.destroy();
  }
});

test('ronda relâmpago: quem não responde a tempo fica sem palpite', async () => {
  const { room, ids } = setup();
  startWithNumber(room, ids[0]);
  answerAll(room, ids, [1, 2, 3]);
  toReveal(room, ids[0]);
  // (Tempos encurtados só para o teste: o mesmo caminho do temporizador.)
  room.pickSpecial = () => ({ type: 'relampago', introUntil: Date.now(), textUntil: null });
  room.settings.answerTime = 0;
  const realSetPhase = room.setPhase.bind(room);
  room.setPhase = (phase, seconds, onTimeout) => realSetPhase(phase, phase === 'answering' ? 0.05 : seconds, onTimeout);
  room.nextQuestion(ids[0]);
  room.current.question = NUMBER_QUESTION;
  room.submitAnswer(ids[0], 206);
  await new Promise((r) => setTimeout(r, 120));
  assert.notEqual(room.phase, 'answering');
  assert.deepEqual([...room.current.answers.keys()], [ids[0]], 'só a Ana tem palpite');
  room.destroy();
});

test('ronda especial "Toda a turma ganha": +1 para todos só se TODOS ficarem perto', () => {
  // Todos a menos de 10% de 206 (< 20,6): +1 para todos, além dos pontos normais.
  {
    const { room, ids } = setup();
    const [ana, rui, eva] = ids;
    startWithNumber(room, ana);
    makeSpecial(room, 'todos');
    answerAll(room, ids, [200, 190, 220]);
    toReveal(room, ana);
    const r = room.stateFor(ana).result;
    assert.equal(r.special.allWin, true);
    assert.deepEqual(r.points, { [ana]: 2, [rui]: 1, [eva]: 1 }, 'Ana mais perto (1) + 1; os outros + 1');
    room.destroy();
  }
  // Um jogador a falhar (150 está a 56 da resposta): a ronda conta normalmente.
  {
    const { room, ids } = setup();
    const [ana, , eva] = ids;
    startWithNumber(room, ana);
    makeSpecial(room, 'todos');
    answerAll(room, ids, [200, 190, 150]);
    toReveal(room, ana);
    const r = room.stateFor(ana).result;
    assert.equal(r.special.allWin, false);
    assert.deepEqual(r.special.missed, [eva]);
    assert.deepEqual(r.points, { [ana]: 1 });
    room.destroy();
  }
  // Alguém ligado sem responder também conta como falhar.
  {
    const { room, ids } = setup();
    startWithNumber(room, ids[0]);
    makeSpecial(room, 'todos');
    answerAll(room, ids, [200, 210]);
    toReveal(room, ids[0]);
    assert.equal(room.stateFor(ids[0]).result.special.allWin, false);
    room.destroy();
  }
  // Mapa: a menos de 500 km do país (Paquistão).
  for (const [far, allWin] of [[{ lat: 31.5, lon: 74.3 }, true], [{ lat: 48.86, lon: 2.35 }, false]]) {
    const { room, ids } = setup();
    startWith(room, ids[0], MAP_QUESTION);
    makeSpecial(room, 'todos');
    answerAll(room, ids, [{ lat: 33.7, lon: 73 }, { lat: 28.6, lon: 77.2 }, far]); // Islamabad, Deli (~400 km), e Lahore ou Paris
    toReveal(room, ids[0]);
    assert.equal(room.stateFor(ids[0]).result.special.allWin, allWin, allWin ? 'todos perto' : 'Paris fica longe');
    room.destroy();
  }
});

test('ronda especial "Último lugar ataca": o ponto do mais perto só vai para a metade de baixo da pauta', () => {
  // O mais perto (Ana) vai à frente na pauta: o ponto passa para o mais perto da metade de baixo.
  {
    const { room, ids } = setup();
    const [ana, rui, eva] = ids;
    startWithNumber(room, ana);
    room.players.get(ana).score = 5;
    room.players.get(rui).score = 2;
    room.players.get(eva).score = 0;
    assert.deepEqual(room.bottomHalf(), [eva]);
    makeSpecial(room, 'ultimo');
    answerAll(room, ids, [205, 150, 100]); // Ana a 1, Rui a 56, Eva a 106 (a mais longe)
    room.submitVote(ana, eva); // certo: os votos contam normalmente para todos
    room.submitVote(rui, eva); // certo
    room.submitVote(eva, rui);
    const r = room.stateFor(ana).result;
    assert.deepEqual(r.closest, [ana], 'quem ficou mais perto continua a ser a Ana');
    assert.deepEqual(r.special.awarded, [eva]);
    assert.equal(r.special.moved, true);
    assert.deepEqual(r.points, { [ana]: 1, [rui]: 1, [eva]: 1 }, 'Ana e Rui: o voto; Eva: o ponto do mais perto');
    room.destroy();
  }
  // Com 4 jogadores, a metade de baixo são os 2 últimos; em cheio continua a valer 2.
  {
    const { room, ids } = setup(['Ana', 'Rui', 'Eva', 'Tó']);
    const [ana, rui, eva, to] = ids;
    startWithNumber(room, ana);
    [5, 3, 1, 0].forEach((s, i) => { room.players.get(ids[i]).score = s; });
    assert.deepEqual(room.bottomHalf().sort(), [eva, to].sort());
    makeSpecial(room, 'ultimo');
    answerAll(room, ids, [300, 206, 206, 100]); // Rui e Eva em cheio; só a Eva é de baixo
    toReveal(room, ana);
    const r = room.stateFor(ana).result;
    assert.deepEqual(r.special.awarded, [eva]);
    assert.equal(r.points[eva], 2);
    assert.equal(r.points[rui], undefined, 'o Rui (de cima) não ganha o ponto do mais perto');
    room.destroy();
  }
  // Pauta toda empatada: este tipo não pode sair.
  {
    const { room, ids } = setup();
    startWithNumber(room, ids[0]);
    for (const p of room.players.values()) p.score = 2;
    assert.equal(room.specialAllowed('ultimo'), false);
    room.players.get(ids[1]).score = 3;
    assert.equal(room.specialAllowed('ultimo'), true);
    room.destroy();
  }
  // Duelo: só quem vai a perder pode ganhar o ponto do mais perto.
  {
    const { room, ids } = setup(['Ana', 'Rui']);
    room.updateSettings(ids[0], { mode: 'duelo' });
    for (const p of room.players.values()) p.ready = true;
    room.startGame(ids[0]);
    room.current.question = NUMBER_QUESTION;
    room.players.get(ids[0]).score = 3;
    room.players.get(ids[1]).score = 1;
    makeSpecial(room, 'ultimo');
    answerAll(room, ids, [206, 250]);
    const r = room.stateFor(ids[0]).result;
    assert.deepEqual(room.bottomHalf(), [ids[1]]);
    assert.deepEqual(r.points, { [ids[1]]: 1 }, 'a Ana acertou em cheio, mas o ponto vai para o Rui');
    room.destroy();
  }
});

test('ronda especial "Às escuras": o texto só se vê 5 s (depois só a categoria e a unidade); pontos normais', () => {
  const { DARK_MS } = require('../server/rooms');
  assert.equal(DARK_MS, 5000);
  const { room, ids } = setup();
  const q = { text: 'Qual a altura da Torre dos Clérigos?', answer: 75, unit: 'metros', category: 'cultura' };
  startWith(room, ids[0], q);
  makeSpecial(room, 'escuras', { textUntil: Date.now() + 4000 });
  let st = room.stateFor(ids[1]);
  assert.equal(st.question.text, q.text, 'nos primeiros 5 s vê-se');
  assert.ok(st.special.hideTextMs > 3000 && st.special.hideTextMs <= 4000);
  room.current.special.textUntil = Date.now() - 1; // passaram os 5 s
  st = room.stateFor(ids[1]);
  assert.equal(st.question.text, null, 'o texto deixa de ser enviado');
  assert.equal(st.question.unit, 'metros');
  assert.equal(st.question.category, 'Cultura Portuguesa');
  answerAll(room, ids, [75, 60, 10]);
  toReveal(room, ids[0]);
  st = room.stateFor(ids[1]);
  assert.equal(st.question.text, q.text, 'na revelação volta a aparecer');
  assert.deepEqual(st.result.points, { [ids[0]]: 2 }, 'pontos normais');
  // Mapa: o texto também desaparece, o mapa continua (a pergunta continua a ser de mapa).
  const m = setup();
  startWith(m.room, m.ids[0], MAP_QUESTION);
  makeSpecial(m.room, 'escuras', { textUntil: Date.now() - 1 });
  const ms = m.room.stateFor(m.ids[0]);
  assert.equal(ms.question.text, null);
  assert.equal(ms.question.type, 'map');
  m.room.destroy();
  room.destroy();
});

test('rondas especiais: ~1 em cada 4, nunca a primeira, nunca seguidas, sem repetir o tipo, nunca no desempate', () => {
  const { planSpecialRounds, SPECIAL_TYPES } = require('../server/rooms');
  for (let run = 0; run < 200; run++) {
    const plan = planSpecialRounds(12);
    assert.equal(plan.length, 3);
    assert.ok(!plan.includes(1));
    for (let i = 1; i < plan.length; i++) assert.ok(plan[i] - plan[i - 1] >= 2, `seguidas: ${plan}`);
  }
  assert.equal(planSpecialRounds(10).length, 3);
  assert.equal(planSpecialRounds(3).length, 1);
  assert.equal(planSpecialRounds(30).length, 8);
  // Jogos inteiros de 12 rondas: o que o servidor manda no room:state.
  const seen = new Set();
  for (let run = 0; run < 40; run++) {
    const { room, ids } = setup();
    room.updateSettings(ids[0], { rounds: 12, specialRounds: true, categories: ['corpo'] }); // só números
    startGame(room, ids[0]);
    const types = [];
    for (let i = 0; i < 12; i++) {
      const st = room.stateFor(ids[1]);
      types.push(st.special ? st.special.type : null);
      // Todos com o mesmo estado (a mesma ronda especial).
      assert.deepEqual(room.stateFor(ids[2]).special && room.stateFor(ids[2]).special.type, st.special && st.special.type);
      // A Ana fica sempre mais perto: a pauta deixa de estar empatada a partir da 2.ª ronda.
      answerAll(room, ids, [206, 100, 50]);
      toReveal(room, ids[0]);
      if (st.special) seen.add(st.special.type);
      room.nextQuestion(ids[0]);
    }
    const specials = types.map((t, i) => [i + 1, t]).filter(([, t]) => t);
    assert.equal(specials.length, 3, `3 rondas especiais em 12: ${types}`);
    assert.equal(types[0], null, 'nunca a primeira');
    for (let i = 1; i < 12; i++) assert.ok(!(types[i] && types[i - 1]), 'nunca duas seguidas');
    for (let i = 1; i < specials.length; i++) assert.notEqual(specials[i][1], specials[i - 1][1], 'o mesmo tipo não sai seguido');
    assert.equal(room.phase, 'end');
    room.destroy();
  }
  assert.deepEqual([...seen].sort(), [...SPECIAL_TYPES].sort(), 'saem os cinco tipos');
  // Pauta toda empatada (ninguém responde): nunca sai "Último lugar ataca"; no desempate nunca há especial.
  for (let run = 0; run < 30; run++) {
    const { room, ids } = setup();
    room.updateSettings(ids[0], { rounds: 8, specialRounds: true });
    startGame(room, ids[0]);
    for (let i = 0; i < 8; i++) {
      const st = room.stateFor(ids[0]);
      assert.ok(!st.special || st.special.type !== 'ultimo', 'pauta empatada: sem "Último lugar ataca"');
      toReveal(room, ids[0]);
      room.nextQuestion(ids[0]);
    }
    assert.equal(room.phase, 'tiebreak', 'todos a 0: desempate');
    assert.equal(room.stateFor(ids[0]).special, null, 'no desempate não há ronda especial');
    room.destroy();
  }
  // Opção desligada: nenhuma.
  const { room, ids } = setup();
  room.updateSettings(ids[0], { rounds: 12, specialRounds: false });
  startGame(room, ids[0]);
  assert.equal(room.specialPlan.size, 0);
  room.destroy();
});