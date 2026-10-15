'use strict';

// "Posição de apresentação" de cada jogador numa ronda: o que os temas usam para decidir quão
// bom parece o resultado de cada um (usado no browser e nos testes). É RELATIVA à ronda: numa
// pergunta difícil em que todos falham por muito, quem ganhou continua a ter o melhor resultado
// do tema (centro do alvo, strike, primeiro a cortar a meta, golo no ângulo).
//
// Entrada: os jogadores com a sua precisão (precision.js) e o resultado que o SERVIDOR já
// calculou: { closest, farthest, exact } (listas de ids). Nada disto é recalculado aqui.
//
// Saída, por jogador: { level, winner, exact, farthest, miss }
//   - level: 0 = melhor resultado do tema … 1 = pior;
//   - winner: ganhou o ponto de "mais perto" → level 0, e NUNCA falha visualmente;
//   - exact: acertou "em cheio" (destaque extra, para se distinguir de "ganhou mas falhou");
//   - farthest: o "mais longe" → level 1 e sempre o pior resultado do tema (falha clara);
//   - miss: falha clara (o "mais longe" e quem errou mais de 100%), exceto o vencedor.
// Os restantes ficam entre 0,15 e 0,85, pela ordem dos palpites (metade do peso) e afinados pela
// precisão (a outra metade), por isso nunca à frente do vencedor nem atrás do "mais longe".
// Palpites iguais (mesma precisão) dão exatamente o mesmo resultado.
(function (root) {
  const MIDDLE_MIN = 0.15;
  const MIDDLE_MAX = 0.85;

  function presentationOf(players, result) {
    const closest = new Set(result.closest || []);
    const farthest = new Set(result.farthest || []);
    const exact = new Set(result.exact || []);
    const out = {};

    const middle = players.filter((p) => !closest.has(p.id) && !farthest.has(p.id));
    // Grupos de palpites iguais (mesma precisão), do melhor para o pior.
    const groups = [];
    for (const p of [...middle].sort((a, b) => a.precision - b.precision)) {
      const last = groups[groups.length - 1];
      if (last && last[0].precision === p.precision) last.push(p);
      else groups.push([p]);
    }
    const winnerP = Math.min(...players.filter((p) => closest.has(p.id)).map((p) => p.precision), Infinity);
    const loserP = Math.max(...players.filter((p) => farthest.has(p.id) && !closest.has(p.id)).map((p) => p.precision), -Infinity);
    const span = Number.isFinite(winnerP) && Number.isFinite(loserP) && loserP > winnerP ? loserP - winnerP : 0;

    groups.forEach((group, g) => {
      const byRank = (g + 1) / (groups.length + 1);
      const byPrecision = span ? Math.min(1, Math.max(0, (group[0].precision - winnerP) / span)) : byRank;
      const level = MIDDLE_MIN + (MIDDLE_MAX - MIDDLE_MIN) * (0.5 * byRank + 0.5 * byPrecision);
      for (const p of group) out[p.id] = { level, winner: false, exact: false, farthest: false, miss: p.precision > 1 };
    });

    for (const p of players) {
      if (closest.has(p.id)) out[p.id] = { level: 0, winner: true, exact: exact.has(p.id), farthest: false, miss: false };
      else if (farthest.has(p.id)) out[p.id] = { level: 1, winner: false, exact: false, farthest: true, miss: true };
      else if (!out[p.id]) out[p.id] = { level: 0.5, winner: false, exact: false, farthest: false, miss: p.precision > 1 };
    }
    return out;
  }

  const api = { presentationOf, MIDDLE_MIN, MIDDLE_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RevealPresentation = api;
})(typeof window !== 'undefined' ? window : globalThis);
