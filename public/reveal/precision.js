'use strict';

// Precisão de um palpite: o cálculo comum a todos os temas de revelação (usado no browser e
// nos testes). Cada tema transforma a precisão no seu desenho (distância ao centro do alvo,
// pinos derrubados, posição na pista…), mas a conta é sempre esta.
//
// - erro relativo = |palpite − resposta| / |resposta|. Se a resposta for 0, divide-se por 1:
//   o erro passa a ser a diferença em unidades (palpite 0,5 → 50%; palpite 3 → 300%).
// - precisão = 0 para "em cheio", 1 para um erro de 100% e acima de 1 para erros maiores.
//   Entre 0 e 1 a escala é logarítmica, para 1%, 10% e 50% ficarem bem distintos:
//   0,1% → 0,10 · 1% → 0,35 · 10% → 0,67 · 50% → 0,90 · 100% → 1 · 1000% → 1,33.
(function (root) {
  const K = 1000; // quanto maior, mais "abre" a escala nos erros pequenos

  function relativeError(guess, answer) {
    const diff = Math.abs(guess - answer);
    return diff / (Math.abs(answer) || 1);
  }

  function precisionOf(guess, answer) {
    const err = relativeError(guess, answer);
    if (!(err > 0)) return 0; // em cheio (ou erro inválido)
    return Math.log10(1 + err * K) / Math.log10(1 + K);
  }

  const api = { relativeError, precisionOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RevealPrecision = api;
})(typeof window !== 'undefined' ? window : globalThis);
