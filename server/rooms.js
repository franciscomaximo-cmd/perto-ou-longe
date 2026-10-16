'use strict';

const crypto = require('crypto');
const { scoreRound, shuffle, distance } = require('./game');
const { distanceToCountry, centerOf } = require('./geo');
const { ThemeDeck } = require('./themes');
const CharacterOptions = require('../public/reveal/character-options');
const { revealPace } = require('../public/reveal/pace');
// Perguntas de mapa: o texto é montado com o artigo guardado de cada país
// ("os Camarões", "as Filipinas" → "Onde ficam…"; "Angola", sem artigo → "Onde fica Angola?").
// Fora da Geografia a pergunta traz o seu próprio texto (ex.: "Onde fica Machu Picchu?"); a
// resposta continua a ser o país (`label`), e um palpite dentro dele conta como em cheio.
function mapQuestionText(q) {
  if (q.text) return q.text;
  const verb = q.article === 'os' || q.article === 'as' ? 'ficam' : 'fica';
  const name = q.article ? `${q.article} ${q.label}` : q.label;
  return `Onde ${verb} ${name}${q.note ? ` (${q.note})` : ''}?`;
}

const QUESTIONS = require('./questions.json').map((q) => (q.type === 'map' ? { ...q, text: mapQuestionText(q) } : q));

const MAP_SHARE = 0.25; // cerca de 1 em cada 4 perguntas é de mapa (quando o conjunto tem mapas)

const CATEGORIES = [
  { id: 'geografia', label: 'Geografia' },
  { id: 'desporto', label: 'Desporto' },
  { id: 'historia', label: 'História' },
  { id: 'cultura', label: 'Cultura Portuguesa' },
  { id: 'precos', label: 'Adivinha o Preço' },
  { id: 'ciencia', label: 'Ciência e Curiosidades' },
  { id: 'musica', label: 'Música' },
  { id: 'cinema', label: 'Cinema e Televisão' },
  { id: 'comida', label: 'Comida e Bebida' },
  { id: 'animais', label: 'Animais e Natureza' },
  { id: 'espaco', label: 'Espaço e Astronomia' },
  { id: 'corpo', label: 'Corpo Humano' },
  { id: 'tecnologia', label: 'Tecnologia e Jogos' },
  { id: 'recordes', label: 'Recordes e Coisas Absurdas' },
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
const CATEGORY_COUNTS = Object.fromEntries(CATEGORIES.map((c) => [c.id, QUESTIONS.filter((q) => q.category === c.id).length]));

// Lista vazia = todas as categorias.
function cleanCategories(list) {
  const ids = [...new Set([].concat(list || []))].filter((id) => CATEGORY_LABELS[id]);
  return ids.length === CATEGORIES.length ? [] : CATEGORIES.map((c) => c.id).filter((id) => ids.includes(id));
}

const MIN_PLAYERS = 3;
const MIN_ANSWERS_TO_VOTE = 3;
// Com perguntas dos jogadores, quem escreveu não responde: com 3 jogadores sobravam só 2
// a responder e cada um só podia votar no outro. Por isso são precisos 4.
const MIN_PLAYERS_WITH_CUSTOM = 4;
const MAX_CUSTOM_TEXT = 120;
const MIN_CUSTOM_TEXT = 10;
const MAX_CUSTOM_UNIT = 20;
const MAX_PLAYERS = 12;
const DEFAULT_ROUNDS = 10;
const MIN_ROUNDS = 3;
const MAX_ROUNDS = 30;
const MAX_NAME_LENGTH = 16;
const MAX_TIME_SECONDS = 180;
const MIN_TIME_SECONDS = 10;
const HOST_GRACE_MS = 20_000;
// Revelação automática: ritmo base (o dos pontos, no fim); o dos palpites vem de
// public/reveal/pace.js, à escala deste valor.
const REVEAL_STEP_MS = 1500;
// Cada jogador recebe uma cor fixa (a primeira livre) e um boneco com uma cara ao calhas, que
// muda na sala de espera. A paleta e as peças do boneco são partilhadas com o cliente
// (public/reveal/character-options.js).
const PLAYER_COLORS = CharacterOptions.COLORS;
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

// Texto escrito por um jogador: sem caracteres de controlo, espaços normalizados, tamanho limitado.
// (O cliente mostra-o sempre como texto, nunca como HTML.)
function cleanText(raw, max) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanCustomQuestion(raw = {}) {
  const text = cleanText(raw.text, MAX_CUSTOM_TEXT);
  if (text.length < MIN_CUSTOM_TEXT) throw new GameError(`Escreve uma pergunta com pelo menos ${MIN_CUSTOM_TEXT} letras.`);
  const answer = raw.answer;
  if (typeof answer !== 'number' || !Number.isFinite(answer) || Math.abs(answer) > 1e12) {
    throw new GameError('A resposta tem de ser um número.');
  }
  const unit = cleanText(raw.unit, MAX_CUSTOM_UNIT);
  return unit ? { text, answer, unit } : { text, answer };
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

// Erro relativo de um palpite, para comparar perguntas com escalas muito diferentes:
// nos números, a distância a dividir pela resposta; nos mapas, os km a dividir por meia volta
// à Terra (20 000 km). Limitado a 10 para um disparate não pesar mais do que tudo o resto.
function relativeError(question, dist) {
  const scale = question.type === 'map' ? 20000 : Math.max(Math.abs(question.answer), 1);
  return Math.min(10, dist / scale);
}

function goodForTiebreak(q) {
  return q.type !== 'map' && (Math.abs(q.answer) >= 100 || !Number.isInteger(q.answer));
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
    this.settings = { rounds: DEFAULT_ROUNDS, answerTime: 0, voteTime: 0, categories: [], playerQuestions: false };
    this.customQuestions = new Map(); // id do autor -> pergunta escrita no lobby
    this.rulesVersion = 0; // sobe quando o anfitrião muda a configuração (aviso nos clientes)
    this.kicked = new Set(); // ids expulsos: não voltam a entrar com a sessão guardada
    this.stats = new Map(); // id -> estatísticas do jogo, para os prémios do fim
    this.phase = 'lobby'; // lobby | answering | voting | reveal | tiebreak | tiebreak-reveal | end
    this.round = 0;
    this.gameNumber = 0; // quantos jogos já começaram nesta sala
    this.questions = [];
    this.usedQuestions = new Set();
    this.themeDeck = new ThemeDeck(); // tema da revelação de cada pergunta de números
    this.lastRevealOrder = null; // ordem da revelação da ronda anterior (a seguinte é outra)
    this.current = null;
    this.standings = null; // classificação final: [{ ids, settled }], do 1.º lugar para baixo
    this.tiebreak = null;
    this.tiebreakCount = 0;
    this.tiebreakWinner = null; // quem ganhou o desempate do 1.º lugar
    this.timer = null;
    this.deadline = null;
    this.revealTimer = null;
    this.revealStepMs = REVEAL_STEP_MS;
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

    const used = [...this.players.values()];
    const color = PLAYER_COLORS.find((c) => !used.some((p) => p.color === c)) || PLAYER_COLORS[used.length % PLAYER_COLORS.length];
    const player = {
      id: crypto.randomUUID(), name, score: 0, connected: false, socketId: null, color,
      ready: false, // quem entra numa sala começa "não pronto"
      // Boneco: uma cara ao calhas (o cliente troca-a logo pelo boneco guardado, se houver) e
      // o resto por omissão.
      character: CharacterOptions.cleanCharacter(CharacterOptions.randomFace(() => crypto.randomInt(1e9) / 1e9)),
    };
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
      this.customQuestions.delete(playerId);
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
    const before = JSON.stringify(this.settings);
    if (settings.rounds !== undefined) this.settings.rounds = clampRounds(settings.rounds);
    if (settings.answerTime !== undefined) this.settings.answerTime = clampTime(settings.answerTime);
    if (settings.voteTime !== undefined) this.settings.voteTime = clampTime(settings.voteTime);
    if (settings.categories !== undefined) this.settings.categories = cleanCategories(settings.categories);
    if (settings.playerQuestions !== undefined) this.settings.playerQuestions = Boolean(settings.playerQuestions);
    // Regras novas: todos voltam a "não pronto" (ninguém começa sem as ver) e os clientes
    // mostram "O anfitrião mudou as regras" (rulesVersion sobe).
    if (JSON.stringify(this.settings) !== before) {
      this.resetReady();
      this.rulesVersion += 1;
    }
    this.touch();
  }

  // --- Pronto para começar -------------------------------------------------
  // Cada jogador (exceto o anfitrião, que conta sempre como pronto) diz que está pronto. O
  // jogo só começa com todos os jogadores LIGADOS prontos; os desligados não contam.

  isReady(p) {
    return p.id === this.hostId || Boolean(p.ready);
  }

  // Jogadores ligados que ainda não estão prontos (os que impedem o início).
  notReady() {
    return this.connectedPlayers().filter((p) => !this.isReady(p));
  }

  resetReady() {
    for (const p of this.players.values()) p.ready = false;
  }

  setReady(playerId, ready) {
    if (this.phase !== 'lobby') throw new GameError('Só podes ficar pronto na sala de espera.');
    const player = this.players.get(playerId);
    if (!player) throw new GameError('Não estás nesta sala.');
    if (playerId === this.hostId) throw new GameError('O anfitrião conta sempre como pronto: basta começar o jogo.');
    if (ready && this.settings.playerQuestions && !this.customQuestions.has(playerId)) {
      throw new GameError('Escreve primeiro a tua pergunta.');
    }
    player.ready = Boolean(ready);
    this.touch();
  }

  // O anfitrião tira um jogador da sala de espera (ex.: alguém que se ausentou e está a
  // bloquear o início). Quem foi expulso não volta a entrar com a sessão guardada; pode
  // entrar de novo com o código, como um jogador novo.
  kick(playerId, targetId) {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new GameError('Só podes expulsar jogadores na sala de espera.');
    if (targetId === playerId) throw new GameError('Não te podes expulsar a ti próprio.');
    const target = this.players.get(targetId);
    if (!target) throw new GameError('Esse jogador já não está na sala.');
    this.players.delete(targetId);
    this.customQuestions.delete(targetId);
    this.kicked.add(targetId);
    this.touch();
    return target;
  }

  // Boneco do jogador (cara, roupa, acessórios, festejo): só na sala de espera e só com peças
  // que existem. Combinações iguais são permitidas (a cara não tem de ser única).
  setCharacter(playerId, raw) {
    if (this.phase !== 'lobby') throw new GameError('Só podes mudar o boneco antes de começar.');
    const player = this.players.get(playerId);
    if (!player) throw new GameError('Não estás nesta sala.');
    const character = CharacterOptions.cleanCharacter(raw, player.character);
    if (!character) throw new GameError('Essa peça do boneco não existe.');
    player.character = character;
    this.touch();
  }

  minPlayers() {
    return this.settings.playerQuestions ? MIN_PLAYERS_WITH_CUSTOM : MIN_PLAYERS;
  }

  // Cada jogador escreve (ou reescreve) a sua pergunta na sala de espera.
  submitCustomQuestion(playerId, raw) {
    if (this.phase !== 'lobby') throw new GameError('Só podes escrever a pergunta antes de começar.');
    if (!this.settings.playerQuestions) throw new GameError('O anfitrião não ligou as perguntas dos jogadores.');
    if (!this.players.has(playerId)) throw new GameError('Não estás nesta sala.');
    this.customQuestions.set(playerId, { ...cleanCustomQuestion(raw), author: playerId });
    this.touch();
  }

  // Perguntas dos jogadores que entram no jogo (só com a opção ligada).
  activeCustomQuestions() {
    if (!this.settings.playerQuestions) return [];
    return [...this.customQuestions.values()].filter((q) => this.players.has(q.author));
  }

  // Perguntas do banco nas categorias escolhidas.
  questionPool() {
    const cats = this.settings.categories;
    return cats.length ? QUESTIONS.filter((q) => cats.includes(q.category)) : QUESTIONS;
  }

  // Quantas perguntas dos jogadores vão entrar: as já guardadas e as que faltam aos jogadores
  // ligados (o jogo só começa quando todos os ligados tiverem escrito a sua).
  customNeeded() {
    if (!this.settings.playerQuestions) return 0;
    const ids = new Set(this.activeCustomQuestions().map((q) => q.author));
    for (const p of this.connectedPlayers()) ids.add(p.id);
    return ids.size;
  }

  // Quantas perguntas o jogo vai mesmo ter: pelo menos uma por cada pergunta dos jogadores
  // (para saírem todas), e menos do que o pedido se as categorias não chegarem.
  plannedRounds() {
    const wanted = Math.min(MAX_ROUNDS, Math.max(this.settings.rounds, this.customNeeded()));
    return Math.min(wanted, this.questionPool().length + this.activeCustomQuestions().length);
  }

  // --- Fluxo do jogo -----------------------------------------------------

  startGame(playerId) {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new GameError('O jogo já começou.');
    const online = this.connectedPlayers();
    if (online.length < this.minPlayers()) {
      throw new GameError(this.settings.playerQuestions
        ? `Com perguntas dos jogadores são precisos pelo menos ${MIN_PLAYERS_WITH_CUSTOM} jogadores ligados.`
        : `São precisos pelo menos ${MIN_PLAYERS} jogadores ligados.`);
    }
    if (this.settings.playerQuestions) {
      const missing = online.filter((p) => !this.customQuestions.has(p.id)).map((p) => p.name);
      if (missing.length) throw new GameError(`Ainda falta a pergunta de: ${missing.join(', ')}.`);
    }
    const waiting = this.notReady().map((p) => p.name);
    if (waiting.length) {
      throw new GameError(waiting.length === 1
        ? `Falta 1 jogador ficar pronto: ${waiting[0]}.`
        : `Faltam ${waiting.length} jogadores ficarem prontos: ${waiting.join(', ')}.`);
    }
    for (const p of this.players.values()) p.score = 0;
    this.stats = new Map();
    this.questions = this.pickQuestions();
    this.round = 0;
    this.gameNumber += 1; // identifica o jogo (ex.: o cliente conta feitos uma vez por jogo)
    this.standings = null;
    this.tiebreak = null;
    this.tiebreakCount = 0;
    this.tiebreakWinner = null;
    this.nextRound();
  }

  // As perguntas dos jogadores entram todas (se couberem) e o banco completa o resto:
  // cerca de um quarto de mapa (se houver Geografia), o resto de números.
  pickQuestions() {
    const rounds = this.plannedRounds();
    const custom = shuffle(this.activeCustomQuestions()).slice(0, rounds);
    return shuffle([...custom, ...this.pickBank(rounds - custom.length)]);
  }

  pickBank(rounds) {
    if (rounds <= 0) return [];
    const pool = this.questionPool();
    const maps = pool.filter((q) => q.type === 'map');
    const numbers = pool.filter((q) => q.type !== 'map');
    const wantMaps = maps.length ? Math.max(1, Math.round(rounds * MAP_SHARE)) : 0;
    const numberCount = Math.min(numbers.length, rounds - Math.min(wantMaps, maps.length));
    return [...this.pickFrom(maps, rounds - numberCount), ...this.pickFrom(numbers, numberCount)];
  }

  // Evita repetir perguntas entre jogos na mesma sala, enquanto houver perguntas novas.
  pickFrom(pool, count) {
    let available = pool.filter((q) => !this.usedQuestions.has(q));
    if (available.length < count) {
      for (const q of pool) this.usedQuestions.delete(q);
      available = pool.filter((q) => !this.questions.includes(q));
      if (available.length < count) available = pool; // categoria pequena: pode repetir do jogo anterior
    }
    const picked = shuffle(available).slice(0, count);
    for (const q of picked) this.usedQuestions.add(q);
    return picked;
  }

  // Pergunta extra para desempate: só de números com resposta grande (≥ 100) ou com casas
  // decimais (anos, alturas, distâncias…), para não haver empates repetidos em respostas
  // pequenas e exatas. Das categorias escolhidas, se houver; senão de todo o banco.
  pickTiebreakQuestion() {
    const fromPool = this.questionPool().filter(goodForTiebreak);
    return this.pickFrom(fromPool.length ? fromPool : QUESTIONS.filter(goodForTiebreak), 1)[0];
  }

  nextRound() {
    this.round += 1;
    const question = this.questions[this.round - 1];
    this.current = {
      question,
      // O servidor escolhe o tema logo no início da ronda (igual para todos); as perguntas de
      // mapa têm a sua própria revelação.
      theme: question.type === 'map' ? null : this.themeDeck.next(),
      answers: new Map(),
      votes: new Map(),
      result: null,
    };
    this.setPhase('answering', this.settings.answerTime, () => this.endAnswering());
  }

  setPhase(phase, seconds = 0, onTimeout = null) {
    this.clearTimer();
    this.clearRevealTimer();
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
    if (question.author === playerId) throw new GameError('Esta pergunta é tua: não respondes, mas podes votar.');
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
    } else if (
      this.phase === 'answering' &&
      online.every((p) => this.current.answers.has(p.id) || p.id === this.current.question.author)
    ) {
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
    // Com menos de 3 respostas a votação não faz sentido (com 2, cada um só podia votar
    // no outro): revela logo, sem pontos de voto nesta ronda.
    if (this.current.answers.size < MIN_ANSWERS_TO_VOTE) {
      this.reveal();
      return;
    }
    this.current.voting = true;
    this.setPhase('voting', this.settings.voteTime, () => this.reveal());
    this.checkProgress();
  }

  reveal() {
    if (this.phase !== 'answering' && this.phase !== 'voting') return;
    const { question, answers, votes } = this.current;
    if (!this.current.voting) votes.clear();
    this.current.result = scoreRound(correctOf(question), answers, votes, measureFor(question));
    for (const [id, pts] of Object.entries(this.current.result.points)) {
      const player = this.players.get(id);
      if (player) player.score += pts;
    }
    this.recordStats(question, this.current.result, answers.size);
    this.current.order = this.revealOrder(question, this.current.result.distances);
    // Revelação em passos, automática: um palpite de cada vez (pela ordem de `order`), depois
    // a resposta certa, os votos (se houve votação) e por fim os pontos.
    // O anfitrião pode saltar para o fim. Sem respostas, vai direto ao fim da ronda.
    // Passos: um por palpite, a resposta certa e, no fim, os pontos (com os votos juntos).
    this.current.steps = answers.size + 2;
    this.current.step = answers.size === 0 ? this.current.steps : 1;
    this.setPhase('reveal');
    this.scheduleRevealStep();
  }

  // Ordem em que os palpites são revelados. Nas perguntas de números é ALEATÓRIA (escolhida
  // aqui, uma vez, e enviada no room:state: todos veem a mesma, e quem recarrega também), para
  // o último revelado não ser sempre o vencedor. Nunca repete a ordem da ronda anterior (com os
  // mesmos jogadores) nem é a antiga "do mais longe para o mais perto" (com 3 ou mais palpites).
  // Nas perguntas de mapa fica do mais longe para o mais perto.
  revealOrder(question, distances) {
    const ids = Object.keys(distances);
    const farToNear = [...ids].sort((a, b) => distances[b] - distances[a]);
    if (question.type === 'map') return farToNear;
    const shuffle = () => {
      const a = [...ids];
      for (let i = a.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    // Com distâncias iguais a ordem "do mais longe" não é única: compara as distâncias.
    const predictable = (a) => a.length >= 3 && a.every((id, i) => distances[id] === distances[farToNear[i]]);
    const repeated = (a) => a.length >= 2 && this.lastRevealOrder && a.join() === this.lastRevealOrder.join();
    let order = shuffle();
    for (let tries = 0; tries < 50 && (predictable(order) || repeated(order)); tries++) order = shuffle();
    this.lastRevealOrder = order;
    return order;
  }

  scheduleRevealStep() {
    this.clearRevealTimer();
    if (this.phase !== 'reveal' || this.current.step >= this.current.steps) return;
    // Ritmo comum (public/reveal/pace.js): os primeiros revelados depressa, os últimos 3
    // devagar, pausa antes do último, e nunca mais de ~12 s até à resposta certa. Os pontos
    // (último passo) mantêm o tempo normal.
    const guesses = this.current.answers.size;
    const pace = revealPace(guesses, this.revealStepMs / REVEAL_STEP_MS);
    const { step } = this.current;
    const delay = step < guesses ? pace.before[step] : step === guesses ? pace.answer : this.revealStepMs;
    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      if (this.phase !== 'reveal') return;
      this.current.step += 1;
      this.notify(this);
      this.scheduleRevealStep();
    }, delay);
    // Não segura o processo (testes, encerramento) só por causa da animação.
    if (this.revealTimer.unref) this.revealTimer.unref();
  }

  clearRevealTimer() {
    if (this.revealTimer) clearTimeout(this.revealTimer);
    this.revealTimer = null;
  }

  // --- Estatísticas e prémios ---------------------------------------------

  statsOf(id) {
    if (!this.stats.has(id)) this.stats.set(id, { closest: 0, farthest: 0, correctVotes: 0, errorSum: 0, answered: 0 });
    return this.stats.get(id);
  }

  recordStats(question, result, answerCount) {
    for (const [id, dist] of Object.entries(result.distances)) {
      const s = this.statsOf(id);
      s.answered += 1;
      s.errorSum += relativeError(question, dist);
    }
    for (const id of result.closest) this.statsOf(id).closest += 1;
    // Com uma só resposta, essa pessoa seria ao mesmo tempo a mais perto e a mais longe.
    if (answerCount >= 2) for (const id of result.farthest) this.statsOf(id).farthest += 1;
    for (const id of result.correctVoters) this.statsOf(id).correctVotes += 1;
  }

  // Prémios do fim do jogo; em empate ficam todos os empatados. Um prémio sem ninguém
  // que o mereça (ex.: ninguém acertou um voto) não aparece.
  awards() {
    const entries = [...this.stats.entries()].filter(([id]) => this.players.has(id));
    const meanError = (s) => (s.answered ? s.errorSum / s.answered : Infinity);
    const best = (value, { min = false } = {}) => {
      const scored = entries.map(([id, s]) => [id, value(s)]).filter(([, v]) => Number.isFinite(v) && (min || v > 0));
      if (!scored.length) return [];
      const target = min ? Math.min(...scored.map(([, v]) => v)) : Math.max(...scored.map(([, v]) => v));
      return scored.filter(([, v]) => v === target).map(([id]) => id);
    };

    // Mais certeiro: mais vezes o mais perto; em empate, o menor erro médio relativo.
    let sharp = best((s) => s.closest);
    if (sharp.length > 1) {
      const lowest = Math.min(...sharp.map((id) => meanError(this.stats.get(id))));
      sharp = sharp.filter((id) => meanError(this.stats.get(id)) === lowest);
    }
    if (!sharp.length) sharp = best(meanError, { min: true });

    const describe = (id) => {
      const s = this.stats.get(id);
      return { id, closest: s.closest, farthest: s.farthest, correctVotes: s.correctVotes, meanError: Number.isFinite(meanError(s)) ? Math.round(meanError(s) * 1000) / 1000 : null };
    };
    return [
      { id: 'sharp', winners: sharp.map(describe) },
      { id: 'far', winners: best((s) => s.farthest).map(describe) },
      { id: 'reader', winners: best((s) => s.correctVotes).map(describe) },
    ].filter((a) => a.winners.length);
  }

  // Os pedidos do anfitrião para avançar ou saltar levam a fase e a pergunta que ele estava a
  // ver. Se entretanto a fase mudou (ex.: o último jogador respondeu no mesmo instante e já se
  // passou à votação), o pedido é ignorado, para não saltar também a fase seguinte.
  // Sem `expected` (clientes antigos), aceita sempre.
  isStale(expected) {
    if (!expected || expected.phase === undefined) return false;
    const tb = this.phase === 'tiebreak' || this.phase === 'tiebreak-reveal' ? this.tiebreak.number : null;
    return expected.phase !== this.phase || expected.round !== this.round || (expected.tb ?? null) !== tb;
  }

  // O anfitrião salta a animação e mostra a revelação toda de uma vez.
  revealSkip(playerId, expected) {
    this.requireHost(playerId);
    if (this.isStale(expected)) return;
    if (this.phase !== 'reveal') throw new GameError('Não há nada para revelar agora.');
    this.clearRevealTimer();
    this.current.step = this.current.steps;
    this.touch();
  }

  forceAdvance(playerId, expected) {
    this.requireHost(playerId);
    if (this.isStale(expected)) return;
    if (this.phase === 'answering') this.endAnswering();
    else if (this.phase === 'voting') this.reveal();
    else if (this.phase === 'tiebreak') this.revealTiebreak();
    else throw new GameError('Não há nada para avançar agora.');
  }

  nextQuestion(playerId, expected) {
    this.requireHost(playerId);
    if (this.isStale(expected)) return; // ex.: dois cliques seguidos não saltam uma pergunta
    if (this.phase === 'tiebreak-reveal') return this.nextTiebreak();
    if (this.phase !== 'reveal') throw new GameError('Ainda não é altura de avançar.');
    if (this.round < this.questions.length) return this.nextRound();
    this.standings = this.buildStandings();
    this.nextTiebreak();
  }

  // --- Desempate do 1.º lugar no fim do jogo ----------------------------
  // Se houver empate no 1.º lugar, os empatados respondem a uma pergunta extra, sem
  // votação: quem fica mais perto ganha. Repete enquanto houver empate no 1.º lugar.
  // Os empates mais abaixo ficam como empate na classificação final.

  buildStandings() {
    const sorted = [...this.players.values()].sort((a, b) => b.score - a.score);
    const tiers = [];
    for (const p of sorted) {
      const last = tiers[tiers.length - 1];
      if (last && last.score === p.score) last.ids.push(p.id);
      else tiers.push({ score: p.score, ids: [p.id] });
    }
    return tiers.map((t, i) => ({ ids: t.ids, settled: i > 0 || t.ids.length === 1 }));
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
    // Só o grupo da frente pode continuar empatado (e ir a nova pergunta).
    const tiers = groups.map((ids, i) => ({ ids, settled: i > 0 || ids.length === 1 }));
    if (unanswered.length) tiers.push({ ids: unanswered, settled: true });
    if (groups.length && groups[0].length === 1) this.tiebreakWinner = groups[0][0];

    const index = this.standings.findIndex((t) => t.ids === tb.ids);
    this.standings.splice(index, 1, ...tiers);
    tb.result = { correct, answers: Object.fromEntries(tb.answers), distances, unanswered, curiosity: tb.question.curiosity || null };
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
    this.tiebreakWinner = null;
    this.customQuestions.clear(); // no jogo seguinte cada um escreve uma pergunta nova
    for (const p of this.players.values()) p.score = 0;
    this.resetReady(); // para o jogo seguinte, todos dizem outra vez que estão prontos
    // Quem saiu durante o jogo não fica a ocupar lugar na sala nova.
    for (const p of [...this.players.values()]) {
      if (!p.connected && p.id !== this.hostId) this.players.delete(p.id);
    }
    this.setPhase('lobby');
  }

  destroy() {
    this.clearTimer();
    this.clearRevealTimer();
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
      gameNumber: this.gameNumber,
      totalRounds: this.questions.length || this.settings.rounds,
      // Com perguntas dos jogadores, o mínimo sobe para caberem as de todos.
      minRounds: Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, this.customNeeded())),
      customNeeded: this.customNeeded(),
      maxRounds: Math.min(MAX_ROUNDS, QUESTIONS.length),
      tiebreakWinner: this.tiebreakWinner,
      minPlayers: this.minPlayers(),
      // Perguntas dos jogadores: só se diz quem já escreveu; o texto fica com o autor.
      customReady: [...this.customQuestions.keys()],
      myQuestion: this.phase === 'lobby' ? this.customQuestions.get(playerId) || null : null,
      maxPlayers: MAX_PLAYERS,
      rulesVersion: this.rulesVersion,
      settings: { ...this.settings },
      categories: CATEGORIES.map((c) => ({ ...c, count: CATEGORY_COUNTS[c.id] })),
      plannedRounds: this.plannedRounds(),
      remainingMs: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        connected: p.connected,
        ready: this.isReady(p), // o anfitrião conta sempre como pronto
        color: p.color,
        character: { ...p.character, scarf: [...p.character.scarf] }, // boneco completo, com a cara
      })),
    };

    if (cur && this.phase !== 'lobby') {
      state.question = {
        text: cur.question.text,
        unit: cur.question.unit || '',
        type: cur.question.type || 'number',
        category: CATEGORY_LABELS[cur.question.category] || '',
        author: cur.question.author || null,
        theme: cur.theme || null, // tema da revelação (null nas perguntas de mapa)
      };
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
          step: cur.step,
          steps: cur.steps,
          order: [...cur.order], // ordem da revelação dos palpites (igual para todos)
          voting: Boolean(cur.voting),
          curiosity: cur.question.curiosity || null,
          ...cur.result,
        };
      }
    }

    // No desempate o ecrã de resposta mostra a pergunta extra.
    const tb = this.tiebreak;
    if (tb && (this.phase === 'tiebreak' || this.phase === 'tiebreak-reveal')) {
      state.question = { text: tb.question.text, unit: tb.question.unit || '', type: 'number', category: CATEGORY_LABELS[tb.question.category] || '' };
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
    if (this.phase === 'end') state.awards = this.awards();
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
  QUESTIONS,
  CATEGORIES,
  goodForTiebreak,
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
