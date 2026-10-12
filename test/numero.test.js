'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNumber } = require('../public/numero');

test('ponto seguido de 3 algarismos é separador de milhares', () => {
  assert.equal(parseNumber('1.200'), 1200);
  assert.equal(parseNumber('12.500'), 12500);
  assert.equal(parseNumber('1.200.000'), 1200000);
  assert.equal(parseNumber('-3.000'), -3000);
});

test('a vírgula é sempre decimal', () => {
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('1.200,75'), 1200.75);
  assert.equal(parseNumber('0,65'), 0.65);
  assert.equal(parseNumber('1,200'), 1.2);
});

test('ponto sem 3 algarismos a seguir é decimal', () => {
  assert.equal(parseNumber('12.5'), 12.5);
  assert.equal(parseNumber('2.44'), 2.44);
  assert.equal(parseNumber('0.650'), 0.65);
  assert.equal(parseNumber('1.20'), 1.2);
});

test('espaços e números simples', () => {
  assert.equal(parseNumber('1 200'), 1200);
  assert.equal(parseNumber(' 1 200 000 '), 1200000);
  assert.equal(parseNumber('42'), 42);
  assert.equal(parseNumber('99 999'), 99999);
});

test('o que não é número dá null', () => {
  for (const s of ['', '   ', 'abc', '12a', '1.2.3', '1,200.5', '1..2', '--5', null, undefined]) {
    assert.equal(parseNumber(s), null, String(s));
  }
});
