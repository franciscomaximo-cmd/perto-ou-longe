'use strict';

// Leitura de números escritos à portuguesa (usada no browser e nos testes):
// - a vírgula é sempre decimal ("12,5");
// - o ponto é separador de milhares quando vem seguido de exatamente 3 algarismos
//   ("1.200", "12.500", "1.200.000", "1.200,5"); fora disso é decimal ("12.5", "2.44", "0.650");
// - os espaços são ignorados ("1 200").
(function (root) {
  function parseNumber(raw) {
    let s = String(raw == null ? '' : raw).trim().replace(/[\s  ]/g, '');
    if (!s) return null;
    if (/^-?[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      if (s.includes('.')) return null; // ex.: "1,200.5" — não é forma portuguesa
      s = s.replace(',', '.');
    }
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { parseNumber };
  else root.parseNumber = parseNumber;
})(typeof window !== 'undefined' ? window : globalThis);
