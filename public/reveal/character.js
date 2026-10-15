'use strict';

// Boneco de cada jogador, desenhado em SVG com peças simples. É a ÚNICA forma de desenhar o
// boneco: os temas de revelação só escolhem a pose, nunca o desenham por conta própria.
//
//   drawCharacter(player, pose, { size, small, title, kartColor, withPet })
//     player: { emoji, color, character } (peças em public/reveal/character-options.js; as que
//             faltarem ficam com o valor por omissão)
//     pose:   'parado' | 'arco' | 'lancar' | 'kart' | 'rematar' | 'dardo' | 'golfe'
//             | 'festejar' | 'triste'
//             | 'kart_festejar' | 'kart_triste' (no kart, no fim da corrida)
//             "festejar" e "triste" desenham a animação de vitória e a reação de derrota que o
//             jogador escolheu (pular, rodopiar, siuuu, dança robô, braços no ar; chorar,
//             encolher os ombros, cair para trás). As animações são CSS, correm algumas vezes
//             e param (nunca para sempre); com movimento reduzido, nem começam.
//     size:   altura em px (a largura é ~0,77 da altura; ~1,08 com o animal)
//     small:  versão simplificada (traços mais grossos, sem extras, objeto na mão, número da
//             camisola, nem pormenores), para quando há muitos jogadores no ecrã. A cor, o
//             emoji, o chapéu e o padrão da camisola continuam lá, para se reconhecer.
//     kartColor: cor do kart nas poses de kart (por omissão, vermelho)
//     withPet: desenha o animal de estimação ao lado (o desenho fica mais largo); só onde
//             couber (editor, ecrã final, festejos em grande).
//   Devolve um <svg class="character pose-…">.
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 100;
  const H = 130;
  const PET_W = 40; // largura extra com o animal
  const SKIN = '#ffd8a8';
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
          // Só a calote, acima dos olhos (não tapa a cara do emoji), com uma risca ao meio.
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

    // Tronco (camisola na cor da roupa, com o padrão escolhido).
    const top = g.seated ? 52 : 48;
    const bottom = g.seated ? 88 : 84;
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
      if (!small) body.append(svgEl('circle', { cx: arm[2][0], cy: arm[2][1], r: 3.6, fill: SKIN, stroke: '#e0a96d', 'stroke-width': 0.8 }));
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

    // Cabeça = emoji do jogador, com o chapéu/acessório por cima (inclinam juntos).
    const [hx, hy, tilt] = g.head;
    // Os chapéus ficam acima dos olhos, para nunca taparem a cara do emoji.
    body.append(svgEl('g', { transform: `translate(${hx} ${hy}) rotate(${tilt})` }, [
      svgEl('text', {
        x: 0, y: 1, 'font-size': 31, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        style: 'font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
      }, [document.createTextNode(player.emoji || '🙂')]),
      hat(ch.hat, outfit, small),
    ]));
    // Lágrimas: na reação "chorar" (também no kart).
    if (mood === 'triste' && ch.lose === 'chorar' && !small) body.append(tears(g.head));
    return svg;
  }

  root.drawCharacter = drawCharacter;
})(window);
