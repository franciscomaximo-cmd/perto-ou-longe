'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { devPagesEnabled, devPagesGuard } = require('../server/devpages');

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
