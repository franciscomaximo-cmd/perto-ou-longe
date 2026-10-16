'use strict';

// Peças do boneco de cada jogador (usadas no browser e no servidor, para validar).
// O boneco é: uma cara desenhada (tom de pele, forma, olhos, sobrancelhas, boca, cabelo e a sua
// cor, pelos faciais e um extra da cara); camisola = a cor do jogador (ou outra da paleta),
// com um padrão; calças e sapatilhas; chapéu/acessório; um extra (capa, cachecol, mochila);
// um objeto na mão; um animal de estimação; uma aura; e o festejo (animação de vitória,
// reação de derrota e frase). Combinações iguais são permitidas (a cara não tem de ser única).
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

  // --- Cara ---------------------------------------------------------------------------------
  const SKINS = ['#ffe0c7', '#f9d0a8', '#eebb8e', '#d9a066', '#c08050', '#a0663c', '#7a4a2a', '#5a3520'];
  // Cores do cabelo: as 6 primeiras naturais, as outras divertidas.
  const HAIR_COLORS = ['#1f1a17', '#4a2c1a', '#7b4a26', '#d9a441', '#b5481f', '#b8b8b8', '#4dabf7', '#f783ac', '#51cf66', '#9775fa'];
  const NATURAL_HAIR = HAIR_COLORS.slice(0, 6);
  const FACE_SHAPES = [
    { id: 'redonda', label: 'Redonda' },
    { id: 'oval', label: 'Oval' },
    { id: 'quadrada', label: 'Quadrada' },
  ];
  const EYES = [
    { id: 'normais', label: 'Normais' },
    { id: 'sorridentes', label: 'Sorridentes' },
    { id: 'sonolentos', label: 'Sonolentos' },
    { id: 'grandes', label: 'Grandes' },
    { id: 'piscar', label: 'A piscar o olho' },
    { id: 'estrelas', label: 'Estrelas' },
  ];
  const BROWS = [
    { id: 'normais', label: 'Normais' },
    { id: 'grossas', label: 'Grossas' },
    { id: 'zangadas', label: 'Zangadas' },
    { id: 'levantadas', label: 'Levantadas' },
  ];
  const MOUTHS = [
    { id: 'sorriso', label: 'Sorriso' },
    { id: 'aberto', label: 'Sorriso aberto' },
    { id: 'lingua', label: 'Língua de fora' },
    { id: 'surpresa', label: 'Surpresa' },
    { id: 'serio', label: 'Sério' },
    { id: 'dentes', label: 'Dentes' },
  ];
  const HAIRS = [
    { id: 'careca', label: 'Careca' },
    { id: 'curto', label: 'Curto' },
    { id: 'rapado', label: 'Rapado' },
    { id: 'encaracolado', label: 'Encaracolado' },
    { id: 'comprido', label: 'Comprido' },
    { id: 'rabo', label: 'Rabo-de-cavalo' },
    { id: 'carrapito', label: 'Carrapito' },
    { id: 'moicano', label: 'Moicano' },
    { id: 'trancas', label: 'Tranças' },
    { id: 'franja', label: 'Franja' },
  ];
  const FACIAL = [
    { id: 'nenhum', label: 'Nenhum' },
    { id: 'bigode', label: 'Bigode' },
    { id: 'barba-curta', label: 'Barba curta' },
    { id: 'barba-comprida', label: 'Barba comprida' },
  ];
  const FACE_EXTRAS = [
    { id: 'nenhum', label: 'Nenhum' },
    { id: 'sardas', label: 'Sardas' },
    { id: 'bochechas', label: 'Bochechas coradas' },
    { id: 'oculos-redondos', label: 'Óculos redondos' },
    { id: 'oculos-quadrados', label: 'Óculos quadrados' },
    { id: 'pala', label: 'Pala de pirata' },
  ];

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
  const POSES = ['parado', 'arco', 'lancar', 'kart', 'rematar', 'dardo', 'golfe', 'malha', 'basquete', 'festejar', 'triste', 'kart_festejar', 'kart_triste'];
  const POSE_LABELS = {
    parado: 'Parado', arco: 'A disparar arco', lancar: 'A lançar bola', kart: 'A conduzir kart',
    rematar: 'A rematar', dardo: 'A lançar dardo', golfe: 'A dar a tacada', malha: 'A lançar a malha', basquete: 'A lançar ao cesto', festejar: 'A festejar', triste: 'Triste',
    kart_festejar: 'A festejar no kart', kart_triste: 'Triste no kart',
  };

  // Cara por omissão (os jogadores novos recebem uma ao calhas, com randomFace).
  const DEFAULT_FACE = {
    skin: SKINS[2], face: 'redonda', eyes: 'normais', brows: 'normais', mouth: 'sorriso',
    hair: 'curto', hairColor: HAIR_COLORS[1], facial: 'nenhum', faceExtra: 'nenhum',
  };
  // Boneco por omissão: camisola lisa na cor do jogador (outfit null), sem acessórios.
  const DEFAULT_CHARACTER = {
    ...DEFAULT_FACE,
    outfit: null, pattern: 'liso', number: 10, pants: PANTS_COLORS[0], shoes: SHOE_COLORS[0],
    hat: 'nenhum', extra: 'nenhum', hand: 'nenhum', scarf: [SCARF_COLORS[0], SCARF_COLORS[4]],
    pet: 'nenhum', aura: 'nenhuma', win: 'bracos', lose: 'chorar', phrase: 0,
  };

  // Peças com escolha numa lista de { id }.
  const LISTS = {
    face: FACE_SHAPES, eyes: EYES, brows: BROWS, mouth: MOUTHS, hair: HAIRS, facial: FACIAL, faceExtra: FACE_EXTRAS,
    pattern: PATTERNS, hat: HATS, extra: EXTRAS, hand: HAND_ITEMS, pet: PETS, aura: AURAS, win: WINS, lose: LOSES,
  };
  // Peças com escolha numa paleta de cores.
  const PALETTES = { skin: SKINS, hairColor: HAIR_COLORS, pants: PANTS_COLORS, shoes: SHOE_COLORS };

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
    for (const [key, palette] of Object.entries(PALETTES)) {
      if (!(key in raw)) continue;
      if (!palette.includes(raw[key])) return null;
      next[key] = raw[key];
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

  // Escolha ao calhas com pesos: [[valor, peso], …].
  function weighted(random, entries) {
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let r = random() * total;
    for (const [v, w] of entries) { if ((r -= w) < 0) return v; }
    return entries[entries.length - 1][0];
  }

  // Uma cara ao calhas, variada mas "bonita": evita as combinações estranhas (as peças mais
  // marcadas, como olhos de estrelas, pala de pirata ou cabelo de cor divertida, saem pouco e
  // nunca juntas; barbas só com cabelo de cor natural; o cabelo rapado ou careca sem cores
  // divertidas).
  function randomFace(random = Math.random) {
    const pick = (list) => list[Math.floor(random() * list.length)];
    const hair = pick(HAIRS).id;
    let bold = 0; // peças marcadas já escolhidas (no máximo uma)
    const boldOk = () => bold === 0;
    const funHair = hair !== 'careca' && hair !== 'rapado' && random() < 0.18;
    if (funHair) bold += 1;
    const eyes = weighted(random, [['normais', 5], ['sorridentes', 3], ['grandes', 3], ['sonolentos', 1.5], ['piscar', 1], ['estrelas', boldOk() ? 0.6 : 0]]);
    if (eyes === 'estrelas') bold += 1;
    const faceExtra = weighted(random, [['nenhum', 5], ['sardas', 1.5], ['bochechas', 2], ['oculos-redondos', 1], ['oculos-quadrados', 1], ['pala', boldOk() ? 0.4 : 0]]);
    const facial = funHair ? 'nenhum' : weighted(random, [['nenhum', 6], ['bigode', 1], ['barba-curta', 1.4], ['barba-comprida', 0.7]]);
    return {
      skin: pick(SKINS),
      face: pick(FACE_SHAPES).id,
      eyes,
      brows: weighted(random, [['normais', 5], ['grossas', 2], ['levantadas', 2], ['zangadas', 1]]),
      mouth: weighted(random, [['sorriso', 5], ['aberto', 3], ['dentes', 2], ['lingua', 1], ['surpresa', 0.6], ['serio', 0.8]]),
      hair,
      hairColor: funHair ? pick(HAIR_COLORS.slice(6)) : pick(NATURAL_HAIR),
      facial,
      faceExtra,
    };
  }

  // Gerador com semente (o mesmo de public/reveal/seeded.js), para uma cara ficar sempre igual
  // para as mesmas escolhas antigas.
  function seededRandom(text) {
    let a = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { a ^= text.charCodeAt(i); a = Math.imul(a, 0x01000193); }
    a >>>= 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Escolhas guardadas por uma versão antiga (cabeça = emoji, sem cara): recebem uma cara ao
  // calhas gerada a partir dessas escolhas (sempre a mesma para as mesmas escolhas). As que já
  // têm cara ficam como estão. Devolve um boneco válido, ou null se não houver nada guardado.
  function upgradeCharacter(saved) {
    if (!saved || typeof saved !== 'object') return null;
    const known = {};
    // Só as peças que ainda existem; o resto (ex.: "emoji") ignora-se.
    for (const key of Object.keys(DEFAULT_CHARACTER)) if (key in saved) known[key] = saved[key];
    const hasFace = 'skin' in saved && 'hair' in saved;
    const base = hasFace ? {} : randomFace(seededRandom(JSON.stringify(saved)));
    return cleanCharacter({ ...base, ...known }) || cleanCharacter(base) || cleanCharacter({});
  }

  // Um boneco ao calhas (botão "Aleatório"): cara variada e bonita e as outras peças só
  // entre as desbloqueadas.
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
    return { ...ch, ...randomFace(random) };
  }

  const api = {
    COLORS, PANTS_COLORS, SHOE_COLORS, SCARF_COLORS, PATTERNS, HATS, EXTRAS, HAND_ITEMS, PETS, AURAS,
    WINS, LOSES, PHRASES, POSES, POSE_LABELS, DEFAULT_CHARACTER, UNLOCKS, EMPTY_PROGRESS,
    SKINS, HAIR_COLORS, FACE_SHAPES, EYES, BROWS, MOUTHS, HAIRS, FACIAL, FACE_EXTRAS, DEFAULT_FACE,
    unlockOf, isUnlocked, cleanCharacter, randomCharacter, randomFace, upgradeCharacter,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CharacterOptions = api;
})(typeof window !== 'undefined' ? window : globalThis);
