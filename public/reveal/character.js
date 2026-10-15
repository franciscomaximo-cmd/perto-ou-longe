'use strict';

// Boneco de cada jogador, desenhado em SVG com peças simples. É a ÚNICA forma de desenhar o
// boneco: os temas de revelação só escolhem a pose, nunca o desenham por conta própria.
//
//   drawCharacter(player, pose, { size, small, title })
//     player: { emoji, color, character: { outfit, hat, extra } }
//     pose:   'parado' | 'arco' | 'lancar' | 'kart' | 'rematar' | 'festejar' | 'triste'
//             | 'kart_festejar' | 'kart_triste' (no kart, no fim da corrida)
//     size:   altura em px (a largura é ~0,77 da altura)
//     small:  versão simplificada (traços mais grossos, sem extras nem pormenores), para quando
//             há muitos jogadores no ecrã
//     kartColor: cor do kart na pose "kart" (por omissão, vermelho)
//   Devolve um <svg class="character pose-…">.
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 100;
  const H = 130;
  const SKIN = '#ffd8a8';
  const TROUSERS = '#2b2a4a';
  const SHOES = '#15142a';

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

  // Articulações de cada pose: ombro → cotovelo → mão; anca → joelho → pé.
  // head: centro da cabeça e inclinação (graus); o boneco olha para a direita nas poses de ação.
  const POSES = {
    parado: {
      head: [50, 30, 0],
      armL: [[39, 54], [34, 68], [33, 81]], armR: [[61, 54], [66, 68], [67, 81]],
      legL: [[45, 82], [44, 102], [43, 121]], legR: [[55, 82], [56, 102], [57, 121]],
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
    rematar: {
      head: [48, 30, -6],
      armL: [[39, 54], [30, 58], [21, 64]], armR: [[61, 54], [69, 46], [77, 40]],
      legL: [[45, 82], [44, 101], [42, 121]], legR: [[55, 82], [68, 93], [80, 106]],
    },
    festejar: {
      head: [50, 30, 0],
      armL: [[39, 54], [31, 40], [27, 26]], armR: [[61, 54], [69, 40], [73, 26]],
      legL: [[45, 82], [41, 101], [38, 121]], legR: [[55, 82], [59, 101], [62, 121]],
    },
    triste: {
      head: [49, 34, -16],
      armL: [[40, 56], [38, 71], [39, 85]], armR: [[60, 56], [62, 71], [61, 85]],
      legL: [[46, 82], [46, 102], [46, 121]], legR: [[54, 82], [54, 102], [54, 121]],
    },
  };

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
  function extraFront(id, outfit) {
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

  // --- Objetos de cada pose ------------------------------------------------------------------
  function propsBehind(pose) {
    if (pose === 'kart') {
      // Riscos de velocidade atrás do kart.
      return svgEl('path', { d: 'M2,96 L12,96 M0,104 L10,104 M4,112 L12,112', stroke: '#b3abdd', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.7 });
    }
    return null;
  }
  function propsFront(pose, outfit, small, kartColor = '#e03131') {
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
      case 'triste':
        return small ? null : svgEl('path', { d: 'M62,38 Q65,43 62,45 Q59,43 62,38 Z', fill: '#74c0fc' });
      default:
        return null;
    }
  }

  function drawCharacter(player, pose = 'parado', { size = 120, small = false, title = null, kartColor = '#e03131' } = {}) {
    const p = POSES[pose] ? pose : 'parado';
    const g = POSES[p];
    const ch = { outfit: null, hat: 'nenhum', extra: 'nenhum', ...(player.character || {}) };
    const outfit = ch.outfit || player.color || '#4dabf7';
    const outfitDark = shade(outfit, 0.35);
    const limb = small ? 9 : 7;
    const extra = small ? 'nenhum' : ch.extra; // a versão pequena não tem extras

    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`,
      width: Math.round(size * (W / H)),
      height: size,
      class: `character pose-${p}${small ? ' small' : ''}`,
      role: title ? 'img' : null,
      'aria-hidden': title ? null : 'true',
    });
    if (title) svg.append(svgEl('title', {}, [document.createTextNode(title)]));

    // Sombra no chão (não no kart, que já tem rodas).
    if (!g.seated) svg.append(svgEl('ellipse', { cx: 50, cy: 124, rx: 24, ry: 4, fill: '#000', opacity: 0.25 }));
    svg.append(...[propsBehind(p), extraBehind(extra, p, outfit)].filter(Boolean));

    // Pernas (calças e sapatos).
    for (const leg of [g.legL, g.legR]) {
      svg.append(poly(leg, { stroke: TROUSERS, 'stroke-width': limb + 1 }));
      if (!g.seated) svg.append(svgEl('ellipse', { cx: leg[2][0] + 2, cy: leg[2][1] + 1, rx: small ? 5.5 : 5, ry: 3, fill: SHOES }));
    }

    // Tronco (na cor da roupa).
    const top = g.seated ? 52 : 48;
    const bottom = g.seated ? 88 : 84;
    svg.append(svgEl('path', {
      d: `M38,${top + 4} Q38,${top} 44,${top} L56,${top} Q62,${top} 62,${top + 4} L59,${bottom} Q50,${bottom + 3} 41,${bottom} Z`,
      fill: outfit, stroke: outfitDark, 'stroke-width': 1.5, 'stroke-linejoin': 'round',
    }));
    if (!small) svg.append(svgEl('path', { d: `M44,${top + 3} Q50,${top + 8} 56,${top + 3}`, fill: 'none', stroke: outfitDark, 'stroke-width': 1.2, opacity: 0.7 }));

    // Kart à frente das pernas e do tronco; braços por cima (ao volante).
    if (g.kart) svg.append(propsFront('kart', outfit, small, kartColor));

    // Braços (mangas na cor da roupa) e mãos.
    for (const arm of [g.armL, g.armR]) {
      svg.append(poly(arm, { stroke: outfit, 'stroke-width': limb }));
      svg.append(poly(arm, { stroke: outfitDark, 'stroke-width': 1, opacity: 0.25 }));
      if (!small) svg.append(svgEl('circle', { cx: arm[2][0], cy: arm[2][1], r: 3.6, fill: SKIN, stroke: '#e0a96d', 'stroke-width': 0.8 }));
    }

    // Objetos da pose (no kart, só os da "emoção": confetti ou lágrima).
    const front = g.kart ? (g.mood ? propsFront(g.mood, outfit, small) : null) : propsFront(p, outfit, small);
    if (front) svg.append(front);
    const scarf = extraFront(extra, outfit);
    if (scarf) svg.append(scarf);

    // Cabeça = emoji do jogador, com o chapéu/acessório por cima (inclinam juntos).
    const [hx, hy, tilt] = g.head;
    // Os chapéus ficam acima dos olhos, para nunca taparem a cara do emoji.
    const head = svgEl('g', { transform: `translate(${hx} ${hy}) rotate(${tilt})` }, [
      svgEl('text', {
        x: 0, y: 1, 'font-size': 31, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        style: 'font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
      }, [document.createTextNode(player.emoji || '🙂')]),
      hat(ch.hat, outfit, small),
    ]);
    svg.append(head);
    return svg;
  }

  root.drawCharacter = drawCharacter;
})(window);
