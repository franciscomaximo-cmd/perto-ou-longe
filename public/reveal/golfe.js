'use strict';

// Tema "golfe" (putt): um green visto de cima, com o buraco e a bandeira, um lago ao lado e,
// em baixo, a fila de jogadores. Na vez de cada um, o seu boneco (em grande, na pose "a dar a
// tacada") bate a bola, da sua cor e com o seu retrato, e ela rola até parar. Onde para vem da
// posição de apresentação (player.show), relativa à ronda:
//   - o vencedor mete a bola no buraco (fica com o retrato na bandeira); o "em cheio" faz
//     "HOLE IN ONE!" com um efeito especial dourado;
//   - os outros param à volta do buraco, mais perto ou mais longe pela posição na ronda, sem
//     bolas sobrepostas;
//   - quem errou mais de 100% sai do green (fica na relva alta);
//   - o "mais longe" manda a bola para o lago, com um "splash".
//
// Cena SVG de tamanho fixo (viewBox 300 × 300; 300 × 340 com mais de 6 jogadores, com duas
// filas em baixo), por zonas:
//   - topo: placa da resposta certa (nenhuma bola vai lá);
//   - green com o buraco e a bandeira; lago em baixo à esquerda; partida em baixo à direita;
//   - em baixo, a fila com o boneco de cada jogador.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const VW = 300;
  const VH = 300;
  const VH_TALL = 340;
  const GREEN = { x: 150, y: 112, rx: 120, ry: 72 };
  const HOLE = { x: 156, y: 104, r: 5 };
  const POLE_TOP = 62;
  const LAKE = { x: 50, y: 200, rx: 42, ry: 20 };
  const TEE = { x: 262, y: 214 }; // onde está a bola antes da tacada
  const SHOOTER = { x: 224, bottom: 224, h: 60 };
  const BALL_R = 6.5;
  const MIN_GAP = 15; // distância mínima entre bolas
  const ROLL_MS = 820;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  function s(tag, attrs = {}, children = []) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    for (const c of children) if (c) node.append(c);
    return node;
  }
  const text = (attrs, str) => s('text', attrs, [document.createTextNode(str)]);
  const deg = (d) => (d * Math.PI) / 180;

  // Onde para cada bola, a partir da posição de apresentação e da semente da ronda.
  function plan(players, seed) {
    const out = {};
    const onGreen = [];
    let rough = 0;
    let lake = 0;
    for (const [i, p] of players.entries()) {
      const rnd = window.RevealSeeded.seeded(`${seed}|${p.id}|golfe`);
      if (p.show.winner) { out[p.id] = { x: HOLE.x, y: HOLE.y, where: 'buraco' }; continue; }
      if (p.show.farthest) {
        // No lago (se forem vários, lado a lado).
        out[p.id] = { x: LAKE.x - 18 + (lake++ % 4) * 12, y: LAKE.y - 2 + (lake % 2) * 6, where: 'lago' };
        continue;
      }
      if (p.show.miss) {
        // Fora do green, na relva alta: alternam entre a direita e a esquerda.
        const right = rough % 2 === 0;
        const a = deg(right ? -28 + (rough >> 1) * 22 : 196 - (rough >> 1) * 22);
        rough += 1;
        out[p.id] = { x: GREEN.x + Math.cos(a) * GREEN.rx * 1.1, y: GREEN.y + Math.sin(a) * GREEN.ry * 1.14, where: 'relva' };
        continue;
      }
      // À volta do buraco: distância pelo nível; ângulo variado, longe da bandeira (em cima).
      // (Distância igual em todas as direções: palpites iguais ficam mesmo à mesma distância.)
      onGreen.push({ id: p.id, d: 13 + 63 * p.show.level, ang: deg(-40 + ((rnd() * 260 + i * GOLDEN * 57) % 260)) });
    }
    const pos = (it) => ({ x: HOLE.x + Math.cos(it.ang) * it.d, y: HOLE.y + Math.sin(it.ang) * it.d });
    for (let iter = 0; iter < 300; iter++) {
      let clash = false;
      for (let i = 0; i < onGreen.length; i++) {
        for (let j = i + 1; j < onGreen.length; j++) {
          const a = pos(onGreen[i]);
          const b = pos(onGreen[j]);
          const dd = Math.hypot(a.x - b.x, a.y - b.y);
          if (dd >= MIN_GAP) continue;
          clash = true;
          let diff = onGreen[j].ang - onGreen[i].ang;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff)) || 0.01;
          const push = Math.min(0.35, (MIN_GAP - dd) / (Math.max(onGreen[i].d, onGreen[j].d) + 1)) / 2;
          onGreen[i].ang -= Math.sign(diff) * push;
          onGreen[j].ang += Math.sign(diff) * push;
        }
      }
      if (!clash) break;
    }
    for (const it of onGreen) out[it.id] = { ...pos(it), where: 'green' };
    return out;
  }

  window.RevealThemes.register('golfe', () => {
    let kit = null;
    let scene = null;
    let ballsLayer = null;
    let badgesLayer = null;
    let fxLayer = null;
    let shooterLayer = null;
    let answerText = null;
    let plans = {};
    let row = {}; // id → { g, player, x, bottom, h, w, small }
    let holed = 0; // quantas bolas já entraram no buraco (para os emblemas na bandeira)
    let roundSeed = '';
    const rolls = new Map(); // id → { frame, finish }
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

    function drawRow(id, pose) {
      const r = row[id];
      const svg = kit.drawCharacter(r.player, pose, { size: r.h, small: r.small });
      svg.setAttribute('x', r.x);
      svg.setAttribute('y', r.bottom - r.h);
      r.g.replaceChildren(svg);
    }
    // Boneco grande na partida (ao festejar, com o animal de estimação ao lado).
    function showShooter(player, pose = 'golfe') {
      const svg = kit.drawCharacter(player, pose, { size: SHOOTER.h, withPet: pose === 'festejar' });
      svg.setAttribute('x', SHOOTER.x);
      svg.setAttribute('y', SHOOTER.bottom - SHOOTER.h);
      shooterLayer.replaceChildren(svg);
    }

    // Bola: o retrato do jogador num círculo da sua cor, com um anel branco.
    const ballShape = (player) => s('g', { class: 'golf-ball', 'data-id': player.id }, [kit.portraitMark(player, BALL_R, 0, 0, 1.4)]);
    const put = (node, x, y, scale = 1) => node.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})${scale !== 1 ? ` scale(${scale.toFixed(2)})` : ''}`);

    // Emblema de quem meteu a bola no buraco: na bandeira, por baixo do pano.
    function holeBadge(player) {
      const k = holed++;
      const g = ballShape(player);
      g.classList.add('golf-badge');
      put(g, HOLE.x - 10 - Math.floor(k / 3) * 14, POLE_TOP + 20 + (k % 3) * 13);
      badgesLayer.append(g);
    }

    function fxText(str, cls) {
      const t = text({ x: VW / 2, y: GREEN.y + GREEN.ry - 18, 'text-anchor': 'middle', class: `golf-fx-text ${cls}` }, str);
      fxLayer.append(t);
      later(() => t.remove(), 1400);
    }
    function splash(to) {
      const g = s('g', { class: 'golf-splash', transform: `translate(${to.x} ${to.y})` }, [
        s('circle', { r: 4, class: 'golf-ripple' }),
        s('circle', { r: 4, class: 'golf-ripple second' }),
        ...[-1, 0, 1].map((k) => s('circle', { cx: k * 6, cy: -6 - Math.abs(k) * -2, r: 2.2, fill: '#a5d8ff', class: 'golf-drop' })),
      ]);
      fxLayer.append(g);
      later(() => g.remove(), 1200);
    }
    // "Hole in one": raios dourados à volta do buraco e estrelinhas (uma vez).
    function holeInOne() {
      // A posição vai no grupo de fora (atributo); a animação (CSS), no de dentro.
      const g = s('g', { transform: `translate(${HOLE.x} ${HOLE.y})` }, [s('g', { class: 'golf-hio' }, [
        ...Array.from({ length: 12 }, (_, i) => s('line', {
          x1: 0, y1: -9, x2: 0, y2: -24, stroke: i % 2 ? '#ffd43b' : '#fff3bf', 'stroke-width': 2.4, 'stroke-linecap': 'round',
          transform: `rotate(${i * 30})`,
        })),
        s('circle', { r: 9, fill: 'none', stroke: '#ffd43b', 'stroke-width': 2.5 }),
      ])]);
      fxLayer.append(g);
      later(() => g.remove(), 1500);
    }

    // Marca final de cada bola (sem animação): no buraco vira emblema na bandeira; no lago fica
    // a boiar meio afundada.
    function settle(node, player, pl) {
      if (pl.where === 'buraco') {
        node.remove();
        holeBadge(player);
        return;
      }
      put(node, pl.x, pl.y);
      if (pl.where === 'lago') node.classList.add('sunk');
    }

    return {
      mount(container, { players, kit: k, seed }) {
        kit = k;
        row = {};
        holed = 0;
        roundSeed = seed;
        const n = players.length;
        const twoRows = n > 6;
        const vh = twoRows ? VH_TALL : VH;
        scene = s('svg', { viewBox: `0 0 ${VW} ${vh}`, class: 'golf-scene', role: 'img', 'aria-label': 'Golfe: quanto mais perto do buraco, mais perto da resposta certa' });
        kit.sizeScene(scene, VW, vh, twoRows ? 60 : 45);

        // Relva (com riscas do corte), green, lago e partida.
        scene.append(s('rect', { x: 0, y: 0, width: VW, height: vh, rx: 10, fill: '#2b8a3e' }));
        for (let x = -40; x < VW; x += 36) scene.append(s('path', { d: `M${x},0 L${x + 18},0 L${x + 18 - 60},${vh} L${x - 60},${vh} Z`, fill: '#2f9e44', opacity: 0.6 }));
        scene.append(
          s('ellipse', { cx: GREEN.x, cy: GREEN.y, rx: GREEN.rx + 6, ry: GREEN.ry + 6, fill: '#37b24d' }),
          s('ellipse', { cx: GREEN.x, cy: GREEN.y, rx: GREEN.rx, ry: GREEN.ry, fill: '#69db7c' }),
          s('ellipse', { cx: GREEN.x - 12, cy: GREEN.y + 6, rx: GREEN.rx * 0.62, ry: GREEN.ry * 0.55, fill: '#8ce99a', opacity: 0.35 }),
          // Lago com reflexos.
          s('path', { d: `M${LAKE.x - LAKE.rx},${LAKE.y} Q${LAKE.x - LAKE.rx + 4},${LAKE.y - LAKE.ry - 4} ${LAKE.x},${LAKE.y - LAKE.ry} Q${LAKE.x + LAKE.rx + 6},${LAKE.y - LAKE.ry + 2} ${LAKE.x + LAKE.rx},${LAKE.y + 2} Q${LAKE.x + LAKE.rx - 8},${LAKE.y + LAKE.ry + 4} ${LAKE.x},${LAKE.y + LAKE.ry} Q${LAKE.x - LAKE.rx - 4},${LAKE.y + LAKE.ry - 2} ${LAKE.x - LAKE.rx},${LAKE.y} Z`, fill: '#1c7ed6', stroke: '#a5d8ff', 'stroke-width': 1.5 }),
          s('path', { d: `M${LAKE.x - 24},${LAKE.y - 6} q6,-3 12,0 M${LAKE.x + 6},${LAKE.y + 6} q6,-3 12,0`, fill: 'none', stroke: '#a5d8ff', 'stroke-width': 1.2, opacity: 0.7 }),
          // Partida (tapete) e o buraco com a bandeira.
          s('rect', { x: TEE.x - 14, y: TEE.y - 6, width: 28, height: 12, rx: 3, fill: '#2f9e44', stroke: '#8ce99a', 'stroke-width': 1 }),
          s('circle', { cx: HOLE.x, cy: HOLE.y, r: HOLE.r + 1.2, fill: '#2b8a3e' }),
          s('circle', { cx: HOLE.x, cy: HOLE.y, r: HOLE.r, fill: '#111' }),
          s('line', { x1: HOLE.x + 1, y1: HOLE.y, x2: HOLE.x + 15, y2: HOLE.y + 6, stroke: '#000', 'stroke-width': 1.6, opacity: 0.2 }),
          s('line', { x1: HOLE.x, y1: HOLE.y, x2: HOLE.x, y2: POLE_TOP, stroke: '#f8f9fa', 'stroke-width': 1.8 }),
          s('path', { d: `M${HOLE.x},${POLE_TOP} L${HOLE.x + 22},${POLE_TOP + 6} L${HOLE.x},${POLE_TOP + 12} Z`, fill: '#e03131' }),
        );

        // Placa da resposta certa, no topo (nenhuma bola vai lá).
        answerText = text({ x: VW / 2 + 22, y: 18, 'text-anchor': 'middle', class: 'golf-answer' }, '?');
        scene.append(
          s('rect', { x: 88, y: 4, width: 124, height: 20, rx: 6, class: 'golf-plaque' }),
          text({ x: 94, y: 16.5, class: 'golf-plaque-label' }, 'RESPOSTA'),
          answerText,
        );

        ballsLayer = s('g', { class: 'golf-balls' });
        badgesLayer = s('g', { class: 'golf-badges' });
        fxLayer = s('g', { class: 'golf-fx' });
        shooterLayer = s('g', { class: 'golf-shooter' });

        // Fila em baixo: o boneco de cada jogador. Com mais de 6, duas filas desencontradas.
        const rowLayer = s('g', { class: 'golf-row' });
        if (!twoRows) {
          const slot = VW / n;
          const h = Math.min(60, slot * 1.25);
          const w = h * (100 / 130);
          players.forEach((p, i) => {
            const g = s('g', { class: 'golf-row-player', 'data-id': p.id });
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
            const g = s('g', { class: 'golf-row-player', 'data-id': p.id });
            row[p.id] = {
              g, player: p, h, w, small: true,
              x: Math.floor(i / 2) * slot + (slot - w) / 2 + (behind ? slot / 2 : 0),
              bottom: behind ? vh - 2 - h * 0.8 : vh - 2,
            };
            (behind ? back : front).append(g);
          });
          rowLayer.append(back, front);
        }
        for (const p of players) drawRow(p.id, 'parado');

        scene.append(rowLayer, shooterLayer, ballsLayer, badgesLayer, fxLayer);
        container.append(scene);
        plans = plan(players, seed);
      },

      revealPlayer(player, precision, { instant }) {
        const pl = plans[player.id];
        row[player.id].g.classList.add('shot');
        showShooter(player, 'golfe');
        const node = ballShape(player);
        ballsLayer.append(node);
        if (instant || kit.reducedMotion()) {
          settle(node, player, pl);
          return;
        }
        // A bola rola da partida até parar (abranda no fim), numa curva ligeira; no buraco,
        // desaparece lá dentro; no lago, "splash".
        const rnd = window.RevealSeeded.seeded(`${roundSeed}|${player.id}|curva`);
        const bend = (rnd() - 0.5) * 50;
        const mid = { x: (TEE.x + pl.x) / 2 + bend * 0.4, y: (TEE.y + pl.y) / 2 + bend };
        const start = performance.now();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          cancelAnimationFrame(rolls.get(player.id)?.frame);
          rolls.delete(player.id);
          settle(node, player, pl);
        };
        const frame = (now) => {
          const t = Math.min(1, (now - start) / ROLL_MS);
          const e = 1 - (1 - t) ** 2.4;
          const x = (1 - e) ** 2 * TEE.x + 2 * (1 - e) * e * mid.x + e ** 2 * pl.x;
          const y = (1 - e) ** 2 * TEE.y + 2 * (1 - e) * e * mid.y + e ** 2 * pl.y;
          // No buraco, a bola encolhe nos últimos instantes (cai lá dentro).
          put(node, x, y, pl.where === 'buraco' && t > 0.85 ? Math.max(0.2, 1 - (t - 0.85) * 5) : 1);
          if (t < 1) { rolls.get(player.id).frame = requestAnimationFrame(frame); return; }
          if (pl.where === 'buraco') {
            if (player.show.exact) { holeInOne(); fxText('HOLE IN ONE!', 'gold'); } else fxText('NO BURACO!', 'win');
            kit.sound('golo');
          } else if (pl.where === 'lago') {
            splash(pl);
            fxText('SPLASH!', 'miss');
          } else if (pl.where === 'relva') fxText('Fora do green!', 'miss');
          finish();
        };
        rolls.set(player.id, { frame: requestAnimationFrame(frame), finish });
      },

      // Resposta certa na placa (a rolar até ao valor). Na fila, o mais perto festeja e o mais
      // longe reage (com as escolhas de cada um); em grande, quem ganhou a festejar.
      revealAnswer(answer, { closest, farthest, instant }) {
        for (const r of [...rolls.values()]) r.finish();
        if (instant) answerText.textContent = kit.fmt(answer);
        else kit.countUp(answerText, answer);
        for (const id of Object.keys(row)) {
          const near = closest.includes(id);
          const far = farthest.includes(id) && !near;
          drawRow(id, near ? 'festejar' : far ? 'triste' : 'parado');
          row[id].g.classList.toggle('near', near);
          row[id].g.classList.toggle('far', far);
        }
        if (closest.length && row[closest[0]]) showShooter(row[closest[0]].player, 'festejar');
        for (const b of [...ballsLayer.children, ...badgesLayer.children]) {
          b.classList.toggle('near', closest.includes(b.dataset.id));
          b.classList.toggle('far', farthest.includes(b.dataset.id) && !closest.includes(b.dataset.id));
        }
      },

      skipToEnd() {
        for (const r of [...rolls.values()]) r.finish();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        fxLayer.replaceChildren();
      },

      destroy() {
        for (const r of rolls.values()) cancelAnimationFrame(r.frame);
        rolls.clear();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        if (answerText) kit.stopCount(answerText);
        if (scene) scene.remove();
        scene = ballsLayer = badgesLayer = fxLayer = shooterLayer = answerText = null;
        plans = {};
        row = {};
      },
    };
  });
})();
