'use strict';

// Páginas de desenvolvimento (public/dev/, ex.: a pré-visualização das revelações) só ficam
// acessíveis fora de produção. Em produção: NODE_ENV=production ou a correr no Render (que
// define RENDER). Para as ligar mesmo assim (ex.: para testar no servidor), ENABLE_DEV_PAGES=1.
function devPagesEnabled(env = process.env) {
  if (env.ENABLE_DEV_PAGES === '1') return true;
  return env.NODE_ENV !== 'production' && !env.RENDER;
}

// Middleware: em produção, /dev/... responde 404 (antes dos ficheiros estáticos).
function devPagesGuard(env = process.env) {
  const enabled = devPagesEnabled(env);
  return (req, res, next) => {
    if (!enabled && /^\/dev(\/|$)/i.test(req.path)) return res.status(404).send('Not found');
    return next();
  };
}

// Só para a página de pré-visualização (dev/reveal.html): o resultado de uma pergunta de mapa
// calculado com as MESMAS contas do jogo (server/geo.js), para os cenários de mapa.
// GET /dev/map-result?country=643&guesses=lat,lon;lat,lon
//   → { center, distances: [km…] } (pela ordem dos palpites).
// Fica em /dev/, por isso em produção responde 404 (devPagesGuard, antes desta rota).
function devMapResult(req, res) {
  const { centerOf, distanceToCountry, hasCountry } = require('./geo');
  const country = String(req.query.country || '');
  if (!hasCountry(country)) return res.status(400).json({ error: `país desconhecido: ${country}` });
  const guesses = String(req.query.guesses || '').split(';').filter(Boolean).map((g) => {
    const [lat, lon] = g.split(',').map(Number);
    return { lat, lon };
  });
  if (guesses.some((g) => !Number.isFinite(g.lat) || !Number.isFinite(g.lon))) return res.status(400).json({ error: 'palpites inválidos' });
  return res.json({ center: centerOf(country), distances: guesses.map((g) => distanceToCountry(country, g)) });
}

module.exports = { devPagesEnabled, devPagesGuard, devMapResult };
