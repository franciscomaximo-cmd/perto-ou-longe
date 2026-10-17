'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { centerOf, distanceToCountry } = require('../server/geo');
const { checkQuestions } = require('../scripts/check-questions');

// Países que atravessam a longitude de 180°: no mapa o contorno salta de 180 para -180.

test('Rússia: o centro fica na Sibéria (não no Pacífico nem fora do mapa)', () => {
  const c = centerOf('643');
  assert.ok(c.lon >= -180 && c.lon <= 180, `longitude dentro do mapa: ${c.lon}`);
  assert.ok(c.lon > 60 && c.lon < 140, `longitude na Sibéria: ${c.lon}`);
  assert.ok(c.lat > 50 && c.lat < 75, `latitude na Sibéria: ${c.lat}`);
  assert.equal(distanceToCountry('643', c), 0, 'o centro fica dentro da Rússia');
});

test('Rússia: distâncias certas dos dois lados dos 180°', () => {
  assert.equal(distanceToCountry('643', { lat: 55.75, lon: 37.62 }), 0, 'Moscovo');
  assert.equal(distanceToCountry('643', { lat: 69.4, lon: 30.61 }), 0, 'Poço de Kola');
  assert.equal(distanceToCountry('643', { lat: 66, lon: -175 }), 0, 'Chukotka (do outro lado dos 180°)');
  assert.equal(distanceToCountry('643', { lat: 66, lon: 179 }), 0, 'Chukotka (antes dos 180°)');
  // Alasca: perto, mas fora (o estreito de Bering tem ~80 km; à escala do mapa, uns 270 km).
  const nome = distanceToCountry('643', { lat: 64.5, lon: -165.4 });
  assert.ok(nome > 0 && nome < 400, `Nome, no Alasca: ${nome} km`);
  const lisboa = distanceToCountry('643', { lat: 38.7, lon: -9.1 });
  assert.ok(lisboa > 2500 && lisboa < 3100, `Lisboa: ${lisboa} km`);
});

test('Fiji: o centro fica em Fiji e as ilhas do outro lado dos 180° contam como dentro', () => {
  const c = centerOf('242');
  assert.ok(c.lon > 176 && c.lon <= 180, `longitude em Fiji: ${c.lon}`);
  assert.ok(c.lat > -19 && c.lat < -15, `latitude em Fiji: ${c.lat}`);
  assert.equal(distanceToCountry('242', { lat: -18.14, lon: 178.44 }), 0, 'Suva');
  assert.equal(distanceToCountry('242', { lat: -16.2, lon: -179.9 }), 0, 'Vanua Levu, a leste dos 180°');
  const tonga = distanceToCountry('242', { lat: -21.1, lon: -175.2 });
  assert.ok(tonga > 500 && tonga < 900, `Tonga: ${tonga} km`);
  const sydney = distanceToCountry('242', { lat: -33.9, lon: 151.2 });
  assert.ok(sydney > 2800 && sydney < 3400, `Sydney: ${sydney} km`);
});

test('países normais continuam iguais', () => {
  assert.deepEqual(centerOf('250'), { lat: 46.61, lon: 2.34 }, 'França');
  assert.equal(distanceToCountry('586', { lat: 33.7, lon: 73 }), 0, 'Islamabad no Paquistão');
});

test('ponto de referência dos sítios concretos: usado na revelação e verificado no país', () => {
  const { Room, QUESTIONS } = require('../server/rooms');
  const kola = QUESTIONS.find((q) => q.type === 'map' && /Kola/.test(q.text || ''));
  assert.deepEqual(kola.point, { lat: 69.4, lon: 30.61 });
  const room = new Room('TEST', () => {});
  const ids = ['Ana', 'Rui', 'Eva'].map((n, i) => { const p = room.addPlayer(n); room.connect(p.id, `s${i}`); return p.id; });
  for (const p of room.players.values()) p.ready = true;
  room.startGame(ids[0]);
  room.current.question = kola;
  room.submitAnswer(ids[0], { lat: 55.75, lon: 37.62 });
  room.submitAnswer(ids[1], { lat: 66, lon: -175 });
  room.submitAnswer(ids[2], { lat: 38.7, lon: -9.1 });
  room.forceAdvance(ids[0]);
  const r = room.stateFor(ids[1]).result;
  assert.deepEqual(r.center, { lat: 69.4, lon: 30.61 }, 'o anel e as linhas vão ao Poço de Kola');
  assert.equal(r.distances[ids[0]], 0, 'a distância conta até ao país (Moscovo está na Rússia)');
  assert.equal(r.distances[ids[1]], 0, 'Chukotka também');
  room.destroy();
  // Um ponto fora do país é apanhado pela verificação das perguntas.
  const bad = { ...kola, point: { lat: 38.7, lon: -9.1 } };
  assert.match(checkQuestions([bad]).join('\n'), /ponto de referência fica a/);
});

test('Malta, Cabo Verde e São Tomé e Príncipe: estão no mapa (da escala 1:50m) e no sítio certo', () => {
  const cases = [
    ['470', { lat: 35.9, lon: 14.51 }, 'Valeta'],
    ['132', { lat: 14.93, lon: -23.51 }, 'Praia'],
    ['678', { lat: 0.34, lon: 6.73 }, 'São Tomé'],
  ];
  for (const [id, capital, name] of cases) {
    assert.ok(distanceToCountry(id, capital) <= 5, `${name} fica no país`);
    assert.equal(distanceToCountry(id, centerOf(id)), 0, `o centro de ${name} fica dentro do país`);
  }
  // Distâncias de Lisboa, com a ordem de grandeza certa.
  const lisboa = { lat: 38.72, lon: -9.14 };
  assert.ok(Math.abs(distanceToCountry('470', lisboa) - 2080) < 60, 'Lisboa → Malta ~2080 km');
  assert.ok(Math.abs(distanceToCountry('132', lisboa) - 2780) < 100, 'Lisboa → Cabo Verde ~2780 km');
  assert.ok(Math.abs(distanceToCountry('678', lisboa) - 4450) < 100, 'Lisboa → São Tomé ~4450 km');
});
