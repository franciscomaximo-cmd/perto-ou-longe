'use strict';

// Laboratório (SÓ em desenvolvimento): para experimentar o jogo a sério neste computador, sem
// publicar. A página dev/reveal.html junta jogadores-robô ("bots") a uma turma criada no jogo
// noutro separador; os bots ficam prontos, respondem, votam e, se se quiser, usam cartas,
// reagem na revelação e escrevem no chat. Também dá para escolher a próxima ronda especial e
// dar a um jogador as cartas que se quer testar.
//
// As rotas ficam em /dev/lab/, por isso em produção respondem 404 (devPagesGuard, em index.js,
// corre antes delas). Os bots usam os mesmos métodos da sala que os jogadores (Room), com as
// mesmas validações; nada disto muda as regras do jogo.

const express = require('express');
const { listRooms, getRoom, MAX_PLAYERS, SPECIAL_TYPES, SPECIAL_INTRO_MS, DARK_MS, REACTIONS } = require('./rooms');
const Cards = require('./cards');
const { centerOf } = require('./geo');

const BOT_NAMES = ['Bot Beatriz', 'Bot Duarte', 'Bot Inês', 'Bot Tomás', 'Bot Leonor', 'Bot Afonso',
  'Bot Matilde', 'Bot Gonçalo', 'Bot Carolina', 'Bot Rodrigo', 'Bot Mariana', 'Bot Vicente'];
// Frases curtas dos bots no chat: umas para a sala de espera, outras para o fim do jogo.
const CHAT_LINES = {
  lobby: ['Boa sorte a todos!', 'Esta vai ser fácil…', 'Quem perder paga os lanches 😄', 'Já estou pronto!',
    'Hoje ganho eu 💪', 'Alguém sabe a capital da Mongólia?', 'Não vale copiar 👀', 'Estou com sorte hoje 🍀',
    'Vamos lá, turma!', 'Espero que saiam perguntas de mapa 🗺️', 'Trouxe a cábula 📝', 'Quem é o favorito?',
    'Já fiz o trabalho de casa 📚', 'Bora começar!', 'Tenho um bom pressentimento', 'Hoje não vou ficar em último 🐢',
    'Olá a todos! 👋', 'Quanto tempo temos para responder?', 'Prometo não chutar números ao calhas', 'Atenção às rondas especiais!'],
  end: ['Bem jogado!', 'Para a próxima ganho eu!', 'Que pergunta difícil aquela!', 'Foi por pouco 😅',
    'Parabéns ao vencedor! 🏆', 'Mais uma?', 'Não acredito que falhei aquela', 'Aquela do mapa foi difícil 🗺️',
    'Boa jogada a todos', 'Fiquei tão perto!', 'Revanche? ⚔️', 'Gostei das rondas especiais',
    'Para a próxima trago a cábula 📝', 'Que sorte! 🍀', 'Já estava a ver que não', 'Bom jogo, turma! 👏'],
};
// Uma frase ao acaso, sem repetir a última que se disse nesta turma.
function chatLine(lab, phase) {
  const list = CHAT_LINES[phase === 'end' ? 'end' : 'lobby'].filter((line) => line !== lab.lastLine);
  lab.lastLine = list[Math.floor(Math.random() * list.length)];
  return lab.lastLine;
}
const TICK_MS = 400;

const rand = () => Math.random();
const randInt = (n) => Math.floor(Math.random() * n);
const pick = (list) => list[randInt(list.length)];

// Um palpite plausível: perto da resposta, mas raramente em cheio.
function guessFor(question) {
  if (question.type === 'map') {
    const c = question.point || centerOf(question.country) || { lat: 0, lon: 0 };
    const lat = Math.max(-55, Math.min(80, c.lat + (rand() - 0.5) * 30));
    let lon = c.lon + (rand() - 0.5) * 50;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;
    return { lat, lon };
  }
  const a = question.answer;
  const year = /^Em que ano/.test(question.text || '');
  const v = year ? a + Math.round((rand() - 0.5) * 80) : a * (0.5 + rand());
  return Number.isInteger(a) ? Math.round(v) : Number(v.toFixed(2));
}

function createLab({ broadcast, emitReaction }) {
  const labs = new Map(); // código da sala -> { bots: Set, options, timer, plans, forcedSpecial, cardOverrides, nextChat }

  const isBot = (lab, id) => Boolean(lab && lab.bots.has(id));

  // A sala passa a ter "laboratório": a ronda especial forçada e as cartas escolhidas entram
  // pelos próprios métodos da sala (uma vez por sala).
  function labFor(room) {
    let lab = labs.get(room.code);
    if (lab) return lab;
    lab = { bots: new Set(), options: { cards: true, reactions: true, chat: true }, timer: null, plans: new Map(), forcedSpecial: null, cardOverrides: new Map(), nextChat: 0 };
    labs.set(room.code, lab);
    const pickSpecial = room.pickSpecial.bind(room);
    room.pickSpecial = (now = Date.now()) => {
      if (!lab.forcedSpecial) return pickSpecial(now);
      const type = lab.forcedSpecial;
      lab.forcedSpecial = null;
      room.lastSpecialType = type;
      const introUntil = now + SPECIAL_INTRO_MS;
      return { type, introUntil, textUntil: type === 'escuras' ? introUntil + DARK_MS : null };
    };
    const dealCards = room.dealCards.bind(room);
    room.dealCards = () => {
      dealCards();
      for (const [id, types] of lab.cardOverrides) {
        if (room.players.has(id) && room.settings.cards) room.hands.set(id, types.map((type) => ({ type, used: false })));
      }
    };
    lab.timer = setInterval(() => tick(room.code), TICK_MS);
    lab.timer.unref();
    return lab;
  }

  function stop(code) {
    const lab = labs.get(code);
    if (lab) clearInterval(lab.timer);
    labs.delete(code);
  }

  // Quando é a vez de um bot fazer alguma coisa (um atraso ao acaso, para parecer gente).
  function due(lab, key, now, min, max) {
    if (!lab.plans.has(key)) lab.plans.set(key, now + min + rand() * (max - min));
    return now >= lab.plans.get(key);
  }

  // Um bot usa uma carta (se tiver e lhe apetecer), com escolhas válidas.
  function maybeUseCard(room, lab, id) {
    if (!lab.options.cards || !room.settings.cards || rand() < 0.4) return false;
    const hand = room.hands.get(id) || [];
    const cur = room.current;
    for (const c of hand.filter((x) => !x.used).sort(() => rand() - 0.5)) {
      const payload = { card: c.type };
      if (c.type === 'aposta') payload.amount = 1 + randInt(3);
      if (c.type === 'copiar') {
        const done = [...cur.answers.keys()].filter((x) => x !== id);
        if (!done.length) continue;
        payload.target = pick(done);
      }
      if (c.type === 'grupo') {
        const others = [...room.players.keys()].filter((x) => x !== id && x !== cur.question.author);
        if (!others.length) continue;
        payload.target = pick(others);
      }
      if (c.type === 'tempo' && !cur.baseDeadline) continue;
      try {
        room.useCard(id, payload);
        return true;
      } catch { /* (ex.: a carta não serve agora) tenta outra */ }
    }
    return false;
  }

  // O que um bot faz agora. Devolve true se mudou alguma coisa (para mandar o estado a todos).
  function act(room, lab, id, now) {
    const phase = room.phase;
    const me = room.players.get(id);
    if (phase === 'lobby') {
      let changed = false;
      if (room.settings.playerQuestions && !room.customQuestions.has(id)) {
        room.submitCustomQuestion(id, { text: `Quantos anos tem o ${me.name}?`, answer: 8 + randInt(60), unit: 'anos' });
        changed = true;
      }
      if (id !== room.hostId && !me.ready && due(lab, `ready-${id}-${room.rulesVersion}`, now, 600, 2000)) {
        room.setReady(id, true);
        changed = true;
      }
      return changed;
    }
    if (phase === 'answering' || phase === 'tiebreak') {
      const tb = phase === 'tiebreak' ? room.tiebreak : null;
      const { answers, question } = tb || room.current;
      if (answers.has(id) || question.author === id || (tb && !tb.ids.includes(id))) return false;
      const key = `answer-${id}-${room.gameNumber}-${room.round}-${tb ? tb.number : 0}`;
      if (!due(lab, key, now, 1500, 6000)) return false;
      if (phase === 'answering') maybeUseCard(room, lab, id);
      room.submitAnswer(id, guessFor(question));
      return true;
    }
    if (phase === 'voting') {
      const cur = room.current;
      const candidates = room.candidatesFor(id);
      if (cur.votes.has(id) || !candidates.length) return false;
      if (!due(lab, `vote-${id}-${room.gameNumber}-${room.round}`, now, 1000, 4000)) return false;
      room.submitVote(id, pick(candidates));
      return true;
    }
    if ((phase === 'reveal' || phase === 'tiebreak-reveal') && lab.options.reactions && rand() < 0.08) {
      const reaction = room.react(id, pick(REACTIONS), now);
      if (reaction) emitReaction(room, reaction);
    }
    return false;
  }

  function tick(code) {
    const room = getRoom(code);
    const lab = labs.get(code);
    if (!room || !lab) { stop(code); return; }
    const now = Date.now();
    let changed = false;
    for (const id of [...lab.bots]) {
      if (!room.players.has(id)) { lab.bots.delete(id); continue; }
      try {
        if (act(room, lab, id, now)) changed = true;
      } catch { /* um pedido recusado (como a um jogador): tenta na próxima volta */ }
    }
    // Chat: de vez em quando, um bot escreve (na sala de espera e no fim).
    if (lab.options.chat && lab.bots.size && (room.phase === 'lobby' || room.phase === 'end') && now >= lab.nextChat) {
      if (lab.nextChat) {
        try { room.chatSend(pick([...lab.bots]), chatLine(lab, room.phase), now); changed = true; } catch { /* ex.: silenciado */ }
      }
      lab.nextChat = now + 7000 + rand() * 8000;
    }
    if (changed) broadcast(room);
  }

  // --- Rotas ------------------------------------------------------------------------------
  const router = express.Router();
  router.use(express.json());
  const fail = (res, error) => res.status(400).json({ error });
  const roomOf = (req, res) => {
    const room = getRoom(String((req.body && req.body.code) || req.query.code || '').toUpperCase());
    if (!room) fail(res, 'Essa turma já não existe.');
    return room;
  };

  // As turmas abertas, com os jogadores (quem é bot, as cartas de cada um) e o laboratório.
  router.get('/rooms', (req, res) => {
    res.json(listRooms().map((room) => {
      const lab = labs.get(room.code);
      return {
        code: room.code,
        phase: room.phase,
        round: room.round,
        total: room.questions.length || room.settings.rounds,
        mode: room.settings.mode,
        specialRounds: room.settings.specialRounds,
        cards: room.settings.cards,
        special: room.current && room.current.special && ['answering', 'voting', 'reveal'].includes(room.phase) ? room.current.special.type : null,
        // (Só no laboratório: a resposta certa da pergunta atual, para testar o "em cheio".)
        answer: (() => {
          const q = room.phase === 'tiebreak' && room.tiebreak ? room.tiebreak.question : room.current && room.current.question;
          if (!q || room.phase === 'lobby') return null;
          return q.type === 'map' ? `${q.label} (toca dentro do país)` : `${q.answer}${q.unit ? ` ${q.unit}` : ''}`;
        })(),
        forcedSpecial: lab ? lab.forcedSpecial : null,
        options: lab ? lab.options : null,
        players: [...room.players.values()].map((p) => ({
          id: p.id, name: p.name, score: p.score, connected: p.connected,
          host: p.id === room.hostId, bot: isBot(lab, p.id),
          hand: (room.hands.get(p.id) || []).map((c) => `${c.type}${c.used ? '*' : ''}`),
          override: lab && lab.cardOverrides.get(p.id) ? lab.cardOverrides.get(p.id) : null,
        })),
      };
    }));
  });

  // Junta bots à turma (só na sala de espera, como qualquer jogador).
  router.post('/bots', (req, res) => {
    const room = roomOf(req, res);
    if (!room) return;
    if (room.phase !== 'lobby') return fail(res, 'Só se juntam bots na sala de espera.');
    const want = Math.max(1, Math.min(MAX_PLAYERS, Number(req.body.count) || 1));
    const lab = labFor(room);
    const taken = new Set([...room.players.values()].map((p) => p.name));
    let added = 0;
    for (const name of BOT_NAMES) {
      if (added >= want || room.players.size >= MAX_PLAYERS) break;
      if (taken.has(name)) continue;
      const p = room.addPlayer(name);
      room.connect(p.id, `lab-bot-${p.id}`);
      lab.bots.add(p.id);
      added += 1;
    }
    broadcast(room);
    res.json({ added });
  });

  // Tira os bots (na sala de espera saem; a meio do jogo ficam desligados, como quem sai).
  router.post('/remove-bots', (req, res) => {
    const room = roomOf(req, res);
    if (!room) return;
    const lab = labs.get(room.code);
    const ids = lab ? [...lab.bots] : [];
    for (const id of ids) room.leave(id);
    if (lab) lab.bots.clear();
    broadcast(room);
    res.json({ removed: ids.length });
  });

  // O que os bots fazem: usar cartas, reagir, escrever no chat.
  router.post('/options', (req, res) => {
    const room = roomOf(req, res);
    if (!room) return;
    const lab = labFor(room);
    for (const k of ['cards', 'reactions', 'chat']) if (typeof req.body[k] === 'boolean') lab.options[k] = req.body[k];
    res.json(lab.options);
  });

  // A próxima ronda que começar é desta ronda especial (null: volta ao sorteio normal).
  router.post('/special', (req, res) => {
    const room = roomOf(req, res);
    if (!room) return;
    const type = req.body.type || null;
    if (type && !SPECIAL_TYPES.includes(type)) return fail(res, `ronda especial desconhecida: ${type}`);
    labFor(room).forcedSpecial = type;
    res.json({ forcedSpecial: type });
  });

  // Muda os pontos de um jogador (para testar, por exemplo, "Último lugar ataca" ou o "Rouba
  // ao primeiro" sem a pauta toda empatada).
  router.post('/score', (req, res) => {
    const room = roomOf(req, res);
    if (!room) return;
    const p = room.players.get(req.body.playerId);
    const score = Math.round(Number(req.body.score));
    if (!p) return fail(res, 'Esse jogador já não está na turma.');
    if (!Number.isFinite(score) || score < 0 || score > 999) return fail(res, 'Pontos entre 0 e 999.');
    if (room.phase === 'lobby') return fail(res, 'Muda os pontos depois de começar o jogo.');
    p.score = score;
    broadcast(room);
    res.json({ name: p.name, score });
  });

  // Dá a um jogador estas cartas (já, se o jogo estiver a decorrer, e em cada jogo novo).
  router.post('/cards', (req, res) => {
    const room = roomOf(req, res);
    if (!room) return;
    const { playerId } = req.body;
    const cards = [...new Set([].concat(req.body.cards || []))];
    if (!room.players.has(playerId)) return fail(res, 'Esse jogador já não está na turma.');
    if (!cards.length || cards.length > Cards.HAND_SIZE || cards.some((c) => !Cards.CARDS.includes(c))) {
      return fail(res, `Escolhe 1 ou ${Cards.HAND_SIZE} cartas.`);
    }
    const lab = labFor(room);
    lab.cardOverrides.set(playerId, cards);
    if (room.phase !== 'lobby' && room.settings.cards) room.hands.set(playerId, cards.map((type) => ({ type, used: false })));
    broadcast(room);
    res.json({ ok: true, now: room.phase !== 'lobby', cardsOn: room.settings.cards });
  });

  return router;
}

module.exports = { createLab, guessFor, chatLine, CHAT_LINES };
