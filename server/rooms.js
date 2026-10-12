'use strict';

const crypto = require('crypto');
const { scoreRound, shuffle, distance } = require('./game');
const { distanceToCountry, centerOf } = require('./geo');
const QUESTIONS = require('./questions.json');

const MAP_QUESTIONS = QUESTIONS.filter((q) => q.type === 'map');
const NUMBER_QUESTIONS = QUESTIONS.filter((q) => q.type !== 'map');
const MAP_SHARE = 0.25; // cerca de 1 em cada 4 perguntas é de mapa

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const DEFAULT_ROUNDS = 10;
const MIN_ROUNDS = 3;
const MAX_ROUNDS = 30;
const MAX_NAME_LENGTH = 16;
const MAX_TIME_SECONDS = 180;
const MIN_TIME_SECONDS = 10;
const HOST_GRACE_MS = 20_000;
const ROOM_IDLE_MS = 10 * 60_000;
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I nem O, para não confundir com 1 e 0

// Erros "esperados", com mensagem para mostrar ao jogador.
class GameError extends Error {}

const rooms = new Map();

function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function cleanName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw new GameError('Escreve o teu nome.');
  return name;
}

// 0 = sem limite; caso contrário fica entre o mínimo e o máximo.
function clampTime(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_TIME_SECONDS, Math.max(MIN_TIME_SECONDS, n));
}

function clampRounds(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_ROUNDS;
  return Math.min(MAX_ROUNDS, QUESTIONS.length, Math.max(MIN_ROUNDS, n));
}

// Nas perguntas de números a resposta é um número; nas de mapa é um ponto { lat, lon }.
function validAnswer(question, value) {
  if (question.type === 'map') {
    const lat = Number(value && value.lat);
    const lon = Number(value && value.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new GameError('Toca no mapa para escolher um sítio.');
    }
    return { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) {
    throw new GameError('Escreve um número válido.');
  }
  return value;
}

// O que se mostra como resposta certa e como se mede a distância de cada palpite.
function correctOf(question) {
  return question.type === 'map' ? question.label : question.answer;
}
function measureFor(question) {
  if (question.type === 'map') return (value) => distanceToCountry(question.country, value);
  return (value) => distance(value, question.answer);
}

class Room {
  constructor(code, notify) {
    this.code = code;
    this.notify = notify; // chamado quando o estado muda fora de um pedido de um jogador (temporizadores)
    this.players = new Map();
    this.hostId = null;
    this.settings = { rounds: DEFAULT_ROUNDS, answerTime: 0, voteTime: 0 };
    this.phase = 'lobby'; // lobby | answering | voting | reveal | tiebreak | tiebreak-reveal | end
    this.round = 0;
    this.questions = [];
    this.usedQuestions = new Set();
    this.current = null;
    this.standings = null; // classificação final: [{ ids, settled }], do 1.º lugar para baixo
    this.tiebreak = null;
    this.tiebreakCount = 0;
    this.timer = null;
    this.deadline = null;
    this.hostTimer = null;
    this.lastActivity = Date.now();
  }

  touch() {
    this.lastActivity = Date.now();
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  requireHost(playerId) {
    if (playerId !== this.hostId) throw new GameError('Só o anfitrião pode fazer isso.');
  }

  // --- Jogadores ---------------------------------------------------------

  addPlayer(rawName) {
    if (this.phase !== 'lobby') throw new GameError('O jogo já começou nesta sala.');
    if (this.players.size >= MAX_PLAYERS) throw new GameError(`A sala está cheia (máximo ${MAX_PLAYERS} jogadores).`);
    const name = cleanName(rawName);
    const taken = [...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new GameError('Já existe um jogador com esse nome nesta sala.');

    const player = { id: crypto.randomUUID(), name, score: 0, connected: false, socketId: null };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this.touch();
    return player;
  }

  connect(playerId, socketId) {
    const player = this.players.get(playerId);
    player.connected = true;
    player.socketId = socketId;
    if (playerId === this.hostId) this.clearHostTimer();
    this.touch();
  }

  disconnect(playerId, socketId) {
    const player = this.players.get(playerId);
    // Ignora sockets antigos (o jogador pode já ter voltado com outro).
    if (!player || player.socketId !== socketId) return;
    player.connected = false;
    player.socketId = null;
    this.touch();

    if (playerId === this.hostId && !this.hostTimer) {
      // Dá tempo ao anfitrião para voltar (ex.: ecrã do telemóvel bloqueou).
      this.hostTimer = setTimeout(() => {
        this.hostTimer = null;
        const host = this.players.get(this.hostId);
        if (!host || !host.connected) {
          this.pickNewHost();
          this.notify(this);
        }
      }, HOST_GRACE_MS);
    }
    // Um jogador desligado não deve bloquear a ronda.
    this.checkProgress();
  }

  leave(playerId) {
    if (!this.players.has(playerId)) return;
    if (this.phase === 'lobby' || this.phase === 'end') {
      this.players.delete(playerId);
    } else {
      // A meio do jogo mantém-se o registo (respostas e votos já dados), apenas fica desligado.
      const player = this.players.get(playerId);
      player.connected = false;
      player.socketId = null;
    }
    if (playerId === this.hostId) this.pickNewHost();
    this.touch();
    this.checkProgress();
  }

  pickNewHost() {
    this.clearHostTimer();
    const all = [...this.players.values()];
    const next = all.find((p) => p.connected && p.id !== this.hostId) || all.find((p) => p.id !== this.hostId);
    if (next) this.hostId = next.id;
    else if (!this.players.has(this.hostId)) this.hostId = null;
  }

  clearHostTimer() {
    if (this.hostTimer) clearTimeout(this.hostTimer);
    this.hostTimer = null;
  }

  // --- Configuração ------------------------------------------------------

  updateSettings(playerId, settings) {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new GameError('Só podes mudar a configuração antes de começar.');
    if (settings.rounds !== undefined) this.settings.rounds = clampRounds(settings.rounds);
    if (settings.answerTime !== undefined) this.settings.answerTime = clampTime(settings.answerTime);
    if (settings.voteTime !== undefined) this.settings.voteTime = clampTime(settings.voteTime);
    this.touch();
  }

  // --- Fluxo do jogo -----------------------------------------------------

  startGame(playerId) {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new GameError('O jogo já começou.');
    if (this.connectedPlayers().length < MIN_PLAYERS) {
      throw new GameError(`São precisos pelo menos ${MIN_PLAYERS} jogadores ligados.`);
    }
    for (const p of this.players.values()) p.score = 0;
    this.questions = this.pickQuestions();
    this.round = 0;
    this.standings = null;
    this.tiebreak = null;
    this.tiebreakCount = 0;
    this.nextRound();
  }

  // Cerca de um quarto das perguntas são de mapa; o resto são de números.
  pickQuestions() {
    const rounds = this.settings.rounds;
    const maps = Math.min(MAP_QUESTIONS.length, Math.max(1, Math.round(rounds * MAP_SHARE)));
    return shuffle([...this.pickFrom(MAP_QUESTIONS, maps), ...this.pickFrom(NUMBER_QUESTIONS, rounds - maps)]);
  }

  // Evita repetir perguntas entre jogos na mesma sala, enquanto houver perguntas novas.
  pickFrom(pool, count) {
    let available = pool.filter((q) => !this.usedQuestions.has(q));
    if (available.length < count) {
      for (const q of pool) this.usedQuestions.delete(q);
      available = pool.filter((q) => !this.questions.includes(q));
    }
    const picked = shuffle(available).slice(0, count);
    for (const q of picked) this.usedQuestions.add(q);
    return picked;
  }

  // Pergunta extra para desempate (sempre de números), que não tenha saído neste jogo.
  pickTiebreakQuestion() {
    return this.pickFrom(NUMBER_QUESTIONS, 1)[0];
  }

  nextRound() {
    this.round += 1;
    this.current = {
      question: this.questions[this.round - 1],
      answers: new Map(),
      votes: new Map(),
      result: null,
    };
    this.setPhase('answering', this.settings.answerTime, () => this.endAnswering());
  }

  setPhase(phase, seconds = 0, onTimeout = null) {
    this.clearTimer();
    this.phase = phase;
    if (seconds > 0 && onTimeout) {
      this.deadline = Date.now() + seconds * 1000;
      this.timer = setTimeout(() => {
        this.timer = null;
        onTimeout();
        this.notify(this);
      }, seconds * 1000);
    }
    this.touch();
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  submitAnswer(playerId, value) {
    if (this.phase !== 'answering' && this.phase !== 'tiebreak') throw new GameError('Já não é possível responder.');
    if (!this.players.has(playerId)) throw new GameError('Não estás nesta sala.');
    if (this.phase === 'tiebreak' && !this.tiebreak.ids.includes(playerId)) {
      throw new GameError('Só os jogadores empatados respondem ao desempate.');
    }
    const { answers, question } = this.phase === 'tiebreak' ? this.tiebreak : this.current;
    if (answers.has(playerId)) throw new GameError('Já respondeste a esta pergunta.');
    answers.set(playerId, validAnswer(question, value));
    this.touch();
    this.checkProgress();
  }

  // Só se vota em quem respondeu e nunca em si próprio.
  candidatesFor(playerId) {
    if (!this.current) return [];
    return [...this.current.answers.keys()].filter((id) => id !== playerId);
  }

  submitVote(playerId, targetId) {
    if (this.phase !== 'voting') throw new GameError('Já não é possível votar.');
    if (!this.players.has(playerId)) throw new GameError('Não estás nesta sala.');
    if (this.current.votes.has(playerId)) throw new GameError('Já votaste nesta ronda.');
    if (targetId === playerId) throw new GameError('Não podes votar em ti próprio.');
    if (!this.candidatesFor(playerId).includes(targetId)) throw new GameError('Voto inválido.');
    this.current.votes.set(playerId, targetId);
    this.touch();
    this.checkProgress();
  }

  // Avança automaticamente quando todos os jogadores ligados já fizeram a sua parte.
  checkProgress() {
    const online = this.connectedPlayers();
    if (online.length === 0 || !this.current) return;
    if (this.phase === 'tiebreak') {
      const { ids, answers } = this.tiebreak;
      if (online.every((p) => !ids.includes(p.id) || answers.has(p.id))) this.revealTiebreak();
    } else if (this.phase === 'answering' && online.every((p) => this.current.answers.has(p.id))) {
      this.endAnswering();
    } else if (
      this.phase === 'voting' &&
      online.every((p) => this.current.votes.has(p.id) || this.candidatesFor(p.id).length === 0)
    ) {
      this.reveal();
    }
  }

  endAnswering() {
    if (this.phase !== 'answering') return;
    // Com menos de 2 respostas não há em quem votar: revela logo.
    if (this.current.answers.size < 2) {
      this.reveal();
      return;
    }
    this.setPhase('voting', this.settings.voteTime, () => this.reveal());
    this.checkProgress();
  }

  reveal() {
    if (this.phase !== 'answering' && this.phase !== 'voting') return;
    const { question, answers, votes } = this.current;
    this.current.result = scoreRound(correctOf(question), answers, votes, measureFor(question));
    for (const [id, pts] of Object.entries(this.current.result.points)) {
      const player = this.players.get(id);
      if (player) player.score += pts;
    }
    this.setPhase('reveal');
  }

  forceAdvance(playerId) {
    this.requireHost(playerId);
    if (this.phase === 'answering') this.endAnswering();
    else if (this.phase === 'voting') this.reveal();
    else if (this.phase === 'tiebreak') this.revealTiebreak();
    else throw new GameError('Não há nada para avançar agora.');
  }

  nextQuestion(playerId) {
    this.requireHost(playerId);
    if (this.phase === 'tiebreak-reveal') return this.nextTiebreak();
    if (this.phase !== 'reveal') throw new GameError('Ainda não é altura de avançar.');
    if (this.round < this.questions.length) return this.nextRound();
    this.standings = this.buildStandings();
    this.nextTiebreak();
  }

  // --- Desempates no fim do jogo ----------------------------------------
  // Cada grupo de jogadores com os mesmos pontos responde a uma pergunta extra,
  // sem votação: quem fica mais perto fica à frente. Repete enquanto houver empate.

  buildStandings() {
    const sorted = [...this.players.values()].sort((a, b) => b.score - a.score);
    const tiers = [];
    for (const p of sorted) {
      const last = tiers[tiers.length - 1];
      if (last && last.score === p.score) last.ids.push(p.id);
      else tiers.push({ score: p.score, ids: [p.id] });
    }
    return tiers.map((t) => ({ ids: t.ids, settled: t.ids.length === 1 }));
  }

  nextTiebreak() {
    for (;;) {
      const index = this.standings.findIndex((t) => !t.settled);
      if (index === -1) {
        this.tiebreak = null;
        this.setPhase('end');
        return;
      }
      const tier = this.standings[index];
      const online = tier.ids.filter((id) => this.players.get(id)?.connected);
      if (online.length >= 2) {
        this.tiebreakCount += 1;
        this.tiebreak = {
          number: this.tiebreakCount,
          ids: tier.ids,
          question: this.pickTiebreakQuestion(),
          answers: new Map(),
          result: null,
        };
        this.setPhase('tiebreak', this.settings.answerTime, () => this.revealTiebreak());
        return;
      }
      // Sem pelo menos 2 jogadores ligados não há desempate: quem está ligado fica à frente.
      const offline = tier.ids.filter((id) => !online.includes(id));
      const split = [online, offline].filter((ids) => ids.length).map((ids) => ({ ids, settled: true }));
      this.standings.splice(index, 1, ...split);
    }
  }

  revealTiebreak() {
    if (this.phase !== 'tiebreak') return;
    const tb = this.tiebreak;
    const correct = tb.question.answer;
    const distances = {};
    const measure = measureFor(tb.question);
    for (const [id, value] of tb.answers) distances[id] = measure(value);

    // Agrupa por distância (mais perto primeiro); quem não respondeu fica atrás, empatado entre si.
    const groups = [];
    for (const id of Object.keys(distances).sort((a, b) => distances[a] - distances[b])) {
      const last = groups[groups.length - 1];
      if (last && distances[last[0]] === distances[id]) last.push(id);
      else groups.push([id]);
    }
    const unanswered = tb.ids.filter((id) => !tb.answers.has(id));
    const tiers = groups.map((ids) => ({ ids, settled: ids.length === 1 }));
    if (unanswered.length) tiers.push({ ids: unanswered, settled: true });

    const index = this.standings.findIndex((t) => t.ids === tb.ids);
    this.standings.splice(index, 1, ...tiers);
    tb.result = { correct, answers: Object.fromEntries(tb.answers), distances, unanswered };
    this.setPhase('tiebreak-reveal');
  }

  backToLobby(playerId) {
    this.requireHost(playerId);
    if (this.phase !== 'end') throw new GameError('O jogo ainda não terminou.');
    this.current = null;
    this.round = 0;
    this.questions = [];
    this.standings = null;
    this.tiebreak = null;
    for (const p of this.players.values()) p.score = 0;
    // Quem saiu durante o jogo não fica a ocupar lugar na sala nova.
    for (const p of [...this.players.values()]) {
      if (!p.connected && p.id !== this.hostId) this.players.delete(p.id);
    }
    this.setPhase('lobby');
  }

  destroy() {
    this.clearTimer();
    this.clearHostTimer();
  }

  // --- Estado visível para cada jogador ---------------------------------
  // As respostas e os votos dos outros só são enviados depois da revelação.

  stateFor(playerId) {
    const cur = this.current;
    const state = {
      code: this.code,
      phase: this.phase,
      me: playerId,
      hostId: this.hostId,
      round: this.round,
      totalRounds: this.questions.length || this.settings.rounds,
      minRounds: MIN_ROUNDS,
      maxRounds: Math.min(MAX_ROUNDS, QUESTIONS.length),
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      settings: { ...this.settings },
      remainingMs: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        connected: p.connected,
      })),
    };

    if (cur && this.phase !== 'lobby') {
      state.question = { text: cur.question.text, unit: cur.question.unit || '', type: cur.question.type || 'number' };
      state.answered = [...cur.answers.keys()];
      state.voted = [...cur.votes.keys()];
      state.myAnswer = cur.answers.has(playerId) ? cur.answers.get(playerId) : null;
      state.myVote = cur.votes.get(playerId) || null;
      if (this.phase === 'voting') state.candidates = this.candidatesFor(playerId);
      if (cur.result) {
        state.result = {
          correct: correctOf(cur.question),
          // Só nas perguntas de mapa: para pintar o país e assinalar o centro.
          country: cur.question.country,
          center: cur.question.country ? centerOf(cur.question.country) : undefined,
          answers: Object.fromEntries(cur.answers),
          votes: Object.fromEntries(cur.votes),
          ...cur.result,
        };
      }
    }

    // No desempate o ecrã de resposta mostra a pergunta extra.
    const tb = this.tiebreak;
    if (tb && (this.phase === 'tiebreak' || this.phase === 'tiebreak-reveal')) {
      state.question = { text: tb.question.text, unit: tb.question.unit || '', type: 'number' };
      state.answered = [...tb.answers.keys()];
      state.myAnswer = tb.answers.has(playerId) ? tb.answers.get(playerId) : null;
      state.tiebreak = { number: tb.number, ids: [...tb.ids], result: tb.result };
    }
    if (this.standings) {
      state.standings = this.standings
        .map((t) => t.ids.filter((id) => this.players.has(id)))
        .filter((ids) => ids.length);
      state.tiebreakPending = this.standings.some((t) => !t.settled);
    }
    return state;
  }
}

function createRoom(notify) {
  const room = new Room(newCode(), notify);
  rooms.set(room.code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(normalizeCode(code)) || null;
}

function deleteRoom(code) {
  const room = rooms.get(code);
  if (room) room.destroy();
  rooms.delete(code);
}

// Apaga salas sem ninguém ligado há algum tempo (o estado vive só em memória).
function sweepIdleRooms(now = Date.now()) {
  for (const room of rooms.values()) {
    if (room.connectedPlayers().length === 0 && now - room.lastActivity > ROOM_IDLE_MS) {
      deleteRoom(room.code);
    }
  }
}

module.exports = {
  Room,
  GameError,
  createRoom,
  getRoom,
  deleteRoom,
  sweepIdleRooms,
  clampTime,
  clampRounds,
  MIN_PLAYERS,
  MAX_PLAYERS,
  DEFAULT_ROUNDS,
};
