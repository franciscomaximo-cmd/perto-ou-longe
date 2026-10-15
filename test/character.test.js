'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanCharacter, randomCharacter, COLORS, HATS, EXTRAS, DEFAULT_CHARACTER } = require('../public/reveal/character-options');
const { Room } = require('../server/rooms');

function setup(names = ['Ana', 'Rui', 'Eva']) {
  const room = new Room('TEST', () => {});
  const ids = names.map((n, i) => {
    const p = room.addPlayer(n);
    room.connect(p.id, `s${i}`);
    return p.id;
  });
  return { room, ids };
}

test('boneco: só aceita peças que existem (e muda só o que vem no pedido)', () => {
  assert.deepEqual(cleanCharacter({ hat: 'coroa' }), { ...DEFAULT_CHARACTER, hat: 'coroa' });
  assert.deepEqual(cleanCharacter({ extra: 'capa' }, { outfit: COLORS[2], hat: 'gorro', extra: 'nenhum' }), { outfit: COLORS[2], hat: 'gorro', extra: 'capa' });
  assert.equal(cleanCharacter({ hat: 'chapéu-de-chuva' }), null);
  assert.equal(cleanCharacter({ extra: 'espada' }), null);
  assert.equal(cleanCharacter({ outfit: '#123456' }), null);
  assert.equal(cleanCharacter(null), null);
  assert.deepEqual(cleanCharacter({ outfit: null }), DEFAULT_CHARACTER, 'null = a cor do jogador');
  for (let i = 0; i < 50; i++) assert.ok(cleanCharacter(randomCharacter()), 'o aleatório dá sempre um boneco válido');
});

test('boneco no servidor: guardado, enviado no estado e só na sala de espera', () => {
  const { room, ids } = setup();
  const [ana, rui] = ids;
  assert.deepEqual(room.stateFor(rui).players.find((p) => p.id === ana).character, DEFAULT_CHARACTER);
  room.setCharacter(ana, { outfit: COLORS[5], hat: 'cowboy', extra: 'mochila' });
  const seen = room.stateFor(rui).players.find((p) => p.id === ana).character;
  assert.deepEqual(seen, { outfit: COLORS[5], hat: 'cowboy', extra: 'mochila' });
  assert.throws(() => room.setCharacter(ana, { hat: 'tiara' }), /não existe/);
  assert.deepEqual(room.players.get(ana).character.hat, 'cowboy', 'um pedido inválido não muda nada');
  room.startGame(ana);
  assert.throws(() => room.setCharacter(ana, { hat: 'coroa' }), /antes de começar/);
  room.destroy();
});

test('boneco: combinações iguais são permitidas (só o emoji é único)', () => {
  const { room, ids } = setup();
  const same = { outfit: COLORS[0], hat: HATS[3].id, extra: EXTRAS[1].id };
  for (const id of ids) room.setCharacter(id, same);
  for (const id of ids) assert.deepEqual(room.players.get(id).character, same);
  room.destroy();
});

test('a paleta das roupas é a mesma das cores dos jogadores', () => {
  const { room, ids } = setup();
  for (const id of ids) assert.ok(COLORS.includes(room.players.get(id).color));
  room.destroy();
});
