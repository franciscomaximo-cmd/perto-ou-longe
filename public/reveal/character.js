'use strict';

// Boneco de cada jogador, desenhado em SVG com peças simples. É a ÚNICA forma de desenhar o
// boneco: os temas de revelação só escolhem a pose, nunca o desenham por conta própria.
//
//   drawCharacter(player, pose, { size, small, title, kartColor, withPet })
//     player: { color, character } (peças em public/reveal/character-options.js; as que
//             faltarem ficam com o valor por omissão)
//     pose:   'parado' | 'arco' | 'lancar' | 'kart' | 'rematar' | 'dardo' | 'golfe' | 'malha'
//             | 'malha_solto' (acabou de lançar a malha) | 'basquete'
//             | 'festejar' | 'triste'
//             | 'kart_festejar' | 'kart_triste' (no kart, no fim da corrida)
//             "festejar" e "triste" desenham a animação de vitória e a reação de derrota que o
//             jogador escolheu (pular, rodopiar, siuuu, dança robô, braços no ar; chorar,
//             encolher os ombros, cair para trás). As animações são CSS, correm algumas vezes
//             e param (nunca para sempre); com movimento reduzido, nem começam.
//     size:   altura em px (a largura é ~0,77 da altura; ~1,08 com o animal)
//     small:  versão simplificada (traços mais grossos, sem extras, objeto na mão, número da
//             camisola, nem pormenores da cara), para quando há muitos jogadores no ecrã. A
//             cor, o tom de pele, o cabelo (forma e cor), o chapéu e o padrão da camisola
//             continuam lá, para se reconhecer.
//     A cabeça é uma cara desenhada (peças da cara no boneco) e muda de expressão com a pose:
//     contente ao festejar, triste ou chocada na derrota, concentrada antes de lançar.
//
//   drawPortrait(player, { size, small }): o retrato (cabeça e ombros) num círculo com a cor
//     do jogador. É o avatar das listas e as marcas dos temas (uma só função para o retrato).
//     kartColor: cor do kart nas poses de kart (por omissão, vermelho)
//     withPet: desenha o animal de estimação ao lado (o desenho fica mais largo); só onde
//             couber (editor, ecrã final, festejos em grande).
//   Devolve um <svg class="character pose-…">.
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 100;
  const H = 130;
  const PET_W = 40; // largura extra com o animal
  const Options = root.CharacterOptions;

  function svgEl(tag, attrs = {}, children = []) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    for (const c of children) if (c) node.append(c);
    return node;
  }
  const poly = (points, attrs) => svgEl('polyline', { points: points.map((p) => p.join(',')).join(' '), fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...attrs });

  // Cor mais escura (contornos e sombras), a partir de um "#rrggbb".
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - f)));
    return `rgb(${c.join(',')})`;
  }
  // Cor clara (> 0,6 de luminância): para o número da camisola ficar legível.
  function isLight(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6;
  }

  // Articulações de cada pose: ombro → cotovelo → mão; anca → joelho → pé.
  // head: centro da cabeça e inclinação (graus); o boneco olha para a direita nas poses de ação.
  const POSES = {
    parado: {
      head: [50, 30, 0],
      armL: [[39, 54], [34, 68], [33, 81]], armR: [[61, 54], [66, 68], [67, 81]],
      legL: [[45, 82], [44, 102], [43, 121]], legR: [[55, 82], [56, 102], [57, 121]],
      free: true,
    },
    arco: {
      head: [52, 30, 0],
      armL: [[40, 54], [50, 57], [59, 51]], armR: [[61, 54], [74, 52], [86, 50]],
      legL: [[45, 82], [40, 101], [35, 121]], legR: [[55, 82], [60, 101], [65, 121]],
    },
    lancar: {
      head: [54, 32, 8],
      armL: [[39, 55], [30, 50], [21, 45]], armR: [[61, 55], [67, 72], [72, 89]],
      legL: [[45, 82], [36, 100], [24, 117]], legR: [[55, 82], [66, 97], [70, 121]],
    },
    kart: {
      head: [50, 34, 0],
      armL: [[40, 58], [52, 68], [66, 74]], armR: [[60, 58], [66, 68], [72, 74]],
      legL: [[45, 86], [56, 90], [64, 92]], legR: [[55, 86], [62, 90], [68, 92]],
      seated: true, kart: true,
    },
    // No kart, no fim da corrida: a festejar de braços no ar, ou triste, sem sair do kart.
    kart_festejar: {
      head: [50, 32, 0],
      armL: [[40, 58], [33, 44], [29, 30]], armR: [[60, 58], [67, 44], [71, 30]],
      legL: [[45, 86], [56, 90], [64, 92]], legR: [[55, 86], [62, 90], [68, 92]],
      seated: true, kart: true, mood: 'festejar',
    },
    kart_triste: {
      head: [49, 37, -16],
      armL: [[40, 59], [50, 70], [63, 78]], armR: [[60, 59], [65, 70], [69, 78]],
      legL: [[45, 86], [56, 90], [64, 92]], legR: [[55, 86], [62, 90], [68, 92]],
      seated: true, kart: true, mood: 'triste',
    },
    // A lançar um dardo: braço direito dobrado junto à cabeça, com o dardo apontado em frente.
    dardo: {
      head: [49, 30, -4],
      armL: [[39, 54], [32, 64], [36, 74]], armR: [[61, 54], [72, 46], [66, 34]],
      legL: [[45, 82], [41, 101], [38, 121]], legR: [[55, 82], [60, 101], [64, 121]],
    },
    // A dar a tacada (putt): as duas mãos juntas no taco, cabeça a olhar para a bola.
    golfe: {
      head: [52, 32, 12],
      armL: [[40, 55], [45, 70], [53, 82]], armR: [[60, 55], [60, 70], [56, 82]],
      legL: [[45, 82], [40, 101], [37, 121]], legR: [[55, 82], [61, 101], [64, 121]],
    },
    // A lançar a malha: por baixo, com o disco na mão direita e um passo em frente.
    malha: {
      head: [53, 32, 6],
      armL: [[39, 55], [30, 64], [22, 70]], armR: [[61, 55], [68, 72], [78, 84]],
      legL: [[45, 82], [37, 100], [26, 118]], legR: [[55, 82], [64, 98], [68, 121]],
    },
    // Acabou de lançar a malha: o braço direito segue em frente, à altura do peito, sem o disco.
    malha_solto: {
      head: [53, 31, -4],
      armL: [[39, 55], [30, 66], [24, 76]], armR: [[61, 55], [73, 61], [85, 56]],
      legL: [[45, 82], [36, 100], [24, 117]], legR: [[55, 82], [65, 98], [70, 121]],
    },
    // A lançar ao cesto: os dois braços no ar, com a bola por cima da cabeça.
    basquete: {
      head: [50, 34, -6],
      armL: [[39, 54], [40, 36], [45, 18]], armR: [[61, 54], [62, 36], [57, 18]],
      legL: [[45, 82], [42, 101], [42, 121]], legR: [[55, 82], [59, 101], [60, 121]],
    },
    rematar: {
      head: [48, 30, -6],
      armL: [[39, 54], [30, 58], [21, 64]], armR: [[61, 54], [69, 46], [77, 40]],
      legL: [[45, 82], [44, 101], [42, 121]], legR: [[55, 82], [68, 93], [80, 106]],
    },
    festejar: {
      head: [50, 30, 0],
      armL: [[39, 54], [31, 40], [27, 26]], armR: [[61, 54], [69, 40], [73, 26]],
      legL: [[45, 82], [41, 101], [38, 121]], legR: [[55, 82], [59, 101], [62, 121]],
      free: true, mood: 'festejar',
    },
    // "Siuuu": braços abertos para baixo e pernas afastadas, depois do salto.
    siuuu: {
      head: [50, 30, -4],
      armL: [[39, 54], [27, 63], [17, 72]], armR: [[61, 54], [73, 63], [83, 72]],
      legL: [[45, 82], [37, 101], [30, 121]], legR: [[55, 82], [63, 101], [70, 121]],
      free: true, mood: 'festejar',
    },
    // Dança robô: braços em ângulo reto.
    robo: {
      head: [50, 30, 8],
      armL: [[39, 54], [27, 54], [27, 40]], armR: [[61, 54], [73, 54], [73, 68]],
      legL: [[45, 82], [44, 102], [43, 121]], legR: [[55, 82], [56, 102], [57, 121]],
      free: true, mood: 'festejar',
    },
    triste: {
      head: [49, 34, -16],
      armL: [[40, 56], [38, 71], [39, 85]], armR: [[60, 56], [62, 71], [61, 85]],
      legL: [[46, 82], [46, 102], [46, 121]], legR: [[54, 82], [54, 102], [54, 121]],
      free: true, mood: 'triste',
    },
    // Encolher os ombros: mãos abertas à altura dos ombros.
    ombros: {
      head: [50, 31, -8],
      armL: [[39, 55], [30, 64], [25, 54]], armR: [[61, 55], [70, 64], [75, 54]],
      legL: [[45, 82], [44, 102], [43, 121]], legR: [[55, 82], [56, 102], [57, 121]],
      free: true, mood: 'triste',
    },
    // Cair para trás: braços no ar (a animação deita-o).
    cair: {
      head: [50, 30, 0],
      armL: [[39, 54], [29, 44], [22, 36]], armR: [[61, 54], [71, 44], [78, 36]],
      legL: [[45, 82], [42, 101], [40, 121]], legR: [[55, 82], [60, 101], [63, 121]],
      free: true, mood: 'triste',
    },
  };
  // Pose de cada escolha de festejo / reação.
  const WIN_POSE = { bracos: 'festejar', pular: 'festejar', rodopiar: 'festejar', siuuu: 'siuuu', robo: 'robo' };
  const LOSE_POSE = { chorar: 'triste', ombros: 'ombros', cair: 'cair' };
  // Braços de uma pose de pé, para o boneco sentado no kart (os ombros ficam 4 mais abaixo).
  const seatedArms = (pose) => ({ armL: POSES[pose].armL.map(([x, y]) => [x, y + 4]), armR: POSES[pose].armR.map(([x, y]) => [x, y + 4]) });

  // --- Chapéus e acessórios (relativos ao centro da cabeça, raio ~15) --------------------------
  function hat(id, outfit, small) {
    const dark = shade(outfit, 0.35);
    switch (id) {
      case 'bone':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M-15,-8 Q0,-29 15,-8 Z', fill: outfit, stroke: dark, 'stroke-width': 1.5 }),
          svgEl('rect', { x: 4, y: -11, width: 21, height: 5, rx: 2.5, fill: dark }),
          small ? null : svgEl('circle', { cx: 0, cy: -22, r: 2, fill: dark }),
        ]);
      case 'coroa':
        return svgEl('path', { d: 'M-12,-11 L-13,-25 L-6,-18 L0,-29 L6,-18 L13,-25 L12,-11 Z', fill: '#ffd43b', stroke: '#c98a00', 'stroke-width': 1.5, 'stroke-linejoin': 'round' });
      case 'coroa_dourada':
        // A desbloqueável: mais alta, com 5 pontas com pérolas, pedras e um brilho.
        return svgEl('g', {}, [
          svgEl('path', { d: 'M-15,-10 L-16,-27 L-9,-20 L-5,-31 L0,-22 L5,-31 L9,-20 L16,-27 L15,-10 Z', fill: '#ffd43b', stroke: '#b07800', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
          svgEl('rect', { x: -15, y: -14, width: 30, height: 4, fill: '#fab005', stroke: '#b07800', 'stroke-width': 0.8 }),
          ...[[-16, -27], [-5, -31], [5, -31], [16, -27]].map(([x, y]) => svgEl('circle', { cx: x, cy: y, r: small ? 2 : 1.8, fill: '#fff8db', stroke: '#b07800', 'stroke-width': 0.6 })),
          small ? null : svgEl('circle', { cx: 0, cy: -17, r: 2.3, fill: '#e03131' }),
          small ? null : svgEl('circle', { cx: -8, cy: -15.5, r: 1.6, fill: '#1c7ed6' }),
          small ? null : svgEl('circle', { cx: 8, cy: -15.5, r: 1.6, fill: '#2f9e44' }),
          small ? null : svgEl('path', { d: 'M-10,-24 L-8,-20', stroke: '#ffffff', 'stroke-width': 1.4, 'stroke-linecap': 'round', opacity: 0.8 }),
        ]);
      case 'capacete':
        return svgEl('g', {}, [
          // Só a calote, acima dos olhos (não tapa os olhos), com uma risca ao meio.
          svgEl('path', { d: 'M-17,-8 Q-17,-29 0,-29 Q17,-29 17,-8 Z', fill: outfit, stroke: dark, 'stroke-width': 1.5 }),
          svgEl('path', { d: 'M-2,-29 L2,-29 L2,-8 L-2,-8 Z', fill: '#ffffff', opacity: 0.85 }),
          svgEl('rect', { x: -18, y: -10, width: 36, height: 3.5, rx: 1.75, fill: dark }),
        ]);
      case 'cowboy':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M-11,-11 L-10,-25 Q0,-21 10,-25 L11,-11 Z', fill: '#8d5a2b', stroke: '#5c3a1a', 'stroke-width': 1.5 }),
          svgEl('rect', { x: -11, y: -15, width: 22, height: 3.5, fill: '#3b2410' }),
          svgEl('ellipse', { cx: 0, cy: -11, rx: 25, ry: 4.5, fill: '#a0692f', stroke: '#5c3a1a', 'stroke-width': 1.5 }),
        ]);
      case 'gorro':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M-15,-8 Q0,-31 15,-8 Z', fill: outfit, stroke: dark, 'stroke-width': 1.5 }),
          svgEl('rect', { x: -16, y: -11, width: 32, height: 6, rx: 3, fill: '#f1f3f5', stroke: '#ced4da', 'stroke-width': 1 }),
          svgEl('circle', { cx: 0, cy: -26, r: 4.5, fill: '#f1f3f5', stroke: '#ced4da', 'stroke-width': 1 }),
        ]);
      case 'auscultadores':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M-17,0 Q0,-36 17,0', fill: 'none', stroke: '#343a40', 'stroke-width': 3.5, 'stroke-linecap': 'round' }),
          svgEl('rect', { x: -21, y: -7, width: 7, height: 14, rx: 3, fill: '#343a40' }),
          svgEl('rect', { x: 14, y: -7, width: 7, height: 14, rx: 3, fill: '#343a40' }),
          small ? null : svgEl('rect', { x: -20, y: -4, width: 3, height: 8, rx: 1.5, fill: outfit }),
          small ? null : svgEl('rect', { x: 17, y: -4, width: 3, height: 8, rx: 1.5, fill: outfit }),
        ]);
      case 'oculos':
        return svgEl('g', {}, [
          svgEl('rect', { x: -13, y: -6, width: 11, height: 7, rx: 3, fill: '#111' }),
          svgEl('rect', { x: 2, y: -6, width: 11, height: 7, rx: 3, fill: '#111' }),
          svgEl('path', { d: 'M-2,-4 L2,-4', stroke: '#111', 'stroke-width': 2 }),
          small ? null : svgEl('path', { d: 'M-11,-4.5 L-8,-4.5 M4,-4.5 L7,-4.5', stroke: '#ffffff', 'stroke-width': 1, opacity: 0.8 }),
        ]);
      default:
        return null;
    }
  }

  // Extras atrás do corpo (capa, mochila) e à frente (cachecol).
  function extraBehind(id, pose, outfit) {
    if (id === 'capa') {
      const seated = POSES[pose].seated;
      const flow = pose === 'arco' || pose === 'lancar' || pose === 'rematar' || seated ? -10 : 0;
      const bottom = seated ? 86 : 104;
      return svgEl('path', { d: `M39,51 L61,51 L${70 + flow},${bottom} Q${50 + flow},${bottom + 6} ${28 + flow},${bottom} Z`, fill: '#c92a2a', stroke: '#8a1c1c', 'stroke-width': 1.5, 'stroke-linejoin': 'round' });
    }
    if (id === 'mochila') {
      return svgEl('g', {}, [
        svgEl('rect', { x: 29, y: 55, width: 13, height: 24, rx: 4, fill: '#8d5a2b', stroke: '#5c3a1a', 'stroke-width': 1.5 }),
        svgEl('rect', { x: 31, y: 66, width: 9, height: 6, rx: 2, fill: '#a0692f' }),
      ]);
    }
    return null;
  }
  function extraFront(id) {
    if (id === 'cachecol') {
      return svgEl('g', {}, [
        svgEl('rect', { x: 39, y: 46, width: 22, height: 7, rx: 3.5, fill: '#fa5252', stroke: '#c92a2a', 'stroke-width': 1 }),
        svgEl('rect', { x: 53, y: 50, width: 6, height: 17, rx: 2.5, fill: '#fa5252', stroke: '#c92a2a', 'stroke-width': 1 }),
        svgEl('path', { d: 'M45,46 L45,53 M51,46 L51,53 M53,57 L59,57 M53,62 L59,62', stroke: '#ffffff', 'stroke-width': 1.5 }),
      ]);
    }
    if (id === 'mochila') {
      // Alças da mochila por cima da roupa.
      return svgEl('path', { d: 'M41,52 L44,80', stroke: '#5c3a1a', 'stroke-width': 2.5, 'stroke-linecap': 'round' });
    }
    return null;
  }

  // --- Padrão da camisola (por cima do tronco, dentro dos seus limites) ----------------------
  function pattern(id, top, outfit, number, small) {
    const dark = shade(outfit, 0.4);
    if (id === 'riscas') {
      return svgEl('g', { opacity: 0.6 }, [8, 17, 26].map((dy) => svgEl('rect', { x: 39.5, y: top + dy, width: 21, height: 3.6, fill: dark })));
    }
    if (id === 'xadrez') {
      const cells = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        if ((r + c) % 2) cells.push(svgEl('rect', { x: 39.5 + c * 5.25, y: top + 6 + r * 5.5, width: 5.25, height: 5.5, fill: dark }));
      }
      return svgEl('g', { opacity: 0.55 }, cells);
    }
    if (id === 'futebol') {
      const ink = isLight(outfit) ? '#212529' : '#ffffff';
      return svgEl('g', {}, [
        // Gola em V e riscas nos ombros.
        svgEl('path', { d: `M45,${top} L50,${top + 6} L55,${top}`, fill: 'none', stroke: ink, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
        svgEl('path', { d: `M39,${top + 4} L39,${top + 30} M61,${top + 4} L61,${top + 30}`, stroke: ink, 'stroke-width': 1.6, opacity: 0.7 }),
        small ? null : svgEl('text', {
          x: 50, y: top + 22, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 900, fill: ink,
          stroke: shade(outfit, 0.5), 'stroke-width': 0.6, style: 'font-family: system-ui, -apple-system, "Segoe UI", sans-serif',
        }, [document.createTextNode(String(number))]),
      ]);
    }
    return null;
  }

  // --- Objeto na mão (só nas poses de mãos livres; anda com a mão direita) ------------------
  function handItem(id, g, outfit, scarf) {
    const [hx, hy] = g.armR[2];
    switch (id) {
      case 'bandeira':
        return svgEl('g', {}, [
          svgEl('line', { x1: hx, y1: hy + 6, x2: hx, y2: hy - 32, stroke: '#8d5a2b', 'stroke-width': 2, 'stroke-linecap': 'round' }),
          svgEl('rect', { x: hx, y: hy - 32, width: 10, height: 13, fill: scarf[0] }),
          svgEl('rect', { x: hx + 10, y: hy - 32, width: 10, height: 13, fill: scarf[1] }),
          svgEl('rect', { x: hx, y: hy - 32, width: 20, height: 13, fill: 'none', stroke: 'rgba(0,0,0,.35)', 'stroke-width': 0.8 }),
        ]);
      case 'cachecol': {
        const [lx, ly] = g.armL[2];
        const up = hy < 50 && ly < 50; // com os dois braços no ar fica esticado entre as mãos
        const stripes = (x, y, w, h, vertical) => Array.from({ length: 5 }, (_, i) => svgEl('rect', vertical
          ? { x, y: y + (i * h) / 5, width: w, height: h / 5, fill: scarf[i % 2] }
          : { x: x + (i * w) / 5, y, width: w / 5, height: h, fill: scarf[i % 2] }));
        return up
          ? svgEl('g', {}, stripes(lx, Math.min(ly, hy) - 3, hx - lx, 6, false))
          : svgEl('g', {}, stripes(hx - 3, hy, 6, 28, true));
      }
      case 'trofeu':
        return svgEl('g', { transform: `translate(${hx} ${hy - 9})` }, [
          svgEl('path', { d: 'M-7,-8 L7,-8 L6,0 Q0,6 -6,0 Z', fill: '#ffd43b', stroke: '#c98a00', 'stroke-width': 1.2 }),
          svgEl('path', { d: 'M-7,-6 Q-12,-5 -8,1 M7,-6 Q12,-5 8,1', fill: 'none', stroke: '#c98a00', 'stroke-width': 1.5 }),
          svgEl('rect', { x: -1.5, y: 3, width: 3, height: 5, fill: '#c98a00' }),
          svgEl('rect', { x: -5, y: 8, width: 10, height: 3, rx: 1, fill: '#8d5a2b' }),
        ]);
      case 'guarda-chuva': {
        const top = Math.max(4, hy - 70);
        const cx = hx - 6;
        return svgEl('g', {}, [
          svgEl('line', { x1: hx, y1: hy + 2, x2: cx, y2: top + 14, stroke: '#343a40', 'stroke-width': 1.8 }),
          svgEl('path', { d: `M${cx - 28},${top + 14} Q${cx},${top - 10} ${cx + 28},${top + 14} Q${cx + 21},${top + 10} ${cx + 14},${top + 14} Q${cx + 7},${top + 10} ${cx},${top + 14} Q${cx - 7},${top + 10} ${cx - 14},${top + 14} Q${cx - 21},${top + 10} ${cx - 28},${top + 14} Z`, fill: '#e03131', stroke: '#8a1c1c', 'stroke-width': 1.2 }),
          svgEl('path', { d: `M${cx},${top - 2} L${cx},${top + 14}`, stroke: '#ffffff', 'stroke-width': 1, opacity: 0.6 }),
        ]);
      }
      case 'balao': {
        const by = Math.max(10, hy - 48);
        const bx = hx + 8;
        return svgEl('g', {}, [
          svgEl('path', { d: `M${hx},${hy} Q${hx + 8},${(hy + by) / 2} ${bx},${by + 11}`, fill: 'none', stroke: '#dee2e6', 'stroke-width': 0.8 }),
          svgEl('ellipse', { cx: bx, cy: by, rx: 8, ry: 10, fill: '#ff6b6b', stroke: '#c92a2a', 'stroke-width': 1 }),
          svgEl('ellipse', { cx: bx - 3, cy: by - 4, rx: 2, ry: 3, fill: '#ffffff', opacity: 0.6 }),
        ]);
      }
      default:
        return null;
    }
  }

  // --- Aura (atrás do corpo; discreta, forte quando festeja) ---------------------------------
  const starPath = (cx, cy, r) => Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  const heartPath = (x, y, s) => `M${x},${y + 3 * s} C${x - 6 * s},${y - 2 * s} ${x - 3 * s},${y - 6 * s} ${x},${y - 3 * s} C${x + 3 * s},${y - 6 * s} ${x + 6 * s},${y - 2 * s} ${x},${y + 3 * s} Z`;
  function aura(id) {
    switch (id) {
      case 'estrelas':
        return svgEl('g', {}, [[16, 30, 5], [84, 24, 6], [12, 72, 4], [88, 66, 5], [50, 4, 4]]
          .map(([x, y, r]) => svgEl('polygon', { points: starPath(x, y, r), fill: '#ffd43b' })));
      case 'chamas':
        return svgEl('g', {}, [[30, 34, 0.9], [50, 44, 1.15], [70, 34, 0.9]].map(([x, h, k]) => svgEl('g', {}, [
          svgEl('path', { d: `M${x - 11 * k},124 Q${x - 13 * k},${124 - h * 0.6} ${x},${124 - h} Q${x + 13 * k},${124 - h * 0.6} ${x + 11 * k},124 Z`, fill: '#ff922b' }),
          svgEl('path', { d: `M${x - 6 * k},124 Q${x - 7 * k},${124 - h * 0.4} ${x},${124 - h * 0.65} Q${x + 7 * k},${124 - h * 0.4} ${x + 6 * k},124 Z`, fill: '#ffd43b' }),
        ])));
      case 'arco-iris':
        return svgEl('g', { fill: 'none', 'stroke-width': 3.5 }, [['#ff6b6b', 34], ['#ffd43b', 30], ['#3ddc97', 26], ['#4dabf7', 22]]
          .map(([c, r]) => svgEl('path', { d: `M${50 - r},40 A${r},${r} 0 0 1 ${50 + r},40`, stroke: c })));
      case 'coracoes':
        return svgEl('g', {}, [[17, 34, 1.1], [83, 28, 1.2], [14, 76, 0.9], [86, 70, 1]]
          .map(([x, y, s]) => svgEl('path', { d: heartPath(x, y, s), fill: '#f783ac' })));
      default:
        return null;
    }
  }

  // --- Animal de estimação (à direita do boneco, em x 100..140) ------------------------------
  function pet(id) {
    switch (id) {
      case 'cao':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M108,108 Q103,100 106,96', fill: 'none', stroke: '#8d5a2b', 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
          svgEl('path', { d: 'M111,116 L111,124 M116,117 L116,124 M124,117 L124,124 M129,116 L129,124', stroke: '#8d5a2b', 'stroke-width': 3, 'stroke-linecap': 'round' }),
          svgEl('ellipse', { cx: 120, cy: 111, rx: 13, ry: 7.5, fill: '#c49a6c' }),
          svgEl('circle', { cx: 132, cy: 101, r: 7, fill: '#c49a6c' }),
          svgEl('ellipse', { cx: 128, cy: 99, rx: 2.6, ry: 5, fill: '#8d5a2b', transform: 'rotate(20 128 99)' }),
          svgEl('circle', { cx: 134, cy: 99.5, r: 1.2, fill: '#212529' }),
          svgEl('circle', { cx: 138.5, cy: 103, r: 1.5, fill: '#212529' }),
        ]);
      case 'gato':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M108,114 Q100,104 106,94', fill: 'none', stroke: '#e8590c', 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
          svgEl('path', { d: 'M113,118 L113,124 M127,118 L127,124', stroke: '#e8590c', 'stroke-width': 3, 'stroke-linecap': 'round' }),
          svgEl('ellipse', { cx: 120, cy: 114, rx: 11, ry: 7, fill: '#ff922b' }),
          svgEl('circle', { cx: 130, cy: 103, r: 6.5, fill: '#ff922b' }),
          svgEl('path', { d: 'M125,99 L126,92 L130,97 M131,97 L135,92 L135.5,99', fill: '#ff922b', stroke: '#e8590c', 'stroke-width': 1, 'stroke-linejoin': 'round' }),
          svgEl('circle', { cx: 128, cy: 102.5, r: 1, fill: '#212529' }),
          svgEl('circle', { cx: 133, cy: 102.5, r: 1, fill: '#212529' }),
        ]);
      case 'papagaio':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M116,112 L112,124 L118,118 Z', fill: '#1c7ed6' }),
          svgEl('ellipse', { cx: 121, cy: 106, rx: 7, ry: 11, fill: '#2f9e44' }),
          svgEl('ellipse', { cx: 118, cy: 107, rx: 3.5, ry: 7, fill: '#237032' }),
          svgEl('circle', { cx: 123, cy: 93, r: 6.5, fill: '#e03131' }),
          svgEl('path', { d: 'M128,92 Q133,94 129,98 Z', fill: '#ffd43b', stroke: '#c98a00', 'stroke-width': 0.6 }),
          svgEl('circle', { cx: 125, cy: 91.5, r: 1.2, fill: '#212529' }),
          svgEl('path', { d: 'M119,117 L119,124 M123,117 L123,124', stroke: '#868e96', 'stroke-width': 1.5 }),
        ]);
      case 'tartaruga':
        return svgEl('g', {}, [
          svgEl('ellipse', { cx: 110, cy: 122, rx: 3, ry: 2.2, fill: '#82c91e' }),
          svgEl('ellipse', { cx: 128, cy: 122, rx: 3, ry: 2.2, fill: '#82c91e' }),
          svgEl('circle', { cx: 135, cy: 115, r: 4.2, fill: '#a9e34b', stroke: '#5c940d', 'stroke-width': 0.8 }),
          svgEl('circle', { cx: 136.5, cy: 114, r: 0.9, fill: '#212529' }),
          svgEl('path', { d: 'M105,121 Q106,105 119,105 Q132,105 133,121 Z', fill: '#2f9e44', stroke: '#1b5e20', 'stroke-width': 1.2 }),
          svgEl('path', { d: 'M113,108 L113,121 M119,105 L119,121 M125,108 L125,121 M107,114 L131,114', stroke: '#1b5e20', 'stroke-width': 0.8, opacity: 0.6 }),
        ]);
      default:
        return null;
    }
  }

  // --- Objetos de cada pose ------------------------------------------------------------------
  function propsBehind(pose) {
    if (pose === 'kart') {
      // Riscos de velocidade atrás do kart.
      return svgEl('path', { d: 'M2,96 L12,96 M0,104 L10,104 M4,112 L12,112', stroke: '#b3abdd', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.7 });
    }
    return null;
  }
  function propsFront(pose, small, kartColor = '#e03131') {
    switch (pose) {
      case 'arco':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M86,32 Q101,50 86,68', fill: 'none', stroke: '#8d5a2b', 'stroke-width': small ? 4 : 3, 'stroke-linecap': 'round' }),
          svgEl('path', { d: 'M86,32 L59,51 L86,68', fill: 'none', stroke: '#e9ecef', 'stroke-width': 1 }),
          svgEl('path', { d: 'M55,51 L97,50', stroke: '#495057', 'stroke-width': 1.8 }),
          svgEl('path', { d: 'M97,50 L91,47 L91,53 Z', fill: '#495057' }),
          small ? null : svgEl('path', { d: 'M55,51 L51,48 M55,51 L51,54', stroke: '#fa5252', 'stroke-width': 1.5 }),
        ]);
      case 'lancar':
        return svgEl('g', {}, [
          svgEl('circle', { cx: 75, cy: 95, r: 8, fill: '#364fc7', stroke: '#1c2a7a', 'stroke-width': 1.5 }),
          small ? null : svgEl('circle', { cx: 73, cy: 92, r: 1.3, fill: '#1c2a7a' }),
          small ? null : svgEl('circle', { cx: 77, cy: 91, r: 1.3, fill: '#1c2a7a' }),
        ]);
      case 'kart':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M14,92 L84,92 Q92,92 92,100 L92,104 Q92,110 86,110 L18,110 Q12,110 12,104 L12,96 Q12,92 16,92 Z', fill: kartColor, stroke: shade(kartColor, 0.45), 'stroke-width': 1.5 }),
          svgEl('rect', { x: 20, y: 98, width: 40, height: 4, rx: 2, fill: '#ffffff', opacity: 0.85 }),
          svgEl('path', { d: 'M70,90 L74,78', stroke: '#343a40', 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
          svgEl('ellipse', { cx: 73, cy: 76, rx: 6, ry: 2.5, fill: 'none', stroke: '#343a40', 'stroke-width': 2.5 }),
          svgEl('circle', { cx: 27, cy: 114, r: 8, fill: '#212529', stroke: '#000', 'stroke-width': 1 }),
          svgEl('circle', { cx: 77, cy: 114, r: 8, fill: '#212529', stroke: '#000', 'stroke-width': 1 }),
          small ? null : svgEl('circle', { cx: 27, cy: 114, r: 3, fill: '#adb5bd' }),
          small ? null : svgEl('circle', { cx: 77, cy: 114, r: 3, fill: '#adb5bd' }),
        ]);
      case 'dardo':
        // Dardo na mão, a apontar em frente (para a direita).
        return svgEl('g', {}, [
          svgEl('path', { d: 'M60,33 L84,30', stroke: '#adb5bd', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
          svgEl('path', { d: 'M84,30 L90,29.3', stroke: '#495057', 'stroke-width': 1.2, 'stroke-linecap': 'round' }),
          svgEl('path', { d: 'M60,33 L54,28 L57,33 L54,38 Z', fill: '#e03131' }),
        ]);
      case 'malha':
        // A malha (disco de metal) na mão.
        return svgEl('g', {}, [
          svgEl('ellipse', { cx: 83, cy: 86, rx: 7.5, ry: 3.8, fill: '#ced4da', stroke: '#495057', 'stroke-width': 1.2 }),
          small ? null : svgEl('ellipse', { cx: 83, cy: 85.5, rx: 3, ry: 1.4, fill: '#868e96' }),
        ]);
      case 'basquete':
        // A bola por cima da cabeça, entre as mãos.
        return svgEl('g', {}, [
          svgEl('circle', { cx: 51, cy: 9, r: 8.5, fill: '#f76707', stroke: '#7a2e00', 'stroke-width': 1.2 }),
          small ? null : svgEl('path', { d: 'M42.5,9 L59.5,9 M51,0.5 L51,17.5 M45,3 Q51,9 45,15 M57,3 Q51,9 57,15', fill: 'none', stroke: '#7a2e00', 'stroke-width': 0.9 }),
        ]);
      case 'golfe':
        // Taco de golfe (putter) das mãos até ao chão, e a bola ao lado da cabeça do taco.
        return svgEl('g', {}, [
          svgEl('path', { d: 'M55,82 L62,118', stroke: '#868e96', 'stroke-width': small ? 3 : 2.2, 'stroke-linecap': 'round' }),
          svgEl('rect', { x: 58, y: 116, width: 13, height: 5, rx: 2, fill: '#495057' }),
          svgEl('circle', { cx: 79, cy: 118, r: 4, fill: '#ffffff', stroke: '#adb5bd', 'stroke-width': 0.8 }),
        ]);
      case 'rematar':
        return svgEl('g', {}, [
          svgEl('circle', { cx: 88, cy: 112, r: 8, fill: '#ffffff', stroke: '#343a40', 'stroke-width': 1.5 }),
          svgEl('path', { d: 'M88,108 L91.5,110.5 L90,114.5 L86,114.5 L84.5,110.5 Z', fill: '#343a40' }),
          small ? null : svgEl('path', { d: 'M80,104 L74,100 M82,100 L78,94', stroke: '#b3abdd', 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
        ]);
      case 'festejar':
        return small ? null : svgEl('g', {}, [
          svgEl('rect', { x: 12, y: 14, width: 4, height: 4, fill: '#ffcb47', transform: 'rotate(20 14 16)' }),
          svgEl('rect', { x: 84, y: 12, width: 4, height: 4, fill: '#3ddc97', transform: 'rotate(-15 86 14)' }),
          svgEl('rect', { x: 88, y: 34, width: 3, height: 3, fill: '#f783ac' }),
          svgEl('rect', { x: 8, y: 38, width: 3, height: 3, fill: '#4dabf7' }),
        ]);
      default:
        return null;
    }
  }

  // --- Cara desenhada (centro da cabeça em 0,0; raio ~15) ------------------------------------
  // A expressão muda com a pose (o estilo escolhido mantém-se): contente ao festejar, triste ou
  // chocada na derrota, concentrada antes de lançar.
  // Cor dos traços (olhos, boca, sobrancelhas). Na pele escura fica quase preta e um pouco
  // mais grossa, para se ver bem (é escolhida no início de cada face()).
  let INK = '#2b1d14';
  let INK_BOOST = 0;
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  };
  const ACTION_POSES = new Set(['arco', 'lancar', 'kart', 'rematar', 'dardo', 'golfe', 'malha', 'malha_solto', 'basquete']);
  // Chapéus que tapam o alto da cabeça (escondem o carrapito e as pontas do moicano).
  const HAT_COVERS = new Set(['bone', 'capacete', 'gorro', 'cowboy', 'coroa', 'coroa_dourada']);
  function expressionOf(pose, ch) {
    if (pose === 'festejar' || pose === 'kart_festejar') return 'feliz';
    if (pose === 'triste' || pose === 'kart_triste') return ch.lose === 'cair' ? 'chocado' : 'triste';
    if (ACTION_POSES.has(pose)) return 'concentrado';
    return 'neutro';
  }

  // Cabelo de trás (por trás da cabeça): comprido, rabo-de-cavalo e tranças.
  function hairBack(id, color, dark) {
    const stroke = { fill: color, stroke: dark, 'stroke-width': 0.8, 'stroke-linejoin': 'round' };
    switch (id) {
      case 'comprido':
        return svgEl('path', { d: 'M-16.5,-4 Q-18.5,-19.5 0,-20 Q18.5,-19.5 16.5,-4 L17.5,19 Q13,24 9.5,19.5 L10.5,4 Q0,8 -10.5,4 L-9.5,19.5 Q-13,24 -17.5,19 Z', ...stroke });
      case 'rabo':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M9,-13 Q23,-11 22,5 Q21,16 15,21 Q17,8 10,-3 Z', ...stroke }),
          svgEl('circle', { cx: 12.5, cy: -9.5, r: 2.2, fill: dark }),
        ]);
      case 'trancas':
        return svgEl('g', {}, [-1, 1].flatMap((side) => [0, 1, 2, 3, 4].map((k) => svgEl('ellipse', {
          cx: side * (14 + k * 0.4), cy: 0 + k * 4.6, rx: 2.9, ry: 2.6, ...stroke,
        }))));
      default:
        return null;
    }
  }
  // Cabelo da frente (por cima da testa).
  function hairFront(id, color, dark, hatCovers, small) {
    const st = { fill: color, stroke: dark, 'stroke-width': 0.8, 'stroke-linejoin': 'round' };
    const cap = () => svgEl('path', { d: 'M-15.2,-1 Q-16.5,-17.5 0,-17.8 Q16.5,-17.5 15.2,-1 Q13,-9 6,-11.5 Q0,-13 -6,-11.5 Q-13,-9 -15.2,-1 Z', ...st });
    switch (id) {
      case 'careca':
        return small ? null : svgEl('ellipse', { cx: -5, cy: -10, rx: 3, ry: 1.6, fill: '#fff', opacity: 0.3, transform: 'rotate(-20 -5 -10)' });
      case 'curto':
      case 'comprido':
      case 'trancas':
        return cap();
      case 'rapado':
        return svgEl('path', { d: 'M-14.6,-3 Q-15.5,-16.5 0,-16.8 Q15.5,-16.5 14.6,-3 Q12,-11 0,-12.8 Q-12,-11 -14.6,-3 Z', fill: color, opacity: 0.5 });
      case 'rabo':
        return svgEl('path', { d: 'M-15.2,-1 Q-16.5,-17.5 0,-17.8 Q16.5,-17.5 15.2,-1 Q12,-10 2,-12.5 Q-6,-13.5 -12,-8 Q-14,-5 -15.2,-1 Z', ...st });
      case 'carrapito':
        return svgEl('g', {}, [
          hatCovers ? null : svgEl('circle', { cx: 0, cy: -19, r: 5.6, ...st }),
          cap(),
        ]);
      case 'encaracolado': {
        const curls = [];
        const n = small ? 6 : 9;
        for (let i = 0; i < n; i++) {
          const a = Math.PI + (i * Math.PI) / (n - 1);
          curls.push(svgEl('circle', { cx: (Math.cos(a) * 15.5).toFixed(1), cy: (Math.sin(a) * 15 - 3).toFixed(1), r: small ? 5 : 4.4, ...st }));
        }
        return svgEl('g', {}, [svgEl('path', { d: 'M-15,-2 Q-16,-18 0,-18.5 Q16,-18 15,-2 Q12,-10 0,-11 Q-12,-10 -15,-2 Z', ...st }), ...curls]);
      }
      case 'moicano':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M-14.6,-3 Q-15.5,-16.5 0,-16.8 Q15.5,-16.5 14.6,-3 Q12,-11 0,-12.8 Q-12,-11 -14.6,-3 Z', fill: color, opacity: 0.3 }),
          svgEl('path', { d: hatCovers ? 'M-3.5,-11.5 L-3.8,-17.5 L3.8,-17.5 L3.5,-11.5 Z' : 'M-3.5,-11.5 L-5,-19 L-1.8,-17.5 L0,-25 L1.8,-17.5 L5,-19 L3.5,-11.5 Z', ...st }),
        ]);
      case 'franja':
        return svgEl('path', { d: 'M-15.2,-1 Q-16.5,-17.5 0,-17.8 Q16.5,-17.5 15.2,-1 L12.5,-5 L9.5,-2.5 L6.5,-6.5 L3.2,-3.5 L0,-7.5 L-3.2,-3.5 L-6.5,-6.5 L-9.5,-2.5 L-12.5,-5 Z', ...st });
      default:
        return null;
    }
  }

  // Um olho no estilo escolhido, com a expressão por cima (pálpebras, tamanho).
  function eye(style, x, side, expr, skin, small) {
    const y = -1.5;
    if (small) {
      if (style === 'estrelas') return svgEl('polygon', { points: starPath(x, y, 2.8), fill: '#ffd43b', stroke: '#e67700', 'stroke-width': 0.6 });
      if (style === 'sorridentes' || expr === 'feliz') return svgEl('path', { d: `M${x - 2.4},${y + 0.8} Q${x},${y - 2.4} ${x + 2.4},${y + 0.8}`, fill: 'none', stroke: INK, 'stroke-width': 1.8 + INK_BOOST, 'stroke-linecap': 'round' });
      // Branco à volta da pupila: lê-se em qualquer tom de pele, mesmo em ponto pequeno.
      return svgEl('g', {}, [svgEl('circle', { cx: x, cy: y, r: 2.6, fill: '#fff' }), svgEl('circle', { cx: x, cy: y + 0.2, r: 1.6, fill: INK })]);
    }
    const parts = [];
    const closedArc = (down) => svgEl('path', {
      d: down ? `M${x - 2.6},${y} Q${x},${y + 2} ${x + 2.6},${y}` : `M${x - 2.6},${y + 0.8} Q${x},${y - 2.4} ${x + 2.6},${y + 0.8}`,
      fill: 'none', stroke: INK, 'stroke-width': 1.4 + INK_BOOST, 'stroke-linecap': 'round',
    });
    const open = (rx, ry, pr, cy = y) => [
      svgEl('ellipse', { cx: x, cy, rx, ry, fill: '#fff', stroke: INK, 'stroke-width': 0.5 }),
      svgEl('circle', { cx: x + 0.2, cy: cy + 0.3, r: pr, fill: INK }),
      svgEl('circle', { cx: x + 0.2 + pr * 0.35, cy: cy + 0.3 - pr * 0.4, r: Math.max(0.4, pr * 0.32), fill: '#fff' }),
    ];
    let lid = 0; // altura da pálpebra de cima (0 = aberto)
    switch (style) {
      case 'sorridentes': parts.push(closedArc(false)); break;
      case 'piscar': parts.push(side > 0 ? closedArc(true) : null, ...(side > 0 ? [] : open(2.4, 2.9, 1.4))); break;
      case 'estrelas': parts.push(svgEl('polygon', { points: starPath(x, y, 3.3), fill: '#ffd43b', stroke: '#e67700', 'stroke-width': 0.6 })); break;
      case 'grandes': parts.push(...open(3.4, 3.6, 2)); break;
      case 'sonolentos': parts.push(...open(2.5, 2.3, 1.3, y + 0.5)); lid = 2.3; break;
      default: parts.push(...open(2.4, 2.9, 1.4));
    }
    const isOpen = style === 'normais' || style === 'grandes' || style === 'sonolentos' || (style === 'piscar' && side < 0);
    if (isOpen) {
      if (expr === 'concentrado') lid = Math.max(lid, 2.6);
      if (expr === 'triste') lid = Math.max(lid, 1.6);
      if (lid) {
        // Pálpebra de cima (cor da pele, com o contorno), descaída para fora na tristeza.
        const tilt = expr === 'triste' ? side * 0.9 : 0;
        parts.push(svgEl('path', {
          d: `M${x - 4},${y - 4.2} L${x + 4},${y - 4.2} L${x + 4},${y - 4 + lid + tilt} L${x - 4},${y - 4 + lid - tilt} Z`,
          fill: skin,
        }), svgEl('path', { d: `M${x - 3},${y - 4 + lid - tilt * 0.75} L${x + 3},${y - 4 + lid + tilt * 0.75}`, stroke: INK, 'stroke-width': 0.9 + INK_BOOST, 'stroke-linecap': 'round' }));
      }
      // Olhos contentes: a bochecha sobe por baixo do olho.
      if (expr === 'feliz') parts.push(svgEl('path', { d: `M${x - 3.6},${y + 4} Q${x},${y + 0.6} ${x + 3.6},${y + 4} Z`, fill: skin }));
    }
    const g = svgEl('g', {}, parts.filter(Boolean));
    // Chocado: olhos maiores.
    if (expr === 'chocado' && isOpen) g.setAttribute('transform', `translate(${x} ${y}) scale(1.25) translate(${-x} ${-y})`);
    return g;
  }

  function brow(style, x, side, expr, color) {
    const by = -6.6;
    const w = style === 'grossas' ? 2.4 : style === 'zangadas' ? 1.7 : 1.3;
    const d = style === 'zangadas'
      ? `M${x - 2.8 * -side},${by + 1.2} L${x + 2.8 * -side},${by - 0.8}`
      : style === 'levantadas'
        ? `M${x - 2.6},${by - 0.8} Q${x},${by - 3.4} ${x + 2.6},${by - 0.8}`
        : `M${x - 2.6},${by + 0.4} Q${x},${by - 1.1} ${x + 2.6},${by + 0.4}`;
    // A expressão inclina e levanta as sobrancelhas (o estilo mantém-se).
    const angle = { triste: 14, concentrado: -12 }[expr] || 0;
    const dy = { chocado: -1.8, feliz: -0.6, triste: -0.4 }[expr] || 0;
    return svgEl('path', {
      d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round',
      transform: `translate(0 ${dy}) rotate(${(-side * angle).toFixed(0)} ${x} ${by})`,
    });
  }

  function mouth(style, expr, small) {
    let m = style;
    if (expr === 'feliz' && !['lingua', 'dentes', 'aberto'].includes(style)) m = 'aberto';
    if (expr === 'triste') m = 'triste';
    if (expr === 'chocado') m = 'chocado';
    if (expr === 'concentrado' && style !== 'lingua') m = 'concentrado';
    const line = (d, w = 1.4) => svgEl('path', { d, fill: 'none', stroke: INK, 'stroke-width': (small ? 2 : w) + INK_BOOST, 'stroke-linecap': 'round' });
    if (small) {
      if (m === 'aberto' || m === 'dentes' || m === 'lingua') return svgEl('path', { d: 'M-4.6,6 Q0,12.5 4.6,6 Z', fill: '#7a1f2b' });
      if (m === 'surpresa' || m === 'chocado') return svgEl('ellipse', { cx: 0, cy: 8, rx: 2.4, ry: 3, fill: '#7a1f2b' });
      if (m === 'triste') return line('M-3.8,9.4 Q0,6 3.8,9.4');
      if (m === 'serio' || m === 'concentrado') return line('M-3.2,7.6 L3.2,7.6');
      return line('M-4,6.4 Q0,10.4 4,6.4');
    }
    switch (m) {
      case 'aberto':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M-4.6,6 Q0,12.5 4.6,6 Z', fill: '#7a1f2b', stroke: INK, 'stroke-width': 0.8, 'stroke-linejoin': 'round' }),
          svgEl('ellipse', { cx: 0.6, cy: 9.4, rx: 2, ry: 1.1, fill: '#ff8787' }),
        ]);
      case 'lingua':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M-1.4,7.4 Q0.4,13 2.2,7.4 Z', fill: '#ff6b81', stroke: '#c92a2a', 'stroke-width': 0.5 }),
          line('M-4,6.4 Q0,9.6 4,6.4'),
        ]);
      case 'surpresa':
        return svgEl('ellipse', { cx: 0, cy: 8, rx: 2.2, ry: 2.8, fill: '#7a1f2b', stroke: INK, 'stroke-width': 0.6 });
      case 'chocado':
        return svgEl('ellipse', { cx: 0, cy: 8.4, rx: 2.8, ry: 3.6, fill: '#7a1f2b', stroke: INK, 'stroke-width': 0.6 });
      case 'serio':
        return line('M-3.4,7.6 L3.4,7.6');
      case 'triste':
        return line('M-3.8,9.4 Q0,6 3.8,9.4');
      case 'concentrado':
        return line('M-1.2,8 Q1.4,7.2 3.4,7.6', 1.3);
      case 'dentes':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M-4.6,6 Q0,11.6 4.6,6 Z', fill: '#fff', stroke: INK, 'stroke-width': 0.9, 'stroke-linejoin': 'round' }),
          svgEl('path', { d: 'M-4,7.2 L4,7.2 M-1.5,6.3 L-1.5,8.8 M1.5,6.3 L1.5,8.8', stroke: '#ced4da', 'stroke-width': 0.5 }),
        ]);
      default:
        return line('M-4,6.4 Q0,10 4,6.4');
    }
  }

  function facialHair(id, color, dark) {
    const st = { fill: color, stroke: dark, 'stroke-width': 0.6, 'stroke-linejoin': 'round' };
    const moustache = svgEl('path', { d: 'M-5,5.4 Q-2.5,3.4 0,4.8 Q2.5,3.4 5,5.4 Q2.5,6.6 0,5.8 Q-2.5,6.6 -5,5.4 Z', ...st });
    switch (id) {
      case 'bigode': return moustache;
      case 'barba-curta':
        return svgEl('g', {}, [svgEl('path', { d: 'M-13.5,1.5 Q-12.5,13.5 0,15.6 Q12.5,13.5 13.5,1.5 L11.4,3 Q10,10.4 0,11.8 Q-10,10.4 -11.4,3 Z', ...st, opacity: 0.92 }), moustache]);
      case 'barba-comprida':
        return svgEl('g', {}, [svgEl('path', { d: 'M-13.5,1.5 Q-14,18 0,25 Q14,18 13.5,1.5 L11.4,3 Q9.5,11.2 0,12.2 Q-9.5,11.2 -11.4,3 Z', ...st }), moustache]);
      default: return null;
    }
  }

  function faceExtra(id) {
    switch (id) {
      case 'sardas':
        return svgEl('g', { fill: '#a0522d', opacity: 0.7 }, [[-7.5, 3], [-9.5, 4.6], [-6, 5], [7.5, 3], [9.5, 4.6], [6, 5]]
          .map(([x, y]) => svgEl('circle', { cx: x, cy: y, r: 0.6 })));
      case 'bochechas':
        return svgEl('g', { fill: '#ff8787', opacity: 0.45 }, [-1, 1].map((s) => svgEl('ellipse', { cx: s * 8.6, cy: 4.4, rx: 2.8, ry: 1.7 })));
      case 'oculos-redondos':
      case 'oculos-quadrados': {
        const round = id === 'oculos-redondos';
        const lens = (x) => (round
          ? svgEl('circle', { cx: x, cy: -1.5, r: 3.9 })
          : svgEl('rect', { x: x - 4, y: -4.6, width: 8, height: 6.4, rx: 1.3 }));
        return svgEl('g', { fill: 'rgba(255,255,255,.18)', stroke: '#343a40', 'stroke-width': 1.1 }, [
          lens(-5.5), lens(5.5),
          svgEl('path', { d: 'M-1.6,-1.8 Q0,-3 1.6,-1.8 M-9.4,-2 L-14.2,-3 M9.4,-2 L14.2,-3', fill: 'none' }),
        ]);
      }
      case 'pala':
        return svgEl('g', {}, [
          svgEl('path', { d: 'M-14.6,-7.5 L2.2,-3.6 M9,-2.4 L14.6,-1.2', stroke: INK, 'stroke-width': 1 }),
          svgEl('ellipse', { cx: 5.6, cy: -1.4, rx: 3.8, ry: 3.3, fill: INK }),
        ]);
      default:
        return null;
    }
  }

  // Cara completa: cabelo de trás, orelhas, cabeça, bochechas, olhos, sobrancelhas, nariz,
  // boca, pelos faciais, cabelo da frente e extras (óculos, pala). Versão pequena (muitos
  // jogadores no ecrã): só a pele, o cabelo, os olhos e a boca.
  function face(ch, expr = 'neutro', small = false) {
    const skin = ch.skin;
    const darkSkin = lum(skin) < 0.42;
    INK = darkSkin ? '#0b0604' : '#2b1d14';
    INK_BOOST = darkSkin ? 0.4 : 0;
    const skinDark = shade(skin, darkSkin ? 0.4 : 0.28);
    const hairDark = shade(ch.hairColor, 0.35);
    const browColor = darkSkin && lum(ch.hairColor) < 0.35 ? INK : hairDark;
    const hatCovers = HAT_COVERS.has(ch.hat);
    const head = ch.face === 'oval'
      ? svgEl('ellipse', { cx: 0, cy: 0.5, rx: 13.6, ry: 16, fill: skin, stroke: skinDark, 'stroke-width': 1 })
      : ch.face === 'quadrada'
        ? svgEl('rect', { x: -14, y: -14.5, width: 28, height: 30, rx: 8, fill: skin, stroke: skinDark, 'stroke-width': 1 })
        : svgEl('circle', { cx: 0, cy: 0, r: 15, fill: skin, stroke: skinDark, 'stroke-width': 1 });
    const parts = [
      hairBack(ch.hair, ch.hairColor, hairDark),
      small ? null : svgEl('circle', { cx: -14.2, cy: 1.5, r: 3.2, fill: skin, stroke: skinDark, 'stroke-width': 0.9 }),
      small ? null : svgEl('circle', { cx: 14.2, cy: 1.5, r: 3.2, fill: skin, stroke: skinDark, 'stroke-width': 0.9 }),
      head,
      small || !['sardas', 'bochechas'].includes(ch.faceExtra) ? null : faceExtra(ch.faceExtra),
      small ? null : brow(ch.brows, -5.5, -1, expr, browColor),
      small ? null : brow(ch.brows, 5.5, 1, expr, browColor),
      eye(ch.eyes, -5.5, -1, expr, skin, small),
      eye(ch.eyes, 5.5, 1, expr, skin, small),
      small ? null : svgEl('path', { d: 'M-1.2,2.4 Q0,3.8 1.2,2.4', fill: 'none', stroke: skinDark, 'stroke-width': 1.1, 'stroke-linecap': 'round' }),
      mouth(ch.mouth, expr, small),
      facialHair(ch.facial, ch.hairColor, hairDark),
      hairFront(ch.hair, ch.hairColor, hairDark, hatCovers, small),
      small || ['sardas', 'bochechas', 'nenhum'].includes(ch.faceExtra) ? null : faceExtra(ch.faceExtra),
    ];
    return svgEl('g', { class: 'char-face' }, parts.filter(Boolean));
  }

  // Retrato (cabeça e ombros) num círculo com a cor do jogador: o avatar das listas e as
  // marcas dos temas. É a ÚNICA função que desenha o retrato. Abaixo de ~30 px, a cara simples.
  let portraitId = 0;
  function drawPortrait(player, { size = 40, small = size < 30 } = {}) {
    const ch = (Options && Options.cleanCharacter(player.character || {}, Options.DEFAULT_CHARACTER)) || Options.DEFAULT_CHARACTER;
    const outfit = ch.outfit || player.color || '#4dabf7';
    const svg = svgEl('svg', { viewBox: '0 0 40 40', width: size, height: size, class: 'portrait', 'aria-hidden': 'true' });
    const head = svgEl('g', { transform: 'translate(20 20.5) scale(0.78)' }, [face(ch, 'neutro', small), hat(ch.hat, outfit, small)]);
    svg.append(
      svgEl('circle', { cx: 20, cy: 20, r: 20, fill: player.color || outfit }),
      svgEl('circle', { cx: 14, cy: 11, r: 14, fill: '#fff', opacity: 0.18 }),
    );
    if (small) {
      // Pequeno (marcas dos temas, que se mexem): sem recorte, que é o que pesa a animar com
      // muitos jogadores. Os ombros já são desenhados dentro do círculo.
      svg.append(svgEl('path', { d: 'M4,32 Q20,28 36,32 A20,20 0 0 1 4,32 Z', fill: outfit }), head);
      return svg;
    }
    // Grande (listas): recortado no círculo (o chapéu não sai da moldura).
    const id = `portrait-${++portraitId}`;
    svg.append(
      svgEl('defs', {}, [svgEl('clipPath', { id }, [svgEl('circle', { cx: 20, cy: 20, r: 20 })])]),
      svgEl('g', { 'clip-path': `url(#${id})` }, [
        svgEl('path', { d: 'M3,42 Q5,33.2 20,32.6 Q35,33.2 37,42 Z', fill: outfit, stroke: shade(outfit, 0.35), 'stroke-width': 1 }),
        head,
      ]),
    );
    return svg;
  }

  // Só a cara (com o chapéu), numa expressão: 'neutro' | 'feliz' | 'triste' | 'chocado' |
  // 'concentrado'. Para a página de desenvolvimento.
  const EXPRESSIONS = ['neutro', 'feliz', 'triste', 'chocado', 'concentrado'];
  function drawFace(player, expr = 'neutro', { size = 60, small = false } = {}) {
    const ch = (Options && Options.cleanCharacter(player.character || {}, Options.DEFAULT_CHARACTER)) || Options.DEFAULT_CHARACTER;
    const svg = svgEl('svg', { viewBox: '-22 -30 44 56', width: Math.round(size * (44 / 56)), height: size, overflow: 'visible', 'aria-hidden': 'true' });
    svg.append(face(ch, expr, small), hat(ch.hat, ch.outfit || player.color || '#4dabf7', small));
    return svg;
  }

  // Lágrimas (reação "chorar"): caem algumas vezes e param.
  function tears(head) {
    const [hx, hy] = head;
    return svgEl('g', { class: 'char-tears' }, [
      svgEl('path', { d: `M${hx - 7},${hy + 4} q2.5,4 0,6 q-2.5,-2 0,-6 Z`, fill: '#74c0fc' }),
      svgEl('path', { d: `M${hx + 6},${hy + 5} q2.5,4 0,6 q-2.5,-2 0,-6 Z`, fill: '#74c0fc', class: 'second' }),
    ]);
  }

  function drawCharacter(player, pose = 'parado', { size = 120, small = false, title = null, kartColor = '#e03131', withPet = false } = {}) {
    const requested = POSES[pose] ? pose : 'parado';
    const ch = (Options && Options.cleanCharacter(player.character || {}, Options.DEFAULT_CHARACTER))
      || { ...(Options ? Options.DEFAULT_CHARACTER : {}), outfit: null, hat: 'nenhum', extra: 'nenhum' };

    // Festejo e reação escolhidos pelo jogador (também no kart, sem sair dele).
    let p = requested;
    let g = POSES[p];
    let anim = null;
    if (requested === 'festejar') {
      p = WIN_POSE[ch.win] || 'festejar';
      g = POSES[p];
      anim = `win-${ch.win}`;
    } else if (requested === 'triste') {
      p = LOSE_POSE[ch.lose] || 'triste';
      g = POSES[p];
      anim = `lose-${ch.lose}`;
    } else if (requested === 'kart_festejar') {
      if (ch.win === 'siuuu' || ch.win === 'robo') g = { ...g, ...seatedArms(WIN_POSE[ch.win]) };
      anim = ch.win === 'pular' ? 'win-pular' : 'win-kart';
    } else if (requested === 'kart_triste') {
      if (ch.lose === 'ombros') g = { ...g, ...seatedArms('ombros') };
      anim = ch.lose === 'chorar' ? 'lose-chorar' : null;
    }
    const mood = g.mood || null; // 'festejar' | 'triste' | null

    const outfit = ch.outfit || player.color || '#4dabf7';
    const outfitDark = shade(outfit, 0.35);
    const limb = small ? 9 : 7;
    const extra = small ? 'nenhum' : ch.extra; // a versão pequena não tem extras
    const showPet = withPet && !small && ch.pet && ch.pet !== 'nenhum';
    const vw = showPet ? W + PET_W : W;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${vw} ${H}`,
      width: Math.round(size * (vw / H)),
      height: size,
      overflow: 'visible', // o pulo e o balão podem sair um pouco da caixa
      class: ['character', `pose-${requested}`, small ? 'small' : '', anim || '', mood === 'festejar' ? 'celebrating' : ''].filter(Boolean).join(' '),
      role: title ? 'img' : null,
      'aria-hidden': title ? null : 'true',
    });
    if (title) svg.append(svgEl('title', {}, [document.createTextNode(title)]));

    // Sombra no chão (não no kart, que já tem rodas) e o animal ao lado.
    if (!g.seated) svg.append(svgEl('ellipse', { cx: 50, cy: 124, rx: 24, ry: 4, fill: '#000', opacity: 0.25 }));
    if (showPet) svg.append(svgEl('g', { class: 'char-pet' }, [pet(ch.pet)]));

    // Tudo o que se mexe nas animações de festejo/reação fica dentro de .char-body.
    const body = svgEl('g', { class: 'char-body' });
    svg.append(body);

    // Aura: discreta normalmente; forte ao festejar. Na versão pequena, só ao festejar.
    if (ch.aura !== 'nenhuma' && (!small || mood === 'festejar')) {
      const a = aura(ch.aura);
      if (a) body.append(svgEl('g', { class: 'char-aura', opacity: mood === 'festejar' ? 0.95 : 0.4 }, [a]));
    }
    body.append(...[propsBehind(p), extraBehind(extra, p, outfit)].filter(Boolean));

    // Pernas (calças e sapatilhas, nas cores escolhidas).
    for (const leg of [g.legL, g.legR]) {
      body.append(poly(leg, { stroke: ch.pants, 'stroke-width': limb + 1 }));
      if (!g.seated) body.append(svgEl('ellipse', { cx: leg[2][0] + 2, cy: leg[2][1] + 1, rx: small ? 5.5 : 5, ry: 3, fill: ch.shoes, stroke: 'rgba(0,0,0,.35)', 'stroke-width': 0.6 }));
    }

    // Pescoço (por trás do tronco e da cabeça).
    const top = g.seated ? 52 : 48;
    const bottom = g.seated ? 88 : 84;
    body.append(svgEl('rect', { x: g.head[0] - 3.5, y: g.head[1] + 11, width: 7, height: top - g.head[1] - 9, rx: 2, fill: ch.skin, stroke: shade(ch.skin, 0.25), 'stroke-width': 0.8 }));

    // Tronco (camisola na cor da roupa, com o padrão escolhido).
    body.append(svgEl('path', {
      d: `M38,${top + 4} Q38,${top} 44,${top} L56,${top} Q62,${top} 62,${top + 4} L59,${bottom} Q50,${bottom + 3} 41,${bottom} Z`,
      fill: outfit, stroke: outfitDark, 'stroke-width': 1.5, 'stroke-linejoin': 'round',
    }));
    const pat = pattern(ch.pattern, top, outfit, ch.number, small);
    if (pat) body.append(pat);
    else if (!small) body.append(svgEl('path', { d: `M44,${top + 3} Q50,${top + 8} 56,${top + 3}`, fill: 'none', stroke: outfitDark, 'stroke-width': 1.2, opacity: 0.7 }));

    // Kart à frente das pernas e do tronco; braços por cima (ao volante).
    if (g.kart) body.append(propsFront('kart', small, kartColor));

    // Braços (mangas na cor da roupa) e mãos.
    for (const arm of [g.armL, g.armR]) {
      body.append(poly(arm, { stroke: outfit, 'stroke-width': limb }));
      body.append(poly(arm, { stroke: outfitDark, 'stroke-width': 1, opacity: 0.25 }));
      if (!small) body.append(svgEl('circle', { cx: arm[2][0], cy: arm[2][1], r: 3.6, fill: ch.skin, stroke: shade(ch.skin, 0.25), 'stroke-width': 0.8 }));
    }

    // Objetos da pose (no kart, os confetis do festejo). Nas poses de mãos livres, o objeto
    // escolhido para a mão.
    const front = g.kart ? (g.mood === 'festejar' ? propsFront('festejar', small) : null) : propsFront(p === 'festejar' || p === 'siuuu' || p === 'robo' ? 'festejar' : p, small);
    if (front) body.append(front);
    if (g.free && !small && ch.hand !== 'nenhum') {
      const item = handItem(ch.hand, g, outfit, ch.scarf);
      if (item) body.append(svgEl('g', { class: 'char-hand' }, [item]));
    }
    const scarf = extraFront(extra);
    if (scarf) body.append(scarf);

    // Cabeça = a cara desenhada, com a expressão da pose e o chapéu/acessório por cima
    // (inclinam juntos). Os chapéus ficam acima dos olhos e o cabelo comprido aparece por baixo.
    const [hx, hy, tilt] = g.head;
    body.append(svgEl('g', { transform: `translate(${hx} ${hy}) rotate(${tilt})` }, [
      face(ch, expressionOf(requested, ch), small),
      hat(ch.hat, outfit, small),
    ]));
    // Lágrimas: na reação "chorar" (também no kart).
    if (mood === 'triste' && ch.lose === 'chorar' && !small) body.append(tears(g.head));
    return svg;
  }

  root.drawCharacter = drawCharacter;
  root.drawPortrait = drawPortrait;
  root.drawFace = drawFace;
  root.FACE_EXPRESSIONS = EXPRESSIONS;
})(window);
