'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { hostRedirect } = require('../server/redirect');

const ENV = { REDIRECT_FROM_HOST: 'perto-ou-longe.onrender.com', REDIRECT_TO_URL: 'https://maiscoisamenoscoisa.onrender.com' };

// Servidor de teste com o middleware à frente; devolve { status, location, body }.
async function request(env, path, host) {
  const app = express();
  app.use(hostRedirect(env));
  app.get('/health', (req, res) => res.send('ok'));
  app.use((req, res) => res.send('jogo'));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    return await new Promise((resolve, reject) => {
      http.get({ port: server.address().port, path, headers: { host } }, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || null, body }));
      }).on('error', reject);
    });
  } finally {
    server.close();
  }
}

test('reencaminhamento: o endereço antigo dá 301 para o novo, com o mesmo caminho e parâmetros', async () => {
  const home = await request(ENV, '/?sala=ABCD', 'perto-ou-longe.onrender.com');
  assert.equal(home.status, 301);
  assert.equal(home.location, 'https://maiscoisamenoscoisa.onrender.com/?sala=ABCD');
  // Maiúsculas e porta no host não contam.
  const r = await request(ENV, '/dev/reveal.html?x=1', 'Perto-ou-Longe.onrender.com:443');
  assert.equal(r.status, 301);
  assert.equal(r.location, 'https://maiscoisamenoscoisa.onrender.com/dev/reveal.html?x=1');
});

test('reencaminhamento: não mexe no endereço novo, no /health nem em desenvolvimento', async () => {
  assert.deepEqual(await request(ENV, '/?sala=ABCD', 'maiscoisamenoscoisa.onrender.com'), { status: 200, location: null, body: 'jogo' });
  assert.deepEqual(await request(ENV, '/health', 'perto-ou-longe.onrender.com'), { status: 200, location: null, body: 'ok' });
  assert.deepEqual(await request({}, '/', 'perto-ou-longe.onrender.com'), { status: 200, location: null, body: 'jogo' }, 'sem variáveis, desligado');
  assert.deepEqual(await request(ENV, '/', 'localhost:3000'), { status: 200, location: null, body: 'jogo' });
  // Só uma das variáveis, ou um endereço inválido: desligado.
  assert.equal((await request({ REDIRECT_FROM_HOST: ENV.REDIRECT_FROM_HOST }, '/', 'perto-ou-longe.onrender.com')).status, 200);
  assert.equal((await request({ ...ENV, REDIRECT_TO_URL: 'maiscoisamenoscoisa' }, '/', 'perto-ou-longe.onrender.com')).status, 200);
  // Nunca reencaminha para si próprio.
  const self = { REDIRECT_FROM_HOST: 'maiscoisamenoscoisa.onrender.com', REDIRECT_TO_URL: 'https://maiscoisamenoscoisa.onrender.com' };
  assert.equal((await request(self, '/', 'maiscoisamenoscoisa.onrender.com')).status, 200);
});
