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

module.exports = { devPagesEnabled, devPagesGuard };
