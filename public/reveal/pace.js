'use strict';

// Ritmo da revelação dos palpites (usado no servidor, que marca os passos, e no browser, para
// cada tema saber quanto tempo tem para a animação de cada palpite).
//
// Os palpites saem do mais longe para o mais perto:
//   - os mais longe passam depressa (~0,65 s cada);
//   - os últimos 3 (os mais perto) abrandam (~1,5 s), para criar suspense;
//   - antes do último (o vencedor) há uma pausa dramática (~1,9 s);
//   - depois do último, a resposta certa (~1,4 s).
// Do primeiro palpite até à resposta certa nunca passa de ~12 s (se passasse, os palpites
// rápidos encurtam, até 0,45 s; e só depois os lentos). Com 3 ou 4 jogadores fica perto do
// ritmo antigo (1,5 s por passo).
(function (root) {
  const BASE = { fast: 650, slow: 1500, drama: 1900, answer: 1400 };
  const MIN_FAST = 450;
  const MAX_TO_ANSWER = 12000;

  // n = número de palpites. Devolve { before, answer, total }:
  //   before[i] = ms entre o palpite i-1 e o palpite i (before[0] = 0: o primeiro sai logo);
  //   answer    = ms entre o último palpite e a resposta certa;
  //   total     = do primeiro palpite até à resposta certa.
  // `scale` multiplica tudo (o servidor usa-o nos testes, para irem depressa).
  function revealPace(n, scale = 1) {
    const kind = (i) => (i === 0 ? 'none' : i === n - 1 ? 'drama' : i >= n - 3 ? 'slow' : 'fast');
    const count = { fast: 0, slow: 0, drama: 0 };
    for (let i = 1; i < n; i++) count[kind(i)] += 1;
    const t = { ...BASE };
    const sum = () => count.fast * t.fast + count.slow * t.slow + count.drama * t.drama + t.answer;
    if (sum() > MAX_TO_ANSWER && count.fast) {
      t.fast = Math.max(MIN_FAST, (MAX_TO_ANSWER - (sum() - count.fast * t.fast)) / count.fast);
    }
    if (sum() > MAX_TO_ANSWER) {
      const k = (MAX_TO_ANSWER - count.fast * t.fast - t.answer) / (count.slow * t.slow + count.drama * t.drama);
      t.slow *= k;
      t.drama *= k;
    }
    const before = Array.from({ length: Math.max(0, n) }, (_, i) => (i === 0 ? 0 : Math.round(t[kind(i)] * scale)));
    const answer = Math.round(t.answer * scale);
    return { before, answer, total: before.reduce((a, b) => a + b, 0) + answer };
  }

  // Tempo que o palpite i tem para a sua animação (até ao passo seguinte).
  function timeFor(n, i) {
    const pace = revealPace(n);
    return i + 1 < n ? pace.before[i + 1] : pace.answer;
  }

  const api = { revealPace, timeFor, MAX_TO_ANSWER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RevealPace = api;
})(typeof window !== 'undefined' ? window : globalThis);
