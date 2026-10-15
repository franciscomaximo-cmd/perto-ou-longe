'use strict';

// Gerador pseudoaleatório com "semente" (usado no browser e nos testes). Os temas usam-no para
// variar a animação de forma DETERMINÍSTICA: com a mesma semente (ex.: a ronda e o id do
// jogador) dá sempre os mesmos números, em todos os telemóveis e depois de recarregar a
// página. Nunca usar Math.random() nos temas.
(function (root) {
  // Hash de texto para 32 bits (FNV-1a).
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // mulberry32: números entre 0 (inclusive) e 1 (exclusive).
  function seeded(seed) {
    let a = typeof seed === 'number' ? seed >>> 0 : hash(String(seed));
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const api = { hash, seeded };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RevealSeeded = api;
})(typeof window !== 'undefined' ? window : globalThis);
