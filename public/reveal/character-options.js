'use strict';

// Peças do boneco de cada jogador (usadas no browser e no servidor, para validar).
// O boneco é: cabeça = o emoji do jogador; roupa = a cor do jogador (ou outra da paleta);
// chapéu/acessório e um extra opcional. Combinações iguais são permitidas.
(function (root) {
  // A mesma paleta das cores dos jogadores.
  const COLORS = [
    '#4dabf7', '#f783ac', '#ff922b', '#9775fa', '#3bc9db', '#a9e34b',
    '#e599f7', '#ffd43b', '#c49a6c', '#f1f3f5', '#5c7cfa', '#adb5bd',
  ];
  const HATS = [
    { id: 'nenhum', label: 'Nenhum' },
    { id: 'bone', label: 'Boné' },
    { id: 'coroa', label: 'Coroa' },
    { id: 'capacete', label: 'Capacete' },
    { id: 'cowboy', label: 'Cowboy' },
    { id: 'gorro', label: 'Gorro' },
    { id: 'auscultadores', label: 'Auscultadores' },
    { id: 'oculos', label: 'Óculos de sol' },
  ];
  const EXTRAS = [
    { id: 'nenhum', label: 'Nenhum' },
    { id: 'capa', label: 'Capa' },
    { id: 'cachecol', label: 'Cachecol' },
    { id: 'mochila', label: 'Mochila' },
  ];
  const POSES = ['parado', 'arco', 'lancar', 'kart', 'rematar', 'festejar', 'triste'];
  const POSE_LABELS = {
    parado: 'Parado', arco: 'A disparar arco', lancar: 'A lançar bola', kart: 'A conduzir kart',
    rematar: 'A rematar', festejar: 'A festejar', triste: 'Triste',
  };

  // Boneco por omissão: roupa na cor do jogador (outfit null), sem acessórios.
  const DEFAULT_CHARACTER = { outfit: null, hat: 'nenhum', extra: 'nenhum' };

  // Valida e limpa um boneco (parcial ou completo) a partir do atual. Devolve null se alguma
  // peça não existir.
  function cleanCharacter(raw, current = DEFAULT_CHARACTER) {
    if (!raw || typeof raw !== 'object') return null;
    const next = { ...DEFAULT_CHARACTER, ...current };
    if ('outfit' in raw) {
      if (raw.outfit !== null && !COLORS.includes(raw.outfit)) return null;
      next.outfit = raw.outfit;
    }
    if ('hat' in raw) {
      if (!HATS.some((h) => h.id === raw.hat)) return null;
      next.hat = raw.hat;
    }
    if ('extra' in raw) {
      if (!EXTRAS.some((e) => e.id === raw.extra)) return null;
      next.extra = raw.extra;
    }
    return next;
  }

  // Um boneco ao calhas (para o botão "Aleatório").
  function randomCharacter(random = Math.random) {
    const pick = (list) => list[Math.floor(random() * list.length)];
    return { outfit: random() < 0.4 ? null : pick(COLORS), hat: pick(HATS).id, extra: pick(EXTRAS).id };
  }

  const api = { COLORS, HATS, EXTRAS, POSES, POSE_LABELS, DEFAULT_CHARACTER, cleanCharacter, randomCharacter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CharacterOptions = api;
})(typeof window !== 'undefined' ? window : globalThis);
