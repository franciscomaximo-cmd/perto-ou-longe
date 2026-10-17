'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { devPagesEnabled, devPagesGuard, devMapResult } = require('../server/devpages');

test('páginas de desenvolvimento: ligadas em desenvolvimento, desligadas em produção', () => {
  assert.equal(devPagesEnabled({}), true);
  assert.equal(devPagesEnabled({ NODE_ENV: 'development' }), true);
  assert.equal(devPagesEnabled({ NODE_ENV: 'production' }), false);
  assert.equal(devPagesEnabled({ RENDER: 'true' }), false, 'no Render, mesmo sem NODE_ENV');
  assert.equal(devPagesEnabled({ NODE_ENV: 'production', ENABLE_DEV_PAGES: '1' }), true);
});

test('páginas de desenvolvimento: em produção /dev/... dá 404 e o resto passa', () => {
  const run = (env, path) => {
    let status = null;
    let passed = false;
    const res = { status(code) { status = code; return { send() {} }; } };
    devPagesGuard(env)({ path }, res, () => { passed = true; });
    return { status, passed };
  };
  assert.deepEqual(run({ RENDER: 'true' }, '/dev/reveal.html'), { status: 404, passed: false });
  assert.deepEqual(run({ NODE_ENV: 'production' }, '/dev/'), { status: 404, passed: false });
  assert.deepEqual(run({ RENDER: 'true' }, '/index.html'), { status: null, passed: true });
  assert.deepEqual(run({ RENDER: 'true' }, '/developer.js'), { status: null, passed: true });
  assert.deepEqual(run({}, '/dev/reveal.html'), { status: null, passed: true });
});

test('pré-visualização: contas dos cenários de mapa com as do jogo (e erros nos pedidos inválidos)', () => {
  const call = (query) => {
    let status = 200;
    let body = null;
    const res = { status(code) { status = code; return this; }, json(data) { body = data; return this; } };
    devMapResult({ query }, res);
    return { status, body };
  };
  const russia = call({ country: '643', guesses: '48.86,2.35;66,-175' });
  assert.equal(russia.status, 200);
  assert.ok(russia.body.center.lon > 60 && russia.body.center.lon < 140, 'centro da Rússia na Sibéria');
  assert.equal(russia.body.distances[1], 0, 'Chukotka (a leste dos 180°) está na Rússia');
  assert.ok(russia.body.distances[0] > 500, 'Paris fica longe da Rússia');
  assert.equal(call({ country: '999', guesses: '0,0' }).status, 400);
  assert.equal(call({ country: '643', guesses: 'a,b' }).status, 400);
});

test('laboratório (/dev/lab/…): só em desenvolvimento; os palpites dos bots são válidos', () => {
  const run = (env, path) => {
    let status = null;
    const res = { status(code) { status = code; return { send() {} }; } };
    devPagesGuard(env)({ path }, res, () => {});
    return status;
  };
  assert.equal(run({ RENDER: 'true' }, '/dev/lab/rooms'), 404);
  assert.equal(run({ NODE_ENV: 'production' }, '/dev/lab/bots'), 404);
  assert.equal(run({}, '/dev/lab/rooms'), null);
  const { guessFor } = require('../server/devlab');
  const { QUESTIONS } = require('../server/rooms');
  for (const q of QUESTIONS) {
    for (let i = 0; i < 5; i++) {
      const g = guessFor(q);
      if (q.type === 'map') assert.ok(Math.abs(g.lat) <= 90 && Math.abs(g.lon) <= 180, `${q.text}: ${JSON.stringify(g)}`);
      else assert.ok(Number.isFinite(g), `${q.text}: ${g}`);
    }
  }
});