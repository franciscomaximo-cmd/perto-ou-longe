'use strict';

// Tema "malha" (jogo tradicional português): um terreiro de terra batida com o meco (pino de
// madeira) ao fundo e, em baixo, a fila de jogadores (os bonecos na pose "a lançar a malha").
// Na vez de cada um, o seu boneco lança a malha (disco de metal, da sua cor e com o seu emoji)
// por cima do terreiro. Onde para vem da posição de apresentação (player.show), relativa à
// ronda:
//   - o vencedor derruba o meco; o "em cheio" derruba-o com estilo (o meco gira no ar);
//   - os outros param mais perto ou mais longe do meco, pela posição na ronda, sem se
//     sobreporem; quem errou mais de 100% fica curto, lá à frente;
//   - o "mais longe" atira a malha para fora do terreiro, e o galo foge assustado.
// Na primeira vez que o tema aparece neste dispositivo, uma legenda explica o que é a malha.
//
// Cena SVG de tamanho fixo (viewBox 300 × 300; 300 × 340 com mais de 6 jogadores, com duas
// filas em baixo), por zonas:
//   - topo: placa da resposta certa (nenhuma malha vai lá);
//   - terreiro em perspetiva, com o meco ao fundo e o galo no canto, fora do terreiro;
//   - em baixo, a fila com o boneco de cada jogador.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const VW = 300;
  const VH = 300;
  const VH_TALL = 340;
  const TERR = { top: 36, bottom: 214, topL: 60, topR: 240, botL: 6, botR: 294 };
  const MECO = { x: 150, y: 74, h: 26, w: 8 }; // y = base do meco
  const AIM = { x: 150, y: 82 }; // à frente do meco: as distâncias contam daqui
  const GALO = { x: 30, y: 60 };
  const FLIGHT_MS = 680;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const SEEN_KEY = 'pertoOuLonge.malhaVista';

  function s(tag, attrs = {}, children = []) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    for (const c of children) if (c) node.append(c);
    return node;
  }
  const text = (attrs, str) => s('text', attrs, [document.createTextNode(str)]);
  const deg = (d) => (d * Math.PI) / 180;
  // Escala da perspetiva: coisas ao fundo (y pequeno) ficam mais pequenas.
  const depth = (y) => 0.72 + 0.28 * Math.max(0, Math.min(1, (y - TERR.top) / (TERR.bottom - TERR.top)));

  // Onde para cada malha, a partir da posição de apresentação e da semente da ronda.
  function plan(players, seed) {
    const out = {};
    const around = [];
    const winners = players.filter((p) => p.show.winner);
    let short = 0;
    let outside = 0;
    for (const [i, p] of players.entries()) {
      const rnd = window.RevealSeeded.seeded(`${seed}|${p.id}|malha`);
      if (p.show.winner) {
        // Junto ao meco (se forem vários, lado a lado).
        const k = winners.indexOf(p);
        out[p.id] = { x: AIM.x + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 22, y: AIM.y + 2, where: 'meco' };
        continue;
      }
      if (p.show.farthest) {
        // Fora do terreiro: o primeiro ao pé do galo, os outros no canto do outro lado.
        out[p.id] = outside++ === 0 ? { x: GALO.x + 4, y: GALO.y + 16, where: 'fora' } : { x: 270 - (outside - 2) * 6, y: 58 + (outside - 2) * 14, where: 'fora' };
        continue;
      }
      if (p.show.miss) {
        // Curtas: ficam lá à frente, perto da linha de lançamento.
        const k = short++;
        out[p.id] = { x: 150 + (k % 2 ? 1 : -1) * (40 + Math.floor(k / 2) * 46), y: 184 + (k % 3) * 6, where: 'curta' };
        continue;
      }
      // À volta do meco: distância pelo nível, para a frente e para os lados.
      around.push({ id: p.id, d: 16 + 76 * p.show.level, ang: deg(12 + ((rnd() * 156 + i * GOLDEN * 57) % 156)) });
    }
    // (Elipse da perspetiva: a mesma distância no chão dá o mesmo "anel" no ecrã.)
    const pos = (it) => ({ x: AIM.x + Math.cos(it.ang) * it.d * 1.15, y: AIM.y + Math.sin(it.ang) * it.d * 0.7 });
    const overlap = (a, b) => ((a.x - b.x) / 22) ** 2 + ((a.y - b.y) / 13) ** 2 < 1;
    const fixed = Object.values(out);
    for (let iter = 0; iter < 300; iter++) {
      let clash = false;
      for (let i = 0; i < around.length; i++) {
        const a = pos(around[i]);
        for (const f of fixed) {
          if (!overlap(a, f)) continue;
          clash = true;
          around[i].ang += a.x < f.x ? 0.08 : -0.08;
        }
        for (let j = i + 1; j < around.length; j++) {
          const b = pos(around[j]);
          if (!overlap(a, b)) continue;
          clash = true;
          let diff = around[j].ang - around[i].ang;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff)) || 0.01;
          around[i].ang -= Math.sign(diff) * 0.06;
          around[j].ang += Math.sign(diff) * 0.06;
        }
        around[i].ang = Math.max(deg(-8), Math.min(deg(188), around[i].ang));
      }
      if (!clash) break;
    }
    for (const it of around) out[it.id] = { ...pos(it), where: 'terreiro' };
    return out;
  }

  // Galo (fora do terreiro, no canto): foge quando a malha do "mais longe" cai ao pé dele.
  function galo() {
    return s('g', { class: 'malha-galo', transform: `translate(${GALO.x} ${GALO.y})` }, [s('g', { class: 'malha-galo-body' }, [
      s('path', { d: 'M8,2 Q16,-6 14,6 Q12,10 8,8 Z', fill: '#2f9e44' }), // cauda
      s('ellipse', { cx: 0, cy: 4, rx: 9, ry: 7, fill: '#e8590c' }),
      s('ellipse', { cx: 1, cy: 5, rx: 5, ry: 3.5, fill: '#ffa94d' }),
      s('circle', { cx: -8, cy: -5, r: 4.5, fill: '#e8590c' }),
      s('path', { d: 'M-10,-10 L-8,-13 L-6,-10 L-4,-12 L-4,-8 Z', fill: '#e03131' }), // crista
      s('path', { d: 'M-12.5,-5 L-16,-4 L-12.5,-3 Z', fill: '#ffd43b' }), // bico
      s('circle', { cx: -9, cy: -6, r: 0.9, fill: '#111' }),
      s('path', { d: 'M-2,10 L-3,15 M3,10 L4,15', stroke: '#ffd43b', 'stroke-width': 1.4 }),
    ])]);
  }

  window.RevealThemes.register('malha', () => {
    let kit = null;
    let scene = null;
    let meco = null;
    let galoNode = null;
    let malhasLayer = null;
    let fxLayer = null;
    let answerText = null;
    let caption = null;
    let plans = {};
    let row = {}; // id → { g, player, x, bottom, h, w, small }
    let mecoDown = false;
    let galoGone = false;
    const flights = new Map(); // id → { frame, finish }
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

    function drawRow(id, pose) {
      const r = row[id];
      const svg = kit.drawCharacter(r.player, pose, { size: r.h, small: r.small });
      svg.setAttribute('x', r.x);
      svg.setAttribute('y', r.bottom - r.h);
      r.g.replaceChildren(svg);
    }
    // Ponto de onde sai a malha: a mão do boneco (pose "malha").
    const handPoint = (id) => ({ x: row[id].x + row[id].w * 0.83, y: row[id].bottom - row[id].h + row[id].h * (86 / 130) });

    // Malha deitada no chão: disco na cor do jogador (com rebordo de metal) e o emoji por cima.
    function malhaShape(player) {
      return s('g', { class: 'malha', 'data-id': player.id }, [
        s('ellipse', { rx: 11, ry: 6, fill: player.color, stroke: '#495057', 'stroke-width': 1.6 }),
        s('ellipse', { rx: 4.5, ry: 2.2, cy: -0.5, fill: 'rgba(255,255,255,.35)' }),
        text({ y: -8, 'font-size': 9, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'malha-emoji' }, player.emoji || ''),
      ]);
    }
    const put = (node, x, y, scale, rot = 0) => node.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(2)})${rot ? ` rotate(${rot.toFixed(0)})` : ''}`);

    // O meco cai (o "em cheio": gira no ar e cai). Sem animação, fica logo deitado.
    function knockMeco(style, animate) {
      if (mecoDown) return;
      mecoDown = true;
      meco.classList.add('down');
      if (animate) meco.classList.add(style ? 'spin' : 'fall');
    }
    function scareGalo(animate) {
      if (galoGone) return;
      galoGone = true;
      if (!animate) { galoNode.classList.add('gone'); return; }
      galoNode.classList.add('flee');
      fxText('Cocorocó!', 'miss', GALO.x + 18, GALO.y - 14, 9);
    }

    function fxText(str, cls, x = VW / 2, y = 128, size = null) {
      const t = text({ x, y, 'text-anchor': 'middle', class: `malha-fx-text ${cls}`, style: size ? `font-size:${size}px` : null }, str);
      fxLayer.append(t);
      later(() => t.remove(), 1400);
    }

    function land(player, pl, animate) {
      if (pl.where === 'meco') {
        knockMeco(player.show.exact, animate);
        if (animate) {
          if (player.show.exact) fxText('EM CHEIO!', 'gold');
          else fxText('DERRUBOU!', 'win');
          kit.sound('golo');
        }
      } else if (pl.where === 'fora') {
        scareGalo(animate);
        if (animate) fxText('Fora do terreiro!', 'miss', VW / 2, 128, 13);
      } else if (pl.where === 'curta' && animate) fxText('Curta!', 'miss', pl.x, pl.y - 18, 11);
    }

    // Legenda da primeira vez (neste dispositivo): o que é a malha. Some sozinha, e só então
    // fica marcada como vista (se a ronda acabar antes, aparece outra vez na próxima).
    function showCaption(container) {
      let seen = false;
      try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { /* sem armazenamento */ }
      if (seen) return;
      caption = kit.el('div', { class: 'theme-caption', role: 'note' }, [
        kit.el('b', { text: 'Malha' }),
        ' — jogo tradicional português: lança-se um disco de metal (a malha) para derrubar o pino de madeira (o meco).',
      ]);
      caption.addEventListener('animationend', () => {
        try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* sem armazenamento */ }
        if (caption) caption.remove();
        caption = null;
      });
      container.append(caption);
    }

    return {
      mount(container, { players, kit: k, seed }) {
        kit = k;
        row = {};
        mecoDown = false;
        galoGone = false;
        const n = players.length;
        const twoRows = n > 6;
        const vh = twoRows ? VH_TALL : VH;
        scene = s('svg', { viewBox: `0 0 ${VW} ${vh}`, class: 'malha-scene', role: 'img', 'aria-label': 'Malha: quanto mais perto do meco fica a malha, mais perto da resposta certa' });
        kit.sizeScene(scene, VW, vh, twoRows ? 60 : 45);

        // Relva à volta, árvores ao fundo e o terreiro de terra batida em perspetiva.
        scene.append(s('rect', { x: 0, y: 0, width: VW, height: vh, rx: 10, fill: '#5c940d' }));
        for (const [x, r] of [[18, 16], [52, 12], [248, 14], [284, 17]]) {
          scene.append(s('circle', { cx: x, cy: 14, r, fill: '#2b8a3e' }), s('circle', { cx: x - r * 0.3, cy: 10, r: r * 0.55, fill: '#37b24d' }));
        }
        const { top, bottom, topL, topR, botL, botR } = TERR;
        scene.append(
          s('path', { d: `M${topL},${top} L${topR},${top} L${botR},${bottom} L${botL},${bottom} Z`, fill: '#c8a26b', stroke: '#a37b45', 'stroke-width': 2 }),
          s('path', { d: `M${topL + 20},${top + 30} Q150,${top + 22} ${topR - 20},${top + 30} M${botL + 40},${bottom - 40} Q150,${bottom - 50} ${botR - 40},${bottom - 40}`, fill: 'none', stroke: '#b38a52', 'stroke-width': 1, opacity: 0.6 }),
        );
        // Pedrinhas no terreiro (sempre as mesmas).
        for (let i = 0; i < 18; i++) {
          const y = top + 14 + ((i * 53) % (bottom - top - 24));
          const t = (y - top) / (bottom - top);
          const l = topL + (botL - topL) * t;
          const r = topR + (botR - topR) * t;
          scene.append(s('circle', { cx: l + 10 + ((i * 97) % Math.max(10, r - l - 20)), cy: y, r: 1.2 + (i % 3) * 0.4, fill: '#a37b45', opacity: 0.6 }));
        }
        // Linha de lançamento, à frente.
        scene.append(s('line', { x1: botL + 14, y1: bottom - 6, x2: botR - 14, y2: bottom - 6, stroke: '#f8f9fa', 'stroke-width': 1.5, opacity: 0.6, 'stroke-dasharray': '6 4' }));

        // O meco: pino de madeira, com a sombra (a parte que cai fica num grupo à parte).
        scene.append(s('ellipse', { cx: MECO.x + 3, cy: MECO.y + 1, rx: 8, ry: 2.5, fill: '#000', opacity: 0.2 }));
        meco = s('g', { class: 'malha-meco', transform: `translate(${MECO.x} ${MECO.y})` }, [s('g', { class: 'malha-meco-body' }, [
          s('rect', { x: -MECO.w / 2, y: -MECO.h, width: MECO.w, height: MECO.h, rx: 3, fill: '#c08040', stroke: '#6b3e14', 'stroke-width': 1.2 }),
          s('ellipse', { cx: 0, cy: -MECO.h, rx: MECO.w / 2, ry: 1.8, fill: '#e0a96d', stroke: '#6b3e14', 'stroke-width': 0.8 }),
          s('path', { d: `M${-MECO.w / 2 + 1.5},${-MECO.h + 6} L${-MECO.w / 2 + 1.5},-3`, stroke: '#e0a96d', 'stroke-width': 1.2, opacity: 0.7 }),
        ])]);
        scene.append(meco);
        galoNode = galo();
        scene.append(galoNode);

        // Placa da resposta certa, no topo (nenhuma malha vai lá).
        answerText = text({ x: VW / 2 + 22, y: 18, 'text-anchor': 'middle', class: 'malha-answer' }, '?');
        scene.append(
          s('rect', { x: 88, y: 4, width: 124, height: 20, rx: 6, class: 'malha-plaque' }),
          text({ x: 94, y: 16.5, class: 'malha-plaque-label' }, 'RESPOSTA'),
          answerText,
        );

        malhasLayer = s('g', { class: 'malha-malhas' });
        fxLayer = s('g', { class: 'malha-fx' });
        // Fila em baixo: o boneco de cada jogador. Com mais de 6, duas filas desencontradas.
        const rowLayer = s('g', { class: 'malha-row' });
        if (!twoRows) {
          const slot = VW / n;
          const h = Math.min(60, slot * 1.25);
          const w = h * (100 / 130);
          players.forEach((p, i) => {
            const g = s('g', { class: 'malha-row-player', 'data-id': p.id });
            row[p.id] = { g, player: p, x: i * slot + (slot - w) / 2, bottom: vh - 2, h, w, small: false };
            rowLayer.append(g);
          });
        } else {
          const cols = Math.ceil(n / 2);
          const slot = VW / (cols + 0.5);
          const h = Math.min(60, slot * 1.3);
          const w = h * (100 / 130);
          const back = s('g');
          const front = s('g');
          players.forEach((p, i) => {
            const behind = i % 2 === 1;
            const g = s('g', { class: 'malha-row-player', 'data-id': p.id });
            row[p.id] = {
              g, player: p, h, w, small: true,
              x: Math.floor(i / 2) * slot + (slot - w) / 2 + (behind ? slot / 2 : 0),
              bottom: behind ? vh - 2 - h * 0.8 : vh - 2,
            };
            (behind ? back : front).append(g);
          });
          rowLayer.append(back, front);
        }
        for (const p of players) drawRow(p.id, 'malha');

        scene.append(rowLayer, malhasLayer, fxLayer);
        container.append(scene);
        plans = plan(players, seed);
        showCaption(container);
      },

      revealPlayer(player, precision, { instant }) {
        const pl = plans[player.id];
        row[player.id].g.classList.add('shot');
        const node = malhaShape(player);
        malhasLayer.append(node);
        if (instant || kit.reducedMotion()) {
          put(node, pl.x, pl.y, depth(pl.y));
          land(player, pl, false);
          return;
        }
        // Voo em arco por cima do terreiro, a rodar; fica mais pequena ao longe.
        const from = handPoint(player.id);
        const ctrl = { x: (from.x + pl.x) / 2, y: Math.min(from.y, pl.y) - (pl.where === 'fora' ? 70 : 55) };
        const start = performance.now();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          cancelAnimationFrame(flights.get(player.id)?.frame);
          flights.delete(player.id);
          put(node, pl.x, pl.y, depth(pl.y));
          land(player, pl, true);
        };
        const frame = (now) => {
          const t = Math.min(1, (now - start) / FLIGHT_MS);
          const e = 1 - (1 - t) ** 1.6;
          const x = (1 - e) ** 2 * from.x + 2 * (1 - e) * e * ctrl.x + e ** 2 * pl.x;
          const y = (1 - e) ** 2 * from.y + 2 * (1 - e) * e * ctrl.y + e ** 2 * pl.y;
          put(node, x, y, depth(y) * (1 + 0.25 * Math.sin(t * Math.PI)), t < 1 ? t * 720 : 0);
          if (t < 1) { flights.get(player.id).frame = requestAnimationFrame(frame); return; }
          finish();
        };
        flights.set(player.id, { frame: requestAnimationFrame(frame), finish });
      },

      // Resposta certa na placa (a rolar até ao valor). Na fila, o mais perto festeja e o mais
      // longe reage (com as escolhas de cada um); os outros ficam na pose normal.
      revealAnswer(answer, { closest, farthest, instant }) {
        for (const f of [...flights.values()]) f.finish();
        if (instant) answerText.textContent = kit.fmt(answer);
        else kit.countUp(answerText, answer);
        for (const id of Object.keys(row)) {
          const near = closest.includes(id);
          const far = farthest.includes(id) && !near;
          drawRow(id, near ? 'festejar' : far ? 'triste' : 'parado');
          row[id].g.classList.toggle('near', near);
          row[id].g.classList.toggle('far', far);
        }
        for (const m of malhasLayer.children) {
          m.classList.toggle('near', closest.includes(m.dataset.id));
          m.classList.toggle('far', farthest.includes(m.dataset.id) && !closest.includes(m.dataset.id));
        }
      },

      skipToEnd() {
        for (const f of [...flights.values()]) f.finish();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        fxLayer.replaceChildren();
        meco.classList.remove('spin', 'fall');
        if (galoGone) { galoNode.classList.remove('flee'); galoNode.classList.add('gone'); }
      },

      destroy() {
        for (const f of flights.values()) cancelAnimationFrame(f.frame);
        flights.clear();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        if (answerText) kit.stopCount(answerText);
        if (scene) scene.remove();
        if (caption) caption.remove();
        scene = meco = galoNode = malhasLayer = fxLayer = answerText = caption = null;
        plans = {};
        row = {};
      },
    };
  });
})();
