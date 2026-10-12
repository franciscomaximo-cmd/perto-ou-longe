'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreRound } = require('../server/game');

const answers = (obj) => new Map(Object.entries(obj));
const votes = (obj) => new Map(Object.entries(obj));

test('mais perto ganha 1 ponto e quem acerta no mais longe ganha 1 ponto', () => {
  const r = scoreRound(206, answers({ ana: 200, rui: 150, eva: 300 }), votes({ ana: 'eva', rui: 'ana', eva: 'rui' }));
  assert.deepEqual(r.closest, ['ana']);
  assert.deepEqual(r.farthest, ['eva']);
  assert.deepEqual(r.correctVoters, ['ana']);
  assert.deepEqual(r.points, { ana: 2 });
});

test('empate no mais perto dá ponto a todos os empatados', () => {
  const r = scoreRound(100, answers({ ana: 90, rui: 110, eva: 500 }), votes({}));
  assert.deepEqual(r.closest.sort(), ['ana', 'rui']);
  assert.deepEqual(r.points, { ana: 1, rui: 1 });
});

test('empate no mais longe: votar em qualquer dos empatados conta', () => {
  const r = scoreRound(100, answers({ ana: 100, rui: 50, eva: 150 }), votes({ ana: 'rui', rui: 'eva', eva: 'ana' }));
  assert.deepEqual(r.farthest.sort(), ['eva', 'rui']);
  assert.deepEqual(r.correctVoters.sort(), ['ana', 'rui']);
  assert.deepEqual(r.points, { ana: 3, rui: 1 });
});

test('acertar no número exato dá 2 pontos, também em empate', () => {
  const r = scoreRound(206, answers({ ana: 206, rui: 206, eva: 300 }), votes({}));
  assert.deepEqual(r.exact.sort(), ['ana', 'rui']);
  assert.deepEqual(r.points, { ana: 2, rui: 2 });
});

test('quem fica mais perto sem acertar ganha só 1 ponto', () => {
  const r = scoreRound(206, answers({ ana: 205, eva: 300 }), votes({}));
  assert.deepEqual(r.exact, []);
  assert.deepEqual(r.points, { ana: 1 });
});

test('erros de vírgula flutuante não desfazem empates', () => {
  const r = scoreRound(12.3, answers({ ana: 12.1, rui: 12.5, eva: 20 }), votes({}));
  assert.deepEqual(r.closest.sort(), ['ana', 'rui']);
});

test('voto em si próprio nunca conta', () => {
  const r = scoreRound(10, answers({ ana: 10, rui: 99 }), votes({ rui: 'rui' }));
  assert.deepEqual(r.correctVoters, []);
});

test('sem respostas não há pontos', () => {
  const r = scoreRound(10, answers({}), votes({}));
  assert.deepEqual(r.points, {});
});
