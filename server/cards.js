'use strict';

// Cartas ("truques de aluno"): o baralho, a pista da "Cábula" e o efeito das cartas nos pontos
// de uma ronda. Só lógica pura (sem salas nem rede), para ser fácil de testar; a validação de
// quem pode usar o quê está em rooms.js (Room.useCard).
//
// Ordem dos efeitos numa ronda (em Room.reveal):
//   1. pontos normais (scoreRound: mais perto 1, em cheio 2, votos certos 1);
//   2. ronda especial (rooms.js, applySpecial): "Pontos a dobrar" ×2, "Toda a turma ganha" +1,
//      "Último lugar ataca" (o ponto do mais perto muda de dono);
//   3. cartas (applyCards, abaixo), por esta ordem:
//      a) Aposta e Rouba ao primeiro trocam o ponto do "mais perto" de quem as usou;
//      b) Trabalho de grupo: +1 se o colega escolhido ficou mais perto;
//      c) Trabalho de casa feito: os pontos ganhos pelo jogador nesta ronda (tudo o que vem de
//         cima) contam a dobrar;
//      d) os roubos tiram ao líder (no máximo uma vez, mesmo com vários ladrões);
//      e) Atestado médico: quem o usou não fica com a ronda em negativo;
//      f) ninguém fica com a pontuação abaixo de 0.
//   Em "Pontos a dobrar" os pontos que as cartas dão ou roubam também contam a dobrar (o ponto
//   da aposta, o roubado, o do trabalho de grupo); as perdas da Aposta não.

const CARDS = ['aposta', 'rouba', 'cabula', 'copiar', 'tpc', 'atestado', 'tempo', 'grupo'];
const DUEL_EXCLUDED = ['copiar', 'grupo']; // com 2 jogadores não fazem sentido
const HAND_SIZE = 2;
const EXTRA_SECONDS = 15;
const BET_AMOUNTS = [1, 2, 3];

// Cartas que podem sair neste jogo. "Mais tempo" só com tempo limite para responder.
function deckFor({ duel = false, answerTime = 0 } = {}) {
  return CARDS.filter((c) => !(duel && DUEL_EXCLUDED.includes(c)) && !(c === 'tempo' && !(answerTime > 0)));
}

// Duas cartas diferentes ao acaso.
function dealHand(deck, randomInt) {
  const pool = [...deck];
  const hand = [];
  while (hand.length < HAND_SIZE && pool.length) hand.push(pool.splice(randomInt(pool.length), 1)[0]);
  return hand;
}

const tidy = (x) => Number(Number(x).toPrecision(12));

// Pista da "Cábula": no mapa, o continente; nos números, um intervalo largo (~60% da resposta;
// 80 anos nas perguntas "Em que ano…") que contém a resposta, que não fica sempre ao meio, e
// com limites "redondos".
function cabulaHint(question, continentOf, random = Math.random) {
  if (question.type === 'map') return { kind: 'continent', text: continentOf(question.country) || 'desconhecido' };
  const a = question.answer;
  const isYear = /^Em que ano\b/.test(question.text || '');
  let width = isYear ? 80 : Math.max(Math.abs(a) * 0.6, Number.isInteger(a) ? 4 : 0);
  if (!width) width = 4;
  const pos = 0.15 + 0.7 * random();
  const step = 10 ** Math.floor(Math.log10(width / 5));
  let min = tidy(Math.floor((a - width * pos) / step) * step);
  const max = tidy(Math.ceil((a + width * (1 - pos)) / step) * step);
  if (a >= 0 && min < 0) min = 0;
  return { kind: 'range', min, max };
}

/**
 * Efeito das cartas nos pontos de uma ronda.
 * @param {object} o
 *   points     pontos da ronda já com a ronda especial { id: n }
 *   closest    quem ficou mesmo mais perto; winners: quem ficou com o ponto do mais perto
 *              (igual a closest, exceto em "Último lugar ataca")
 *   farthest   quem ficou mais longe; distances { id: distância } (só quem respondeu)
 *   multiplier 2 em "Pontos a dobrar", senão 1
 *   scores     pauta ANTES desta ronda { id: pontos } (todos os jogadores)
 *   uses       { id: { type, amount, target } } (as cartas usadas nesta ronda)
 * @returns { points, outcomes } — outcomes: o que aconteceu a cada carta (para a revelação).
 */
function applyCards({ points, closest, winners = closest, farthest, distances, multiplier = 1, scores, uses }) {
  const pts = { ...points };
  const add = (id, n) => { pts[id] = (pts[id] || 0) + n; };
  const m = multiplier;
  const usesOf = (type) => Object.entries(uses).filter(([, u]) => u.type === type).map(([id, u]) => [id, u]);
  const protectedIds = usesOf('atestado').map(([id]) => id);
  const normalPoint = (id) => (distances[id] === 0 ? 2 : 1) * m; // o ponto do "mais perto", como foi dado
  const outcomes = {};

  // a) Aposta: em vez do ponto normal, a aposta (em cheio, +1); mais longe, perde-a.
  for (const [id, u] of usesOf('aposta')) {
    if (winners.includes(id)) {
      const gain = (u.amount + (distances[id] === 0 ? 1 : 0)) * m;
      add(id, gain - normalPoint(id));
      outcomes[id] = { result: 'won', amount: u.amount, points: gain };
    } else if (farthest.includes(id) && id in distances) {
      add(id, -u.amount);
      outcomes[id] = { result: 'lost', amount: u.amount, points: u.amount };
    } else {
      outcomes[id] = { result: 'none', amount: u.amount };
    }
  }

  // a) Rouba ao primeiro: em vez do ponto normal, rouba 1 ao líder (em cheio, +1 de bónus).
  const top = Math.max(...Object.values(scores));
  const leaders = Object.keys(scores).filter((id) => scores[id] === top);
  let victim = null;
  for (const [id] of usesOf('rouba')) {
    if (!winners.includes(id)) { outcomes[id] = { result: 'notClosest' }; continue; }
    if (leaders.includes(id)) { outcomes[id] = { result: 'leader' }; continue; }
    // O líder roubado: dos que não têm atestado, o que ficou mais longe nesta ronda.
    const open = leaders.filter((l) => !protectedIds.includes(l));
    if (!open.length) { outcomes[id] = { result: 'protected', victims: leaders }; continue; }
    if (!victim) victim = open.sort((x, y) => (distances[y] ?? Infinity) - (distances[x] ?? Infinity))[0];
    const gain = (1 + (distances[id] === 0 ? 1 : 0)) * m;
    add(id, gain - normalPoint(id));
    outcomes[id] = { result: 'stole', victim, points: gain, stolen: m };
  }

  // b) Trabalho de grupo: +1 se o colega escolhido ficou mais perto.
  for (const [id, u] of usesOf('grupo')) {
    const helped = u.target !== id && closest.includes(u.target);
    if (helped) add(id, m);
    outcomes[id] = { result: helped ? 'helped' : 'none', target: u.target, points: helped ? m : 0 };
  }

  // c) Trabalho de casa feito: os pontos ganhos nesta ronda contam a dobrar.
  for (const [id] of usesOf('tpc')) {
    const gained = Math.max(0, pts[id] || 0);
    if (gained) add(id, gained);
    outcomes[id] = { result: gained ? 'doubled' : 'none', points: gained * 2 };
  }

  // d) O roubo: o líder perde no máximo uma vez (o que se rouba numa ronda).
  if (victim) add(victim, -m);

  // e) Atestado médico: a ronda nunca fica em negativo (e o roubo já não lhe tocou).
  for (const [id] of usesOf('atestado')) {
    const saved = (pts[id] || 0) < 0;
    if (saved) pts[id] = 0;
    const targeted = usesOf('rouba').some(([t]) => outcomes[t].result === 'protected' && outcomes[t].victims.includes(id));
    outcomes[id] = { result: targeted ? 'blockedTheft' : saved ? 'saved' : 'none' };
  }

  // Cartas sem efeito nos pontos.
  for (const [id, u] of Object.entries(uses)) {
    if (!outcomes[id]) outcomes[id] = { result: 'used', target: u.target || null };
  }

  // f) Ninguém fica abaixo de 0.
  for (const id of Object.keys(pts)) {
    const floor = -(scores[id] || 0);
    if (pts[id] < floor) pts[id] = floor;
    if (!pts[id]) delete pts[id];
  }

  return {
    points: pts,
    outcomes: Object.entries(uses).map(([id, u]) => ({ id, type: u.type, ...outcomes[id] })),
  };
}

module.exports = { CARDS, DUEL_EXCLUDED, HAND_SIZE, EXTRA_SECONDS, BET_AMOUNTS, deckFor, dealHand, cabulaHint, applyCards };
