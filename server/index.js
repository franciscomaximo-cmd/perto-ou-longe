'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { GameError, createRoom, getRoom, deleteRoom, sweepIdleRooms } = require('./rooms');
const { devPagesGuard } = require('./devpages');

const PORT = process.env.PORT || 3000;

const app = express();
// /dev/... (pré-visualização das revelações) só fora de produção.
app.use(devPagesGuard());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (req, res) => res.send('ok'));
// Gerador de QR codes (MIT, sem dependências), servido daqui como o socket.io.js.
app.get('/vendor/qrcode.js', (req, res) => res.sendFile(require.resolve('qrcode-generator')));

const server = http.createServer(app);
const io = new Server(server);

// Cada jogador recebe a sua própria versão do estado (sem os segredos dos outros).
function broadcast(room) {
  for (const p of room.players.values()) {
    if (p.connected && p.socketId) io.to(p.socketId).emit('room:state', room.stateFor(p.id));
  }
}

// Regista um evento com resposta { ok, ... } ou { ok: false, error }.
function handle(socket, event, fn) {
  socket.on(event, (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      reply({ ok: true, ...(fn(payload || {}) || {}) });
    } catch (err) {
      if (!(err instanceof GameError)) console.error(`Erro em ${event}:`, err);
      reply({
        ok: false,
        error: err instanceof GameError ? err.message : 'Ocorreu um erro inesperado.',
        ...(err instanceof GameError && err.reason ? { reason: err.reason } : {}),
      });
    }
  });
}

io.on('connection', (socket) => {
  socket.data = {};

  // Devolve a sala e o jogador associados a este socket.
  function context() {
    const room = getRoom(socket.data.code);
    if (!room || !room.players.has(socket.data.playerId)) throw new GameError('Não estás em nenhuma sala.');
    return { room, playerId: socket.data.playerId };
  }

  // Liga este socket a um jogador, largando qualquer ligação anterior.
  function attach(room, player) {
    detach();
    room.connect(player.id, socket.id);
    socket.data = { code: room.code, playerId: player.id };
    broadcast(room);
    return { code: room.code, playerId: player.id, name: player.name };
  }

  function detach() {
    const room = getRoom(socket.data.code);
    if (room) {
      room.disconnect(socket.data.playerId, socket.id);
      broadcast(room);
    }
    socket.data = {};
  }

  handle(socket, 'room:create', ({ name }) => {
    const room = createRoom(broadcast);
    try {
      return attach(room, room.addPlayer(name));
    } catch (err) {
      deleteRoom(room.code);
      throw err;
    }
  });

  // Serve tanto para entrar pela primeira vez como para voltar (com o playerId guardado).
  handle(socket, 'room:join', ({ code, name, playerId }) => {
    const room = getRoom(code);
    if (!room) {
      // `reason` deixa o cliente distinguir "a sala já não existe" (ex.: o servidor reiniciou
      // e quem volta a ligar tinha lá um lugar) de outros erros.
      const err = new GameError('Sala não encontrada. Confirma o código.');
      err.reason = 'no-room';
      throw err;
    }
    // Quem foi expulso não volta a entrar com a sessão guardada (pode entrar com o código,
    // como jogador novo, que não manda playerId).
    if (playerId && room.kicked.has(playerId)) {
      const err = new GameError('Foste removido da sala pelo anfitrião.');
      err.reason = 'kicked';
      throw err;
    }
    const existing = playerId && room.players.get(playerId);
    return attach(room, existing || room.addPlayer(name));
  });

  // O anfitrião expulsa um jogador da sala de espera: o jogador expulso é avisado logo (volta
  // ao ecrã inicial) e o seu socket deixa de estar ligado à sala.
  handle(socket, 'player:kick', ({ playerId: targetId }) => {
    const { room, playerId } = context();
    const target = room.kick(playerId, targetId);
    const targetSocket = target.socketId && io.sockets.sockets.get(target.socketId);
    if (targetSocket) {
      targetSocket.data = {};
      targetSocket.emit('room:kicked', { code: room.code });
    }
    broadcast(room);
  });

  handle(socket, 'room:leave', () => {
    const { room, playerId } = context();
    room.leave(playerId);
    socket.data = {};
    if (room.players.size === 0) deleteRoom(room.code);
    else broadcast(room);
  });

  // Ações dentro da sala: executa e envia o novo estado a todos.
  const actions = {
    'settings:update': (room, id, p) => room.updateSettings(id, p),
    'game:start': (room, id) => room.startGame(id),
    'question:submit': (room, id, p) => room.submitCustomQuestion(id, p),
    'answer:submit': (room, id, p) => room.submitAnswer(id, p.value),
    'vote:submit': (room, id, p) => room.submitVote(id, p.targetId),
    // Estes três levam a fase e a pergunta esperadas: { phase, round, tb } (ver Room.isStale).
    'round:force': (room, id, p) => room.forceAdvance(id, p),
    'round:next': (room, id, p) => room.nextQuestion(id, p),
    'reveal:skip': (room, id, p) => room.revealSkip(id, p),
    'player:character': (room, id, p) => room.setCharacter(id, p),
    'player:ready': (room, id, p) => room.setReady(id, p.ready),
    'game:lobby': (room, id) => room.backToLobby(id),
  };
  for (const [event, action] of Object.entries(actions)) {
    handle(socket, event, (payload) => {
      const { room, playerId } = context();
      action(room, playerId, payload);
      broadcast(room);
    });
  }

  socket.on('disconnect', () => detach());
});

setInterval(sweepIdleRooms, 60_000).unref();

server.listen(PORT, () => {
  console.log(`Mais Coisa, Menos Coisa a correr em http://localhost:${PORT}`);
});
