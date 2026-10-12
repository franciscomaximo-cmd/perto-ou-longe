'use strict';

// Lógica pura do jogo, sem dependências de rede, para ser fácil de testar.

// Arredonda as distâncias para evitar que erros de vírgula flutuante
// (ex.: 12.5 - 12.3 vs 12.3 - 12.1) desfaçam empates verdadeiros.
function distance(value, correct) {
  return Math.round(Math.abs(value - correct) * 1e6) / 1e6;
}

/**
 * Calcula o resultado de uma ronda.
 * @param {number} correct resposta certa
 * @param {Map<string, number>} answers id do jogador -> palpite
 * @param {Map<string, string>} votes id de quem votou -> id em quem votou
 */
function scoreRound(correct, answers, votes) {
  const distances = {};
  for (const [id, value] of answers) distances[id] = distance(value, correct);

  const ids = Object.keys(distances);
  if (ids.length === 0) {
    return { distances, closest: [], exact: [], farthest: [], correctVoters: [], points: {} };
  }

  const values = Object.values(distances);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const closest = ids.filter((id) => distances[id] === min);
  const farthest = ids.filter((id) => distances[id] === max);

  const points = {};
  const give = (id, n = 1) => { points[id] = (points[id] || 0) + n; };

  // Empate no mais perto: todos ganham. Quem acerta no número exato ganha 2 em vez de 1.
  const exact = min === 0 ? closest : [];
  closest.forEach((id) => give(id, min === 0 ? 2 : 1));

  // Empate no mais longe: votar em qualquer um dos empatados conta como acerto.
  const correctVoters = [];
  for (const [voter, target] of votes) {
    if (voter !== target && farthest.includes(target)) {
      correctVoters.push(voter);
      give(voter);
    }
  }

  return { distances, closest, exact, farthest, correctVoters, points };
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { scoreRound, shuffle, distance };
