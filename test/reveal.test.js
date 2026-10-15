'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { precisionOf, relativeError } = require('../public/reveal/precision');
const { ThemeDeck, REVEAL_THEMES } = require('../server/themes');
const { Room } = require('../server/rooms');

// --- Precisão -----------------------------------------------------------------------------

test('precisão: palpite igual à resposta é 0 (em cheio)', () => {
  assert.equal(precisionOf(206, 206), 0);
  assert.equal(precisionOf(0, 0), 0);
  assert.equal(precisionOf(-5, -5), 0);
});

test('precisão: 100% de erro dá 1 e erros maiores dão mais de 1', () => {
  assert.equal(precisionOf(200, 100), 1);
  assert.equal(precisionOf(0, 100), 1);
  assert.ok(precisionOf(300, 100) > 1);
  assert.ok(precisionOf(1247, 10) > precisionOf(300, 100));
});

test('precisão: escala logarítmica, com 1%, 10% e 50% bem distintos', () => {
  const p1 = precisionOf(101, 100);
  const p10 = precisionOf(110, 100);
  const p50 = precisionOf(150, 100);
  assert.ok(p1 > 0 && p1 < p10 && p10 < p50 && p50 < 1);
  // Bem distintos: cada um pelo menos 0,2 acima do anterior.
  assert.ok(p10 - p1 > 0.2 && p50 - p10 > 0.2, `${p1} ${p10} ${p50}`);
  // Simétrica: falhar por cima ou por baixo dá o mesmo.
  assert.equal(precisionOf(90, 100), precisionOf(110, 100));
});

test('precisão: resposta 0 mede o erro em unidades (sem dividir por zero)', () => {
  assert.equal(relativeError(1, 0), 1);
  assert.equal(precisionOf(1, 0), 1);
  assert.ok(Number.isFinite(precisionOf(5, 0)) && precisionOf(5, 0) > 1);
  assert.ok(precisionOf(0.1, 0) < 1);
});

// --- Baralho de temas ---------------------------------------------------------------------

// Gerador aleatório com semente, para o teste ser repetível.
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

test('baralho: sai cada tema uma vez por baralho e nunca o mesmo duas vezes seguidas', () => {
  const themes = ['alvo', 'arco', 'bowling', 'karts', 'penalti'];
  for (const seed of [1, 2, 3, 42, 99]) {
    const deck = new ThemeDeck(themes, seeded(seed));
    const drawn = Array.from({ length: themes.length * 40 }, () => deck.next());
    for (let i = 1; i < drawn.length; i++) assert.notEqual(drawn[i], drawn[i - 1], `seguidos na posição ${i} (semente ${seed})`);
    for (let i = 0; i < drawn.length; i += themes.length) {
      assert.deepEqual([...drawn.slice(i, i + themes.length)].sort(), [...themes].sort(), 'cada baralho tem todos os temas');
    }
  }
});

test('baralho: com 2 temas alterna sempre; com 1 tema repete esse', () => {
  const two = new ThemeDeck(['a', 'b'], seeded(7));
  const drawn = Array.from({ length: 20 }, () => two.next());
  for (let i = 1; i < drawn.length; i++) assert.notEqual(drawn[i], drawn[i - 1]);
  const one = new ThemeDeck(['alvo']);
  assert.deepEqual([one.next(), one.next()], ['alvo', 'alvo']);
});

test('o tema é escolhido pelo servidor e é igual para todos os jogadores', () => {
  const room = new Room('TEST', () => {});
  const ids = ['Ana', 'Rui', 'Eva'].map((n, i) => {
    const p = room.addPlayer(n);
    room.connect(p.id, `s${i}`);
    return p.id;
  });
  room.themeDeck = new ThemeDeck(['a', 'b', 'c']);
  room.updateSettings(ids[0], { categories: ['historia'] }); // só perguntas de números
  room.startGame(ids[0]);
  const themes = ids.map((id) => room.stateFor(id).question.theme);
  assert.ok(['a', 'b', 'c'].includes(themes[0]));
  assert.deepEqual(themes, [themes[0], themes[0], themes[0]]);
  // Quem recarrega (novo pedido de estado) vê o mesmo tema.
  assert.equal(room.stateFor(ids[1]).question.theme, themes[0]);
  room.destroy();
});

test('perguntas de mapa não têm tema de revelação', () => {
  const room = new Room('TEST', () => {});
  const ids = ['Ana', 'Rui', 'Eva'].map((n, i) => {
    const p = room.addPlayer(n);
    room.connect(p.id, `s${i}`);
    return p.id;
  });
  room.updateSettings(ids[0], { categories: ['geografia'], rounds: 12 });
  room.startGame(ids[0]);
  let sawMap = false;
  for (let i = 0; i < 12; i++) {
    const q = room.stateFor(ids[0]).question;
    if (q.type === 'map') { sawMap = true; assert.equal(q.theme, null); } else assert.ok(REVEAL_THEMES.includes(q.theme));
    room.forceAdvance(ids[0]);
    room.revealSkip(ids[0]);
    if (room.phase === 'reveal' && room.round < room.questions.length) room.nextQuestion(ids[0]);
  }
  assert.ok(sawMap);
  room.destroy();
});

test('cada tema do servidor tem o seu ficheiro em public/reveal/ e está carregado no jogo', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  for (const id of REVEAL_THEMES) {
    const file = path.join(__dirname, '..', 'public', 'reveal', `${id}.js`);
    assert.ok(fs.existsSync(file), `falta public/reveal/${id}.js`);
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`register\\('${id}'`), `${id}.js não se regista`);
    assert.match(html, new RegExp(`reveal/${id}\\.js`), `index.html não carrega reveal/${id}.js`);
  }
});
