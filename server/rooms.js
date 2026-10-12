'use strict';

const crypto = require('crypto');
const { scoreRound, shuffle } = require('./game');
const QUESTIONS = require('./questions.json');

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

class Room {
  constructor(code, notify) {
    this.code = code;
    this.notify = notify; // chamado quando o estado muda fora de um pedido de um jogador (temporizadores)
    this.players = new Map();
    this.hostId = null;
    this.settings = { rounds: DEFAULT_ROUNDS, answerTime: 0, voteTime: 0 };
    this.phase = 'lobby'; // lobby | answering | voting | reveal | end
    this.round = 0;
    this.questions = [];
    this.usedQuestions = new Set();
    this.current = null;
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
    this.nextRound();
  }

  // Evita repetir perguntas entre jogos na mesma sala, enquanto houver perguntas novas.
  pickQuestions() {
    const rounds = this.settings.rounds;
    let available = QUESTIONS.filter((_, i) => !this.usedQuestions.has(i));
    if (available.length < rounds) {
      this.usedQuestions.clear();
      available = QUESTIONS;
    }
    const picked = shuffle(available).slice(0, rounds);
    for (const q of picked) this.usedQuestions.add(QUESTIONS.indexOf(q));
    return picked;
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
    if (this.phase !== 'answering') throw new GameError('Já não é possível responder.');
    if (!this.players.has(playerId)) throw new GameError('Não estás nesta sala.');
    if (this.current.answers.has(playerId)) throw new GameError('Já respondeste a esta pergunta.');
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) {
      throw new GameError('Escreve um número válido.');
    }
    this.current.answers.set(playerId, value);
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
    if (this.phase === 'answering' && online.every((p) => this.current.answers.has(p.id))) {
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
    this.current.result = scoreRound(question.answer, answers, votes);
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
    else throw new GameError('Não há nada para avançar agora.');
  }

  nextQuestion(playerId) {
    this.requireHost(playerId);
    if (this.phase !== 'reveal') throw new GameError('Ainda não é altura de avançar.');
    if (this.round >= this.questions.length) this.setPhase('end');
    else this.nextRound();
  }

  backToLobby(playerId) {
    this.requireHost(playerId);
    if (this.phase !== 'end') throw new GameError('O jogo ainda não terminou.');
    this.current = null;
    this.round = 0;
    this.questions = [];
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
      state.question = { text: cur.question.text, unit: cur.question.unit || '' };
      state.answered = [...cur.answers.keys()];
      state.voted = [...cur.votes.keys()];
      state.myAnswer = cur.answers.has(playerId) ? cur.answers.get(playerId) : null;
      state.myVote = cur.votes.get(playerId) || null;
      if (this.phase === 'voting') state.candidates = this.candidatesFor(playerId);
      if (cur.result) {
        state.result = {
          correct: cur.question.answer,
          answers: Object.fromEntries(cur.answers),
          votes: Object.fromEntries(cur.votes),
          ...cur.result,
        };
      }
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
