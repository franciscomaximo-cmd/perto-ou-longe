'use strict';

// Reencaminhamento do endereço antigo para o novo (ex.: perto-ou-longe.onrender.com →
// https://maiscoisamenoscoisa.onrender.com), configurado por variáveis de ambiente:
//   REDIRECT_FROM_HOST  host (ou hosts, separados por vírgulas) a reencaminhar, sem https://
//   REDIRECT_TO_URL     endereço novo, com https:// (ex.: https://maiscoisamenoscoisa.onrender.com)
// Sem as duas variáveis (em desenvolvimento e no serviço novo), não faz nada.
// Os pedidos para esse host recebem um 301 para o mesmo caminho e parâmetros no endereço novo
// (/?sala=ABCD continua a funcionar). O /health não é reencaminhado (verificação do Render).
// As ligações do Socket.IO (/socket.io/) são atendidas antes do Express, por isso quem já tem
// a página antiga aberta continua a jogar até recarregar.
function hostRedirect(env = process.env) {
  const from = new Set(String(env.REDIRECT_FROM_HOST || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
  let target = null;
  try {
    const url = new URL(String(env.REDIRECT_TO_URL || '').trim());
    if (url.protocol === 'https:' || url.protocol === 'http:') target = url.origin;
  } catch { /* sem endereço novo válido: não reencaminha */ }
  if (!from.size || !target) return (req, res, next) => next();
  // Nunca reencaminha para si próprio (ex.: as duas variáveis com o mesmo endereço).
  from.delete(new URL(target).host.toLowerCase());
  return (req, res, next) => {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
    if (!from.has(host) || req.path === '/health') return next();
    res.redirect(301, `${target}${req.originalUrl.startsWith('/') ? req.originalUrl : `/${req.originalUrl}`}`);
  };
}

module.exports = { hostRedirect };
