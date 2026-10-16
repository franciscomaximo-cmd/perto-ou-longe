'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanCharacter, randomCharacter, isUnlocked, COLORS, HATS, EXTRAS, PATTERNS, HAND_ITEMS, PETS, AURAS, WINS, LOSES,
  PHRASES, PANTS_COLORS, SHOE_COLORS, SCARF_COLORS, UNLOCKS, EMPTY_PROGRESS, DEFAULT_CHARACTER,
  SKINS, HAIR_COLORS, FACE_SHAPES, EYES, BROWS, MOUTHS, HAIRS, FACIAL, FACE_EXTRAS, DEFAULT_FACE, randomFace, upgradeCharacter,
} = require('../public/reveal/character-options');
const { seeded } = require('../public/reveal/seeded');
const seededRandom = (i) => seeded(`teste|${i}`);
const { Room } = require('../server/rooms');

// Todos os jogadores dizem que estão prontos e o anfitrião começa. (As regras do "pronto"
// têm os seus próprios testes, em rooms.test.js.)
function startGame(room, hostId) {
  for (const p of room.players.values()) p.ready = true;
  return room.startGame(hostId);
}


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
  const initial = room.players.get(ana).character;
  assert.deepEqual(room.stateFor(rui).players.find((p) => p.id === ana).character, initial);
  assert.deepEqual(cleanCharacter(initial), initial, 'a cara inicial (ao calhas) é válida');
  room.setCharacter(ana, { outfit: COLORS[5], hat: 'cowboy', extra: 'mochila', pet: 'gato', win: 'robo', phrase: 3 });
  const seen = room.stateFor(rui).players.find((p) => p.id === ana).character;
  assert.deepEqual(seen, { ...initial, outfit: COLORS[5], hat: 'cowboy', extra: 'mochila', pet: 'gato', win: 'robo', phrase: 3 });
  assert.throws(() => room.setCharacter(ana, { number: 100 }), /não existe/);
  assert.throws(() => room.setCharacter(ana, { hat: 'tiara' }), /não existe/);
  assert.deepEqual(room.players.get(ana).character.hat, 'cowboy', 'um pedido inválido não muda nada');
  startGame(room, ana);
  assert.throws(() => room.setCharacter(ana, { hat: 'coroa' }), /antes de começar/);
  room.destroy();
});

test('boneco: combinações iguais são permitidas (também a cara)', () => {
  const { room, ids } = setup();
  const same = { ...DEFAULT_FACE, outfit: COLORS[0], hat: HATS[3].id, extra: EXTRAS[1].id };
  for (const id of ids) room.setCharacter(id, same);
  for (const id of ids) assert.deepEqual(room.players.get(id).character, { ...DEFAULT_CHARACTER, ...same });
  room.destroy();
});

test('cara: peças validadas (pele, forma, olhos, sobrancelhas, boca, cabelo e cor, pelos, extras)', () => {
  assert.equal(SKINS.length, 8);
  assert.deepEqual(FACE_SHAPES.map((o) => o.id), ['redonda', 'oval', 'quadrada']);
  assert.equal(EYES.length, 6);
  assert.equal(BROWS.length, 4);
  assert.equal(MOUTHS.length, 6);
  assert.equal(HAIRS.length, 10);
  assert.equal(HAIR_COLORS.length, 10);
  assert.deepEqual(FACIAL.map((o) => o.id), ['nenhum', 'bigode', 'barba-curta', 'barba-comprida']);
  assert.deepEqual(FACE_EXTRAS.map((o) => o.id), ['nenhum', 'sardas', 'bochechas', 'oculos-redondos', 'oculos-quadrados', 'pala']);
  const face = { skin: SKINS[7], face: 'quadrada', eyes: 'piscar', brows: 'zangadas', mouth: 'lingua', hair: 'trancas', hairColor: HAIR_COLORS[8], facial: 'barba-comprida', faceExtra: 'pala' };
  assert.deepEqual(cleanCharacter(face), { ...DEFAULT_CHARACTER, ...face });
  for (const bad of [{ skin: '#123456' }, { face: 'triangular' }, { eyes: 'laser' }, { brows: 'nenhumas' }, { mouth: 'assobio' },
    { hair: 'afro-gigante' }, { hairColor: '#000000' }, { facial: 'patilhas' }, { faceExtra: 'monóculo' }]) {
    assert.equal(cleanCharacter(bad), null, JSON.stringify(bad));
  }
});

test('cara: o "Aleatório" dá caras variadas, válidas e sem combinações estranhas', () => {
  const faces = Array.from({ length: 400 }, (_, i) => randomFace(seededRandom(i)));
  for (const f of faces) {
    assert.ok(cleanCharacter(f), JSON.stringify(f));
    const bold = (f.eyes === 'estrelas') + (f.faceExtra === 'pala') + HAIR_COLORS.slice(6).includes(f.hairColor);
    assert.ok(bold <= 1, `mais de uma peça "marcada": ${JSON.stringify(f)}`);
    if (HAIR_COLORS.slice(6).includes(f.hairColor)) {
      assert.equal(f.facial, 'nenhum', 'barba só com cabelo de cor natural');
      assert.ok(!['careca', 'rapado'].includes(f.hair));
    }
  }
  // Variadas: todos os cabelos, peles e formas aparecem.
  for (const [key, list] of [['hair', HAIRS.map((h) => h.id)], ['skin', SKINS], ['face', FACE_SHAPES.map((s) => s.id)]]) {
    assert.deepEqual(new Set(faces.map((f) => f[key])).size, list.length, key);
  }
});

test('cara: escolhas antigas (com emoji) recebem uma cara gerada a partir delas, sem erros', () => {
  const old = { outfit: COLORS[4], hat: 'cowboy', extra: 'capa', emoji: '🦊' };
  const a = upgradeCharacter(old);
  assert.ok(a && a.skin && a.hair, 'tem cara');
  assert.equal(a.hat, 'cowboy');
  assert.equal(a.extra, 'capa');
  assert.equal(a.outfit, COLORS[4]);
  assert.equal('emoji' in a, false);
  assert.deepEqual(upgradeCharacter(old), a, 'sempre a mesma cara para as mesmas escolhas');
  // Escolhas antigas diferentes dão (quase sempre) caras diferentes.
  const faceKey = (c) => [c.skin, c.face, c.eyes, c.hair, c.hairColor].join();
  const variety = new Set(COLORS.map((c) => faceKey(upgradeCharacter({ ...old, outfit: c }))));
  assert.ok(variety.size >= 8, `só ${variety.size} caras diferentes em 12`);
  // Quem já tem cara fica com ela; lixo não rebenta.
  const withFace = { ...DEFAULT_CHARACTER, skin: SKINS[0], hair: 'moicano' };
  assert.deepEqual(upgradeCharacter(withFace), withFace);
  assert.equal(upgradeCharacter(null), null);
  assert.ok(upgradeCharacter({ hat: 'tiara', outfit: '#000' }), 'peças inválidas são ignoradas, não dão erro');
});

test('boneco: peças novas validadas (padrão, número, calças, sapatilhas, mão, cachecol, animal, aura, festejo, frase)', () => {
  const full = {
    outfit: COLORS[3], pattern: 'futebol', number: 99, pants: PANTS_COLORS[1], shoes: SHOE_COLORS[2], hat: 'bone', extra: 'capa',
    hand: 'cachecol', scarf: [SCARF_COLORS[2], SCARF_COLORS[3]], pet: 'tartaruga', aura: 'arco-iris', win: 'siuuu', lose: 'cair', phrase: PHRASES.length - 1,
  };
  assert.deepEqual(cleanCharacter(full), { ...DEFAULT_CHARACTER, ...full });
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
  assert.equal(isUnlocked('hat', 'coroa_dourada', EMPTY_PROGRESS), false);
  assert.equal(isUnlocked('hat', 'coroa_dourada', { ...EMPTY_PROGRESS, exact: 2 }), false);
  assert.equal(isUnlocked('hat', 'coroa_dourada', { ...EMPTY_PROGRESS, exact: 3 }), true);
  assert.equal(isUnlocked('hat', 'coroa', EMPTY_PROGRESS), true, 'a coroa de sempre continua livre');
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
  room.setCharacter(ids[0], { hat: 'coroa_dourada', aura: 'chamas', hand: 'trofeu' });
  assert.equal(room.players.get(ids[0]).character.hat, 'coroa_dourada');
  room.destroy();
});

test('a paleta das roupas é a mesma das cores dos jogadores', () => {
  const { room, ids } = setup();
  for (const id of ids) assert.ok(COLORS.includes(room.players.get(id).color));
  room.destroy();
});
