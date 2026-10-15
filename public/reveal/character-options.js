'use strict';

// Peças do boneco de cada jogador (usadas no browser e no servidor, para validar).
// O boneco é: cabeça = o emoji do jogador; camisola = a cor do jogador (ou outra da paleta),
// com um padrão; calças e sapatilhas; chapéu/acessório; um extra (capa, cachecol, mochila);
// um objeto na mão; um animal de estimação; uma aura; e o festejo (animação de vitória,
// reação de derrota e frase). Combinações iguais são permitidas.
//
// Algumas peças começam BLOQUEADAS e desbloqueiam com feitos guardados no próprio dispositivo
// (localStorage, sem contas). O servidor só valida que as peças existem; os desbloqueios são
// só por diversão e verificam-se no browser.
(function (root) {
  // A mesma paleta das cores dos jogadores.
  const COLORS = [
    '#4dabf7', '#f783ac', '#ff922b', '#9775fa', '#3bc9db', '#a9e34b',
    '#e599f7', '#ffd43b', '#c49a6c', '#f1f3f5', '#5c7cfa', '#adb5bd',
  ];
  const PANTS_COLORS = ['#2b2a4a', '#1c3d6e', '#495057', '#f1f3f5', '#8d5a2b', '#2f9e44', '#c92a2a', '#212529'];
  const SHOE_COLORS = ['#15142a', '#f8f9fa', '#e03131', '#1c7ed6', '#ffd43b', '#2f9e44', '#ff922b', '#be4bdb'];
  // Cores do cachecol (na mão): fortes, para se distinguirem as duas.
  const SCARF_COLORS = ['#e03131', '#2f9e44', '#1c7ed6', '#ffd43b', '#f8f9fa', '#212529', '#ff922b', '#be4bdb'];

  const PATTERNS = [
    { id: 'liso', label: 'Lisa' },
    { id: 'riscas', label: 'Riscas' },
    { id: 'xadrez', label: 'Xadrez' },
    { id: 'futebol', label: 'Futebol' }, // com número (1 a 99)
  ];
  const HATS = [
    { id: 'nenhum', label: 'Nenhum' },
    { id: 'bone', label: 'Boné' },
    { id: 'coroa', label: 'Coroa' },
    { id: 'coroa_dourada', label: 'Coroa dourada' }, // desbloqueável (com pedras e brilho)
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
  const HAND_ITEMS = [
    { id: 'nenhum', label: 'Nada' },
    { id: 'bandeira', label: 'Bandeira' },
    { id: 'cachecol', label: 'Cachecol' },
    { id: 'trofeu', label: 'Troféu' },
    { id: 'guarda-chuva', label: 'Guarda-chuva' },
    { id: 'balao', label: 'Balão' },
  ];
  const PETS = [
    { id: 'nenhum', label: 'Nenhum' },
    { id: 'cao', label: 'Cão' },
    { id: 'gato', label: 'Gato' },
    { id: 'papagaio', label: 'Papagaio' },
    { id: 'tartaruga', label: 'Tartaruga' },
  ];
  const AURAS = [
    { id: 'nenhuma', label: 'Nenhuma' },
    { id: 'estrelas', label: 'Estrelas' },
    { id: 'chamas', label: 'Chamas' },
    { id: 'arco-iris', label: 'Arco-íris' },
    { id: 'coracoes', label: 'Corações' },
  ];
  const WINS = [
    { id: 'bracos', label: 'Braços no ar' },
    { id: 'pular', label: 'Pular' },
    { id: 'rodopiar', label: 'Rodopiar' },
    { id: 'siuuu', label: 'Siuuu' },
    { id: 'robo', label: 'Dança robô' },
  ];
  const LOSES = [
    { id: 'chorar', label: 'Chorar' },
    { id: 'ombros', label: 'Encolher os ombros' },
    { id: 'cair', label: 'Cair para trás' },
  ];
  // Frase de festejo: lista FIXA (sem texto livre), mostrada num balão quando ganha a ronda.
  const PHRASES = [
    'Eu sabia!',
    'Na mouche!',
    'Que pontaria!',
    'Ninguém me para!',
    'Isto é talento!',
    'Foi sorte… ou não!',
    'Obrigado, obrigado!',
    'Toma lá!',
    'Siuuu!',
    'Próxima!',
  ];

  // Poses (usadas pelos temas e pela pré-visualização). "festejar" e "triste" desenham a
  // animação de vitória / reação de derrota escolhidas pelo jogador.
  const POSES = ['parado', 'arco', 'lancar', 'kart', 'rematar', 'festejar', 'triste', 'kart_festejar', 'kart_triste'];
  const POSE_LABELS = {
    parado: 'Parado', arco: 'A disparar arco', lancar: 'A lançar bola', kart: 'A conduzir kart',
    rematar: 'A rematar', festejar: 'A festejar', triste: 'Triste',
    kart_festejar: 'A festejar no kart', kart_triste: 'Triste no kart',
  };

  // Boneco por omissão: camisola lisa na cor do jogador (outfit null), sem acessórios.
  const DEFAULT_CHARACTER = {
    outfit: null, pattern: 'liso', number: 10, pants: PANTS_COLORS[0], shoes: SHOE_COLORS[0],
    hat: 'nenhum', extra: 'nenhum', hand: 'nenhum', scarf: [SCARF_COLORS[0], SCARF_COLORS[4]],
    pet: 'nenhum', aura: 'nenhuma', win: 'bracos', lose: 'chorar', phrase: 0,
  };

  // Peças com escolha numa lista de { id }.
  const LISTS = { pattern: PATTERNS, hat: HATS, extra: EXTRAS, hand: HAND_ITEMS, pet: PETS, aura: AURAS, win: WINS, lose: LOSES };

  // --- Desbloqueáveis ------------------------------------------------------------------------
  // progress = { exact, wins, bigWins, games } (guardado no localStorage do dispositivo):
  //   exact   = vezes que acertou "em cheio" (no total);
  //   wins    = jogos ganhos; bigWins = jogos ganhos com 6 ou mais jogadores;
  //   games   = jogos jogados até ao fim.
  const UNLOCKS = [
    { key: 'hat', id: 'coroa_dourada', stat: 'exact', need: 3, how: 'Acerta "em cheio" 3 vezes' },
    { key: 'aura', id: 'chamas', stat: 'wins', need: 5, how: 'Ganha 5 jogos' },
    { key: 'hand', id: 'trofeu', stat: 'bigWins', need: 1, how: 'Ganha um jogo com 6 ou mais jogadores' },
    { key: 'pet', id: 'papagaio', stat: 'games', need: 3, how: 'Joga 3 jogos até ao fim' },
    { key: 'win', id: 'siuuu', stat: 'exact', need: 1, how: 'Acerta "em cheio" uma vez' },
  ];
  const EMPTY_PROGRESS = { exact: 0, wins: 0, bigWins: 0, games: 0 };

  // A regra de desbloqueio de uma peça (ou null se está sempre disponível).
  const unlockOf = (key, id) => UNLOCKS.find((u) => u.key === key && u.id === id) || null;
  function isUnlocked(key, id, progress = EMPTY_PROGRESS) {
    const u = unlockOf(key, id);
    return !u || (Number(progress[u.stat]) || 0) >= u.need;
  }

  const validInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  // Valida e limpa um boneco (parcial ou completo) a partir do atual. Valores em falta ficam
  // com o atual (ou o valor por omissão: bonecos antigos, com só roupa/chapéu/extra,
  // continuam a funcionar). Devolve null se alguma peça não existir.
  function cleanCharacter(raw, current = DEFAULT_CHARACTER) {
    if (!raw || typeof raw !== 'object') return null;
    const next = { ...DEFAULT_CHARACTER, ...current };
    next.scarf = [...next.scarf];
    if ('outfit' in raw) {
      if (raw.outfit !== null && !COLORS.includes(raw.outfit)) return null;
      next.outfit = raw.outfit;
    }
    for (const [key, list] of Object.entries(LISTS)) {
      if (!(key in raw)) continue;
      if (!list.some((o) => o.id === raw[key])) return null;
      next[key] = raw[key];
    }
    if ('number' in raw) {
      if (!validInt(raw.number, 1, 99)) return null;
      next.number = raw.number;
    }
    if ('pants' in raw) {
      if (!PANTS_COLORS.includes(raw.pants)) return null;
      next.pants = raw.pants;
    }
    if ('shoes' in raw) {
      if (!SHOE_COLORS.includes(raw.shoes)) return null;
      next.shoes = raw.shoes;
    }
    if ('scarf' in raw) {
      if (!Array.isArray(raw.scarf) || raw.scarf.length !== 2 || !raw.scarf.every((c) => SCARF_COLORS.includes(c))) return null;
      next.scarf = [...raw.scarf];
    }
    if ('phrase' in raw) {
      if (!validInt(raw.phrase, 0, PHRASES.length - 1)) return null;
      next.phrase = raw.phrase;
    }
    return next;
  }

  // Um boneco ao calhas (botão "Aleatório"), só com peças desbloqueadas.
  function randomCharacter(random = Math.random, progress = null) {
    const pick = (list) => list[Math.floor(random() * list.length)];
    const pickId = (key) => {
      const open = LISTS[key].filter((o) => !progress || isUnlocked(key, o.id, progress));
      return pick(open).id;
    };
    const ch = {
      outfit: random() < 0.4 ? null : pick(COLORS),
      number: 1 + Math.floor(random() * 99),
      pants: pick(PANTS_COLORS),
      shoes: pick(SHOE_COLORS),
      scarf: [pick(SCARF_COLORS), pick(SCARF_COLORS)],
      phrase: Math.floor(random() * PHRASES.length),
    };
    for (const key of Object.keys(LISTS)) ch[key] = pickId(key);
    return ch;
  }

  const api = {
    COLORS, PANTS_COLORS, SHOE_COLORS, SCARF_COLORS, PATTERNS, HATS, EXTRAS, HAND_ITEMS, PETS, AURAS,
    WINS, LOSES, PHRASES, POSES, POSE_LABELS, DEFAULT_CHARACTER, UNLOCKS, EMPTY_PROGRESS,
    unlockOf, isUnlocked, cleanCharacter, randomCharacter,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CharacterOptions = api;
})(typeof window !== 'undefined' ? window : globalThis);
