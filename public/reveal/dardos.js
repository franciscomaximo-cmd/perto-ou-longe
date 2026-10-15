'use strict';

// Tema "dardos": um alvo de dardos clássico numa parede de bar e, em baixo, a fila de
// jogadores (os bonecos na pose "a lançar dardo"). Na vez de cada um, o seu boneco lança e o
// dardo voa até à parede. Onde acerta vem da posição de apresentação (player.show), relativa à
// ronda:
//   - o vencedor acerta no centro (bullseye); o "em cheio" com um dardo dourado a vibrar;
//   - os outros acertam mais perto ou mais longe do centro, pela posição na ronda;
//   - quem errou mais de 100% falha o alvo e o dardo fica espetado na parede;
//   - o "mais longe" falha e acerta no quadro torto pendurado ao lado (com humor).
//
// Cena SVG de tamanho fixo (viewBox 300 × 270; 300 × 330 com mais de 6 jogadores, com duas
// filas), por zonas, para nada tapar o que importa:
//   - placa da resposta certa, no topo (nenhum dardo cai lá);
//   - alvo a meio, com a parede à volta (falhanços nas laterais) e o quadro à direita;
//   - chão de madeira e a fila de jogadores, em baixo.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const VW = 300;
  const VH = 270;
  const VH_TALL = 330;
  const BOARD = { x: 150, y: 110, r: 52, rim: 68 }; // r = zona com pontos; rim = anel dos números
  const FLOOR_Y = 186;
  const ROW_BOTTOM = 266;
  const FRAME = { x: 262, y: 74, w: 50, h: 44, tilt: 9 }; // quadro torto (centro)
  const FLIGHT_MS = 520;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  // Números do alvo, a começar no 20 (em cima) e no sentido dos ponteiros.
  const NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

  function s(tag, attrs = {}, children = []) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    for (const c of children) if (c) node.append(c);
    return node;
  }
  const text = (attrs, str) => s('text', attrs, [document.createTextNode(str)]);

  // Setor de coroa circular (entre os raios r1 e r2, dos ângulos a1 a a2, em radianos).
  function wedge(cx, cy, r1, r2, a1, a2) {
    const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    return `M${p(r1, a1)} L${p(r2, a1)} A${r2},${r2} 0 0 1 ${p(r2, a2)} L${p(r1, a2)} A${r1},${r1} 0 0 0 ${p(r1, a1)} Z`;
  }

  // Alvo clássico: 20 setores alternados (preto/creme; duplos e triplos vermelho/verde), bull
  // verde e bullseye vermelho, e o anel preto com os números.
  function board() {
    const { x, y, r, rim } = BOARD;
    const g = s('g', { class: 'dart-board' }, [
      s('circle', { cx: x, cy: y, r: rim + 4, fill: '#3b2410' }),
      s('circle', { cx: x, cy: y, r: rim, fill: '#141414' }),
    ]);
    const bands = [[0.13, 0.58, 'single'], [0.58, 0.65, 'treble'], [0.65, 0.94, 'single'], [0.94, 1, 'double']];
    for (let i = 0; i < 20; i++) {
      const a1 = -Math.PI / 2 + ((i - 0.5) * Math.PI) / 10;
      const a2 = a1 + Math.PI / 10;
      for (const [f1, f2, kind] of bands) {
        const fill = kind === 'single' ? (i % 2 ? '#f1e3c6' : '#1b1b1b') : (i % 2 ? '#2f9e44' : '#e03131');
        g.append(s('path', { d: wedge(x, y, r * f1, r * f2, a1, a2), fill, stroke: '#9a9a9a', 'stroke-width': 0.35 }));
      }
      const am = -Math.PI / 2 + (i * Math.PI) / 10;
      g.append(text({
        x: (x + (r + 8) * Math.cos(am)).toFixed(1), y: (y + (r + 8) * Math.sin(am)).toFixed(1),
        'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'dart-number',
      }, String(NUMBERS[i])));
    }
    g.append(
      s('circle', { cx: x, cy: y, r: r * 0.13, fill: '#2f9e44', stroke: '#9a9a9a', 'stroke-width': 0.35 }),
      s('circle', { cx: x, cy: y, r: r * 0.06, fill: '#e03131', stroke: '#9a9a9a', 'stroke-width': 0.35 }),
    );
    return g;
  }

  // Quadro torto pendurado ao lado do alvo: uma paisagem com sol e um monte.
  function frame() {
    const { x, y, w, h, tilt } = FRAME;
    return s('g', { class: 'dart-frame', transform: `rotate(${tilt} ${x} ${y})` }, [
      s('path', { d: `M${x},${y - h / 2 - 14} L${x - 12},${y - h / 2} M${x},${y - h / 2 - 14} L${x + 12},${y - h / 2}`, stroke: '#c9b48a', 'stroke-width': 1 }),
      s('circle', { cx: x, cy: y - h / 2 - 14, r: 1.6, fill: '#adb5bd' }),
      s('rect', { x: x - w / 2 - 4, y: y - h / 2 - 4, width: w + 8, height: h + 8, rx: 2, fill: '#a0692f', stroke: '#5c3a1a', 'stroke-width': 1.2 }),
      s('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, fill: '#a5d8ff' }),
      s('circle', { cx: x + 12, cy: y - 8, r: 6, fill: '#ffd43b' }),
      s('path', { d: `M${x - w / 2},${y + h / 2} Q${x - 8},${y - 4} ${x + 6},${y + 8} Q${x + 16},${y} ${x + w / 2},${y + 10} L${x + w / 2},${y + h / 2} Z`, fill: '#51cf66' }),
    ]);
  }

  // Onde acerta cada dardo (coordenadas da cena), a partir da posição de apresentação.
  function aimPoints(players, seed) {
    const hits = players.filter((p) => !p.show.miss);
    const winners = hits.filter((p) => p.show.winner);
    const points = {};
    const items = hits.map((p, i) => {
      const rnd = window.RevealSeeded.seeded(`${seed}|${p.id}|dardos`);
      if (p.show.winner) {
        const k = winners.indexOf(p);
        const alone = winners.length === 1;
        return {
          id: p.id,
          exact: p.show.exact,
          // Bullseye: o "em cheio" mesmo no meio; com vários vencedores, todos à volta do meio.
          rad: alone ? (p.show.exact ? 0 : 0.03) : 0.1,
          ang: -Math.PI / 2 + k * ((2 * Math.PI) / Math.max(3, winners.length)) + (rnd() - 0.5) * 0.4,
          fixed: true,
        };
      }
      // Os outros: do anel interior (nível 0,15) até perto do duplo (nível 0,85).
      return { id: p.id, exact: false, rad: 0.16 + 0.8 * p.show.level, ang: rnd() * 2 * Math.PI + i * GOLDEN };
    });
    const pos = (it) => ({ x: BOARD.x + it.rad * BOARD.r * Math.cos(it.ang), y: BOARD.y + it.rad * BOARD.r * Math.sin(it.ang) });
    const MIN = 9; // distância mínima entre pontas
    for (let iter = 0; iter < 200; iter++) {
      let clash = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = pos(items[i]);
          const b = pos(items[j]);
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d >= MIN) continue;
          clash = true;
          let diff = items[j].ang - items[i].ang;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff)) || 0.01;
          const push = Math.min(0.4, (MIN - d) / (Math.max(items[i].rad, items[j].rad, 0.07) * BOARD.r + 1)) / 2;
          items[i].ang -= Math.sign(diff) * push;
          items[j].ang += Math.sign(diff) * push;
        }
      }
      if (!clash) break;
    }
    for (const it of items) points[it.id] = { ...pos(it), where: 'alvo', exact: it.exact };

    // Falhanços: o "mais longe" no quadro torto (se forem vários, o 2.º ao lado no quadro); os
    // outros na parede à esquerda e por baixo do alvo.
    let inFrame = 0;
    players.filter((p) => p.show.miss).forEach((p, k) => {
      if (p.show.farthest && inFrame < 3) {
        const off = [[-6, -4], [10, 8], [-12, 12]][inFrame++];
        const a = (FRAME.tilt * Math.PI) / 180;
        points[p.id] = { x: FRAME.x + off[0] * Math.cos(a) - off[1] * Math.sin(a), y: FRAME.y + off[0] * Math.sin(a) + off[1] * Math.cos(a), where: 'quadro' };
        return;
      }
      const spots = [[32, 64], [44, 128], [72, 168], [26, 160], [228, 168], [58, 96]];
      const [x, y] = spots[k % spots.length];
      points[p.id] = { x: x + Math.floor(k / spots.length) * 8, y, where: 'parede' };
    });
    return points;
  }

  window.RevealThemes.register('dardos', () => {
    let kit = null;
    let scene = null;
    let dartsLayer = null;
    let fxLayer = null;
    let answerText = null;
    let throwers = {}; // id → { g, player, x, bottom, w, h, small }
    let points = {};
    const flights = new Map(); // id → { frame, finish }
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

    // O boneco de cada jogador (só a pose muda; o desenho é sempre o drawCharacter).
    function place(id, pose) {
      const a = throwers[id];
      const svg = kit.drawCharacter(a.player, pose, { size: a.h, small: a.small });
      svg.setAttribute('x', a.x);
      svg.setAttribute('y', a.bottom - a.h);
      a.g.replaceChildren(svg);
    }
    // Ponto de onde sai o dardo: a mão levantada (pose "dardo").
    function handPoint(id) {
      const a = throwers[id];
      return { x: a.x + a.w * 0.8, y: a.bottom - a.h + a.h * (32 / 130) };
    }

    // Dardo: ponta de metal, corpo na cor do jogador, penas e, na cauda, o emoji num círculo.
    // O desenho fica num grupo interior, para a vibração do "em cheio" (CSS) não apagar a posição.
    function dartShape(player, len) {
      const f = len - 6;
      return s('g', { class: 'dart' }, [s('g', { class: 'dart-body' }, [
        s('line', { x1: -8, y1: 0, x2: 0, y2: 0, stroke: '#ced4da', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
        s('line', { x1: -f, y1: 0, x2: -7, y2: 0, stroke: player.color, 'stroke-width': 3, 'stroke-linecap': 'round' }),
        s('path', { d: `M${-f},0 L${-f - 6},-4.5 L${-f - 3},0 L${-f - 6},4.5 Z`, fill: player.color, stroke: 'rgba(0,0,0,.4)', 'stroke-width': 0.6 }),
        s('circle', { cx: -len, cy: 0, r: 6.2, fill: player.color, stroke: '#fff', 'stroke-width': 1.2 }),
        text({ x: -len, y: 0.4, 'font-size': 7.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'dart-emoji' }, player.emoji || ''),
      ])]);
    }

    const flightOf = (id) => {
      const from = handPoint(id);
      const to = points[id];
      return { from, to, ctrl: { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 30 } };
    };

    function settle(node, id) {
      const { to } = flightOf(id);
      node.setAttribute('transform', `translate(${to.x.toFixed(1)} ${to.y.toFixed(1)}) rotate(${to.deg.toFixed(1)})`);
      node.querySelector('text').setAttribute('transform', `rotate(${(-to.deg).toFixed(1)} ${-to.len} 0)`);
    }

    // Texto curto que aparece e desaparece (uma vez).
    function fxText(str, cls, x, y) {
      const t = text({ x, y, 'text-anchor': 'middle', class: `dart-fx-text ${cls}` }, str);
      fxLayer.append(t);
      later(() => t.remove(), 1300);
    }
    function ring(to, gold) {
      const c = s('circle', { cx: to.x, cy: to.y, r: gold ? 5 : 4, class: `dart-hit${gold ? ' gold' : ''}` });
      fxLayer.append(c);
      later(() => c.remove(), 700);
    }
    // Texto por baixo do alvo, no chão (nunca em cima da placa da resposta).
    const BELOW = BOARD.y + BOARD.rim + 18;

    function landFx(node, player, to) {
      if (player.show.exact) {
        node.classList.add('quiver');
        ring(to, true);
        fxText('EM CHEIO!', 'gold', BOARD.x, BELOW);
      } else if (player.show.winner) {
        ring(to, false);
        fxText('BULLSEYE!', 'win', BOARD.x, BELOW);
      } else if (to.where === 'alvo') ring(to, false);
      else if (to.where === 'quadro') fxText('No quadro!', 'miss', FRAME.x - 4, FRAME.y + FRAME.h / 2 + 22);
      else fxText('Falhou!', 'miss', to.x, to.y - 12);
    }

    return {
      mount(container, { players, kit: k, seed }) {
        kit = k;
        throwers = {};
        const n = players.length;
        const twoRows = n > 6;
        const vh = twoRows ? VH_TALL : VH;
        scene = s('svg', { viewBox: `0 0 ${VW} ${vh}`, class: 'dart-scene', role: 'img', 'aria-label': 'Dardos: quanto mais perto do centro do alvo, mais perto da resposta certa' });
        kit.sizeScene(scene, VW, vh, twoRows ? 60 : 45);

        // Parede de bar (tábuas de madeira escura) e chão.
        scene.append(s('rect', { x: 0, y: 0, width: VW, height: FLOOR_Y, rx: 10, fill: '#3d2a1e' }));
        for (let x = 25; x < VW; x += 25) scene.append(s('line', { x1: x, y1: 0, x2: x, y2: FLOOR_Y, stroke: '#2e1f16', 'stroke-width': 1.5 }));
        // Luz do candeeiro sobre o alvo.
        scene.append(s('ellipse', { cx: BOARD.x, cy: BOARD.y - 8, rx: 100, ry: 86, fill: '#ffd43b', opacity: 0.08 }));
        scene.append(
          s('path', { d: `M0,${FLOOR_Y} L${VW},${FLOOR_Y} L${VW},${vh} L0,${vh} Z`, fill: '#5c3a1a' }),
          s('path', { d: `M0,${FLOOR_Y} L${VW},${FLOOR_Y}`, stroke: '#8d5a2b', 'stroke-width': 3 }),
        );
        for (let y = FLOOR_Y + 18; y < vh; y += 18) scene.append(s('line', { x1: 0, y1: y, x2: VW, y2: y, stroke: '#4a2f15', 'stroke-width': 1 }));
        // Linha de lançamento.
        scene.append(s('line', { x1: 10, y1: FLOOR_Y + 10, x2: VW - 10, y2: FLOOR_Y + 10, stroke: '#f1f3f5', 'stroke-width': 1.5, opacity: 0.5, 'stroke-dasharray': '6 4' }));

        scene.append(frame(), board());

        // Placa da resposta certa, no topo (nenhum dardo cai lá).
        answerText = text({ x: VW / 2, y: 26, 'text-anchor': 'middle', class: 'dart-answer' }, '?');
        scene.append(
          s('rect', { x: VW / 2 - 62, y: 4, width: 124, height: 30, rx: 8, class: 'dart-plaque' }),
          text({ x: VW / 2 - 56, y: 13, class: 'dart-plaque-label' }, 'RESPOSTA'),
          answerText,
        );

        dartsLayer = s('g', { class: 'dart-darts' });
        fxLayer = s('g', { class: 'dart-fx' });
        const rowLayer = s('g', { class: 'dart-row' });
        // Fila de jogadores: um lugar por jogador; com mais de 6, duas filas desencontradas.
        if (!twoRows) {
          const slot = VW / n;
          const h = Math.min(74, slot * 1.25);
          const w = h * (100 / 130);
          players.forEach((p, i) => {
            const g = s('g', { class: 'dart-thrower', 'data-id': p.id });
            throwers[p.id] = { g, player: p, x: i * slot + (slot - w) / 2, bottom: ROW_BOTTOM, w, h, small: false };
            rowLayer.append(g);
          });
        } else {
          const cols = Math.ceil(n / 2);
          const slot = VW / (cols + 0.5);
          const h = Math.min(64, slot * 1.3);
          const w = h * (100 / 130);
          const back = s('g');
          const front = s('g');
          players.forEach((p, i) => {
            const behind = i % 2 === 1;
            const g = s('g', { class: 'dart-thrower', 'data-id': p.id });
            throwers[p.id] = {
              g, player: p, w, h, small: true,
              x: Math.floor(i / 2) * slot + (slot - w) / 2 + (behind ? slot / 2 : 0),
              bottom: behind ? vh - 4 - h * 0.85 : vh - 4,
            };
            (behind ? back : front).append(g);
          });
          rowLayer.append(back, front);
        }
        for (const p of players) place(p.id, 'dardo');

        scene.append(rowLayer, dartsLayer, fxLayer);
        container.append(scene);
        points = aimPoints(players, seed);

        // Inclinação final de cada dardo: na direção de quem o lançou (a cauda aponta para
        // baixo, para os jogadores, e nunca sobe até à placa). Caudas juntas: rodam e, se não
        // chegar, uma fica mais comprida.
        for (const p of players) {
          const { from, to } = flightOf(p.id);
          to.deg = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
          to.len = 24;
        }
        const rad = (d) => (d * Math.PI) / 180;
        const tail = (pt) => ({ x: pt.x - pt.len * Math.cos(rad(pt.deg)), y: pt.y - pt.len * Math.sin(rad(pt.deg)) });
        const clamp = (pt) => { pt.deg = Math.max(-165, Math.min(-15, pt.deg)); };
        const list = players.map((p) => points[p.id]);
        list.forEach(clamp);
        for (let iter = 0; iter < 200; iter++) {
          let clash = false;
          for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
              const a = tail(list[i]);
              const b = tail(list[j]);
              if (Math.hypot(a.x - b.x, a.y - b.y) >= 14) continue;
              clash = true;
              const side = a.x <= b.x ? 1 : -1;
              list[i].deg -= side * 4;
              list[j].deg += side * 4;
              clamp(list[i]);
              clamp(list[j]);
              if (iter > 20) list[j].len = Math.min(40, list[j].len + 2);
            }
          }
          if (!clash) break;
        }
      },

      revealPlayer(player, precision, { instant }) {
        const { from, to, ctrl } = flightOf(player.id);
        const node = dartShape(player, to.len);
        node.dataset.id = player.id;
        if (player.show.exact) node.classList.add('gold');
        dartsLayer.append(node);
        throwers[player.id].g.classList.add('shot');
        if (instant || kit.reducedMotion()) {
          settle(node, player.id);
          return;
        }
        // Voo em arco, a apontar na direção do movimento; ao chegar, espeta-se.
        const start = performance.now();
        const finish = () => {
          cancelAnimationFrame(flights.get(player.id)?.frame);
          flights.delete(player.id);
          settle(node, player.id);
          landFx(node, player, to);
        };
        const frameFn = (now) => {
          const t = Math.min(1, (now - start) / FLIGHT_MS);
          if (t >= 1) { finish(); return; }
          const e = t * t * (3 - 2 * t);
          const x = (1 - e) ** 2 * from.x + 2 * (1 - e) * e * ctrl.x + e ** 2 * to.x;
          const y = (1 - e) ** 2 * from.y + 2 * (1 - e) * e * ctrl.y + e ** 2 * to.y;
          const dx = 2 * (1 - e) * (ctrl.x - from.x) + 2 * e * (to.x - ctrl.x);
          const dy = 2 * (1 - e) * (ctrl.y - from.y) + 2 * e * (to.y - ctrl.y);
          const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
          node.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})`);
          node.querySelector('text').setAttribute('transform', `rotate(${(-deg).toFixed(1)} ${-to.len} 0)`);
          flights.get(player.id).frame = requestAnimationFrame(frameFn);
        };
        flights.set(player.id, { frame: requestAnimationFrame(frameFn), finish });
      },

      // Resposta certa na placa (a rolar até ao valor). O mais perto festeja e o mais longe
      // reage (com as escolhas de cada um); os outros ficam na pose normal.
      revealAnswer(answer, { closest, farthest, instant }) {
        for (const f of [...flights.values()]) f.finish();
        if (instant) answerText.textContent = kit.fmt(answer);
        else kit.countUp(answerText, answer);
        for (const id of Object.keys(throwers)) {
          const near = closest.includes(id);
          const far = farthest.includes(id) && !near;
          place(id, near ? 'festejar' : far ? 'triste' : 'parado');
          throwers[id].g.classList.toggle('near', near);
          throwers[id].g.classList.toggle('far', far);
        }
        for (const node of dartsLayer.children) {
          node.classList.toggle('near', closest.includes(node.dataset.id));
          node.classList.toggle('far', farthest.includes(node.dataset.id) && !closest.includes(node.dataset.id));
        }
        // Os dardos do mais perto ficam por cima dos outros.
        for (const node of [...dartsLayer.children]) if (node.classList.contains('near')) dartsLayer.append(node);
      },

      skipToEnd() {
        for (const f of [...flights.values()]) f.finish();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        fxLayer.replaceChildren();
      },

      destroy() {
        for (const f of flights.values()) cancelAnimationFrame(f.frame);
        flights.clear();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        if (answerText) kit.stopCount(answerText);
        if (scene) scene.remove();
        scene = dartsLayer = fxLayer = answerText = null;
        throwers = {};
      },
    };
  });
})();
