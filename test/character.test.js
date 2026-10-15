'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanCharacter, randomCharacter, isUnlocked, COLORS, HATS, EXTRAS, PATTERNS, HAND_ITEMS, PETS, AURAS, WINS, LOSES,
  PHRASES, PANTS_COLORS, SHOE_COLORS, SCARF_COLORS, UNLOCKS, EMPTY_PROGRESS, DEFAULT_CHARACTER,
} = require('../public/reveal/character-options');
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
  assert.deepEqual(cleanCharacter({ extra: 'capa' }, { outfit: COLORS[2], hat: 'gorro', extra: 'nenhum' }), { ...DEFAULT_CHARACTER, outfit: COLORS[2], hat: 'gorro', extra: 'capa' });
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
  room.setCharacter(ana, { outfit: COLORS[5], hat: 'cowboy', extra: 'mochila', pet: 'gato', win: 'robo', phrase: 3 });
  const seen = room.stateFor(rui).players.find((p) => p.id === ana).character;
  assert.deepEqual(seen, { ...DEFAULT_CHARACTER, outfit: COLORS[5], hat: 'cowboy', extra: 'mochila', pet: 'gato', win: 'robo', phrase: 3 });
  assert.throws(() => room.setCharacter(ana, { number: 100 }), /não existe/);
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
  for (const id of ids) assert.deepEqual(room.players.get(id).character, { ...DEFAULT_CHARACTER, ...same });
  room.destroy();
});

test('boneco: peças novas validadas (padrão, número, calças, sapatilhas, mão, cachecol, animal, aura, festejo, frase)', () => {
  const full = {
    outfit: COLORS[3], pattern: 'futebol', number: 99, pants: PANTS_COLORS[1], shoes: SHOE_COLORS[2], hat: 'bone', extra: 'capa',
    hand: 'cachecol', scarf: [SCARF_COLORS[2], SCARF_COLORS[3]], pet: 'tartaruga', aura: 'arco-iris', win: 'siuuu', lose: 'cair', phrase: PHRASES.length - 1,
  };
  assert.deepEqual(cleanCharacter(full), full);
  for (const bad of [
    { pattern: 'bolinhas' }, { number: 0 }, { number: 100 }, { number: 7.5 }, { number: '7' }, { pants: '#123456' },
    { shoes: '#000001' }, { hand: 'espada' }, { scarf: [SCARF_COLORS[0]] },
    { scarf: [SCARF_COLORS[0], '#123456'] }, { pet: 'dragão' }, { aura: 'raios' }, { win: 'moonwalk' }, { lose: 'fugir' },
    { phrase: -1 }, { phrase: PHRASES.length }, { phrase: 'Olá' },
  ]) assert.equal(cleanCharacter(bad), null, JSON.stringify(bad));
  // Listas com as peças pedidas.
  assert.deepEqual(PATTERNS.map((p) => p.id), ['liso', 'riscas', 'xadrez', 'futebol']);
  assert.deepEqual(HAND_ITEMS.map((p) => p.id), ['nenhum', 'bandeira', 'cachecol', 'trofeu', 'guarda-chuva', 'balao']);
  assert.deepEqual(PETS.map((p) => p.id), ['nenhum', 'cao', 'gato', 'papagaio', 'tartaruga']);
  assert.deepEqual(AURAS.map((p) => p.id), ['nenhuma', 'estrelas', 'chamas', 'arco-iris', 'coracoes']);
  assert.deepEqual(WINS.map((p) => p.id).sort(), ['bracos', 'pular', 'robo', 'rodopiar', 'siuuu']);
  assert.deepEqual(LOSES.map((p) => p.id), ['chorar', 'ombros', 'cair']);
  assert.ok(PHRASES.length >= 8 && PHRASES.length <= 10 && PHRASES.every((f) => f.length <= 24));
});

test('boneco: escolhas antigas guardadas (só roupa, chapéu e extra) continuam a funcionar', () => {
  const old = { outfit: COLORS[4], hat: 'cowboy', extra: 'capa' };
  assert.deepEqual(cleanCharacter(old), { ...DEFAULT_CHARACTER, ...old }, 'o que falta fica com o valor por omissão');
  const { room, ids } = setup();
  room.setCharacter(ids[0], old);
  assert.equal(room.players.get(ids[0]).character.pattern, 'liso');
  assert.equal(room.players.get(ids[0]).character.win, DEFAULT_CHARACTER.win);
  room.destroy();
});

test('desbloqueáveis: coroa com 3 "em cheio", chamas com 5 vitórias, troféu ao ganhar com 6+', () => {
  assert.equal(isUnlocked('hat', 'coroa', EMPTY_PROGRESS), false);
  assert.equal(isUnlocked('hat', 'coroa', { ...EMPTY_PROGRESS, exact: 2 }), false);
  assert.equal(isUnlocked('hat', 'coroa', { ...EMPTY_PROGRESS, exact: 3 }), true);
  assert.equal(isUnlocked('aura', 'chamas', { ...EMPTY_PROGRESS, wins: 4 }), false);
  assert.equal(isUnlocked('aura', 'chamas', { ...EMPTY_PROGRESS, wins: 5 }), true);
  assert.equal(isUnlocked('hand', 'trofeu', { ...EMPTY_PROGRESS, bigWins: 1 }), true);
  assert.equal(isUnlocked('hat', 'bone', EMPTY_PROGRESS), true, 'peças sem regra estão sempre disponíveis');
  for (const u of UNLOCKS) assert.ok(u.how && u.need > 0 && u.stat in EMPTY_PROGRESS);
  // O aleatório só usa peças desbloqueadas.
  for (let i = 0; i < 300; i++) {
    const ch = randomCharacter(Math.random, EMPTY_PROGRESS);
    for (const u of UNLOCKS) assert.notEqual(ch[u.key], u.id, `${u.key}:${u.id} bloqueada saiu no aleatório`);
  }
  // O servidor não verifica desbloqueios (é só por diversão).
  const { room, ids } = setup();
  room.setCharacter(ids[0], { hat: 'coroa', aura: 'chamas', hand: 'trofeu' });
  assert.equal(room.players.get(ids[0]).character.hat, 'coroa');
  room.destroy();
});

test('a paleta das roupas é a mesma das cores dos jogadores', () => {
  const { room, ids } = setup();
  for (const id of ids) assert.ok(COLORS.includes(room.players.get(id).color));
  room.destroy();
});
