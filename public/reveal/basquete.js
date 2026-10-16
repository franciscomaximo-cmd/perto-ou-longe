'use strict';

// Tema "basquetebol": um cesto visto de lado, a bancada atrás e, em baixo, a fila de
// jogadores. Na vez de cada um, o seu boneco (em grande, na linha de lance livre, na pose "a
// lançar ao cesto") lança a bola (laranja, com o anel na cor do jogador e o seu retrato). O que
// acontece vem da posição de apresentação (player.show), relativa à ronda:
//   - o vencedor faz "swish" (entra sem tocar no aro); o "em cheio" faz a rede pegar fogo;
//   - os outros, pela posição na ronda: batem no aro (os melhores), na tabela, ou ficam curtos
//     (os piores e quem errou mais de 100%); a bola fica no chão, mais perto do cesto quanto
//     melhor foi o palpite, sem bolas sobrepostas;
//   - o "mais longe" faz um "air ball": a bola nem toca no cesto e sai do campo.
//
// Cena SVG de tamanho fixo (viewBox 300 × 300; 300 × 340 com mais de 6 jogadores, com duas
// filas em baixo), por zonas:
//   - topo à esquerda: placa da resposta certa (nenhuma bola passa lá);
//   - cesto à direita; quem lança à esquerda; chão do campo onde as bolas ficam;
//   - em baixo, a fila com o boneco de cada jogador.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const VW = 300;
  const VH = 300;
  const VH_TALL = 340;
  const FLOOR = 198; // linha do chão (vista de lado)
  const RIM = { x: 242, y: 104, rx: 20 };
  const BOARD = { x: 262, top: 50, bottom: 112 };
  // Quem lança: de pés no chão do campo (a meio da faixa do chão, não na linha do fundo, que
  // fica junto à bancada).
  const SHOOTER = { x: 30, bottom: 224, h: 66 };
  const LANES = [205, 221]; // profundidades no chão onde as bolas ficam paradas
  const BALL_R = 7;
  const MIN_GAP = 15; // (as duas profundidades estão a 16: palpites iguais ficam lado a lado)
  const LEGS_MS = [600, 220, 280]; // voo até ao cesto, o que acontece lá, e o ressalto até parar

  function s(tag, attrs = {}, children = []) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    for (const c of children) if (c) node.append(c);
    return node;
  }
  const text = (attrs, str) => s('text', attrs, [document.createTextNode(str)]);

  // O que acontece a cada lançamento e onde a bola fica parada no chão.
  function plan(players) {
    const out = {};
    const placed = [];
    const free = (pt) => placed.every((q) => Math.hypot(pt.x - q.x, pt.y - q.y) >= MIN_GAP);
    // Procura o lugar livre mais perto do sítio pedido: alterna as duas profundidades e, se
    // for preciso, afasta-se do cesto (para a esquerda).
    const spot = (x, k) => {
      for (let step = 0; step < 40; step++) {
        for (const lane of [LANES[(k + step) % 2], LANES[(k + step + 1) % 2]]) {
          const pt = { x: x - step * 8, y: lane };
          if (free(pt)) { placed.push(pt); return pt; }
        }
      }
      return { x, y: LANES[0] };
    };
    // Primeiro os vencedores (debaixo do cesto), depois os outros do melhor para o pior.
    const sorted = [...players].sort((a, b) => (b.show.winner - a.show.winner) || (a.show.level - b.show.level));
    let air = 0;
    sorted.forEach((p, k) => {
      if (p.show.winner) { out[p.id] = { kind: 'swish', rest: spot(RIM.x + 2, k) }; return; }
      if (p.show.farthest) {
        // Air ball: sai do campo, por trás do poste (se forem vários, um ao lado do outro).
        const a = air++;
        out[p.id] = { kind: 'air', rest: { x: 292 - Math.floor(a / 2) * 15, y: LANES[a % 2] + 2 } };
        return;
      }
      const kind = p.show.miss || p.show.level >= 0.62 ? 'curta' : p.show.level >= 0.38 ? 'tabela' : 'aro';
      // Mais perto do cesto quanto melhor o nível (palpites iguais: o mesmo sítio pedido).
      // (Até x 106: mais para a esquerda ficavam nos pés de quem lança.)
      const x = RIM.x - 16 - 120 * Math.max(0, (p.show.level - 0.15) / 0.7);
      out[p.id] = { kind, rest: spot(x, k) };
    });
    return out;
  }

  // Troços do caminho da bola: [de, controlo, até] (curvas de Bézier quadráticas).
  function legsOf(pl, from) {
    const { rest } = pl;
    const apex = (a, b, peak) => ({ x: (a.x + b.x) / 2, y: 2 * peak - (a.y + b.y) / 2 });
    switch (pl.kind) {
      case 'swish': {
        const a = { x: RIM.x, y: RIM.y - 4 };
        const b = { x: RIM.x, y: RIM.y + 30 };
        return [[from, apex(from, a, 34), a], [a, { x: RIM.x, y: RIM.y + 12 }, b], [b, apex(b, rest, FLOOR - 26), rest]];
      }
      case 'aro': {
        const a = { x: RIM.x - RIM.rx + 2, y: RIM.y - 2 };
        const b = { x: a.x - 18, y: RIM.y - 22 };
        return [[from, apex(from, a, 38), a], [a, { x: a.x - 6, y: a.y - 22 }, b], [b, apex(b, rest, b.y - 10), rest]];
      }
      case 'tabela': {
        const a = { x: BOARD.x - 3, y: 82 };
        const b = { x: BOARD.x - 26, y: 120 };
        return [[from, apex(from, a, 30), a], [a, { x: a.x - 8, y: 96 }, b], [b, apex(b, rest, b.y - 6), rest]];
      }
      case 'air': {
        const a = { x: RIM.x - 6, y: RIM.y + 40 }; // passa por baixo da rede, sem tocar
        const b = { x: 280, y: FLOOR + 6 };
        return [[from, apex(from, a, 50), a], [a, { x: 268, y: a.y + 10 }, b], [b, apex(b, rest, FLOOR - 8), rest]];
      }
      default: { // curta: cai antes do cesto e dá um pulinho
        const a = { x: rest.x + 14, y: rest.y };
        return [[from, apex(from, a, 52), a], [a, apex(a, rest, rest.y - 14), rest], [rest, rest, rest]];
      }
    }
  }
  const at = ([a, c, b], t) => ({
    x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x,
    y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y,
  });

  window.RevealThemes.register('basquete', () => {
    let kit = null;
    let scene = null;
    let net = null;
    let fireLayer = null;
    let ballsLayer = null;
    let fxLayer = null;
    let shooterLayer = null;
    let answerText = null;
    let plans = {};
    let row = {};
    const flights = new Map();
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

    let shooterId = null; // quem está em grande na linha de lance livre (não aparece na fila)

    // Cada jogador só aparece uma vez no cenário: quem está em grande deixa o seu lugar na
    // fila vazio (só a sombra no chão).
    function drawRow(id, pose) {
      const r = row[id];
      r.pose = pose;
      if (id === shooterId) {
        r.g.replaceChildren(s('ellipse', { cx: r.x + r.w / 2, cy: r.bottom - 3, rx: r.w * 0.32, ry: 3, fill: '#000', opacity: 0.2 }));
        return;
      }
      const svg = kit.drawCharacter(r.player, pose, { size: r.h, small: r.small });
      svg.setAttribute('x', r.x);
      svg.setAttribute('y', r.bottom - r.h);
      r.g.replaceChildren(svg);
    }
    // Boneco grande na linha de lance livre, de pés no chão do campo (ao festejar, com o
    // animal de estimação). O jogador anterior volta ao seu lugar na fila.
    function showShooter(player, pose = 'basquete') {
      const svg = kit.drawCharacter(player, pose, { size: SHOOTER.h, withPet: pose === 'festejar' });
      svg.setAttribute('x', SHOOTER.x);
      svg.setAttribute('y', SHOOTER.bottom - SHOOTER.h);
      shooterLayer.replaceChildren(svg);
      const prev = shooterId;
      if (prev === player.id) return;
      shooterId = player.id;
      if (prev && row[prev]) drawRow(prev, row[prev].pose);
      if (row[player.id]) drawRow(player.id, row[player.id].pose);
    }
    const handPoint = () => ({ x: SHOOTER.x + SHOOTER.h * (51 / 130), y: SHOOTER.bottom - SHOOTER.h + SHOOTER.h * (9 / 130) });

    // Bola laranja com o anel na cor do jogador e, ao meio, o seu retrato.
    const ballShape = (player) => s('g', { class: 'basq-ball', 'data-id': player.id }, [
      s('circle', { r: BALL_R, fill: '#f76707', stroke: player.color, 'stroke-width': 2.4 }),
      kit.portraitMark(player, BALL_R - 1.8, 0, 0, 0),
    ]);
    const put = (node, p, rot = 0) => node.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})${rot ? ` rotate(${rot.toFixed(0)})` : ''}`);

    function fxText(str, cls, size = null) {
      const t = text({ x: 150, y: 172, 'text-anchor': 'middle', class: `basq-fx-text ${cls}`, style: size ? `font-size:${size}px` : null }, str);
      fxLayer.append(t);
      later(() => t.remove(), 1300);
    }
    function rippleNet() {
      net.classList.remove('ripple');
      void net.getBoundingClientRect();
      net.classList.add('ripple');
    }
    // "Em cheio": a rede pega fogo (chamas que tremem umas vezes) e fica chamuscada.
    function setNetOnFire(animate) {
      net.classList.add('burnt');
      if (!animate) return;
      const flames = s('g', { class: 'basq-fire' }, [-12, -4, 4, 12].map((dx, i) => s('path', {
        d: `M${RIM.x + dx - 5},${RIM.y + 26} Q${RIM.x + dx - 7},${RIM.y + 12} ${RIM.x + dx},${RIM.y + 2 - (i % 2) * 6} Q${RIM.x + dx + 7},${RIM.y + 12} ${RIM.x + dx + 5},${RIM.y + 26} Z`,
        fill: i % 2 ? '#ffd43b' : '#ff922b', class: `flame f${i}`,
      })));
      fireLayer.append(flames);
      later(() => flames.remove(), 1700);
    }

    function land(player, pl, animate) {
      if (pl.kind === 'swish') {
        if (player.show.exact) setNetOnFire(animate);
        if (!animate) return;
        rippleNet();
        if (player.show.exact) fxText('EM CHEIO! 🔥', 'gold', 19);
        else fxText('SWISH!', 'win');
        kit.sound('golo');
      } else if (animate) {
        fxText({ aro: 'Ao aro!', tabela: 'Tabela!', curta: 'Curta!', air: 'AIR BALL!' }[pl.kind], pl.kind === 'air' ? 'air' : 'miss', pl.kind === 'air' ? 19 : null);
      }
    }

    return {
      mount(container, { players, kit: k }) {
        kit = k;
        row = {};
        shooterId = null;
        const n = players.length;
        const twoRows = n > 6;
        const vh = twoRows ? VH_TALL : VH;
        scene = s('svg', { viewBox: `0 0 ${VW} ${vh}`, class: 'basq-scene', role: 'img', 'aria-label': 'Basquetebol: quanto melhor o lançamento, mais perto da resposta certa' });
        kit.sizeScene(scene, VW, vh, twoRows ? 60 : 45);

        // Pavilhão: bancada com público (pontinhos) e o chão de madeira do campo.
        scene.append(s('rect', { x: 0, y: 0, width: VW, height: vh, rx: 10, fill: '#241e55' }));
        const crowd = s('g', { opacity: 0.35 });
        for (let r = 0; r < 7; r++) {
          for (let x = 8 + (r % 2) * 7; x < VW; x += 14) {
            crowd.append(s('circle', { cx: x, cy: 40 + r * 16, r: 4, fill: ['#f783ac', '#4dabf7', '#ffd43b', '#3ddc97', '#ff922b'][(x + r * 3) % 5] }));
          }
        }
        scene.append(crowd, s('rect', { x: 0, y: 150, width: VW, height: FLOOR - 150, fill: '#1d1846', opacity: 0.8 }));
        scene.append(
          s('rect', { x: 0, y: FLOOR, width: VW, height: vh - FLOOR, fill: '#d9a066' }),
          s('path', { d: `M0,${FLOOR} L${VW},${FLOOR}`, stroke: '#a0692f', 'stroke-width': 2 }),
          s('path', { d: `M0,${FLOOR + 14} L${VW},${FLOOR + 14} M0,${FLOOR + 28} L${VW},${FLOOR + 28}`, stroke: '#c08040', 'stroke-width': 0.8, opacity: 0.6 }),
          // Linha de lance livre e linha de fundo (marcas no chão).
          s('path', { d: `M${SHOOTER.x + 44},${FLOOR + 2} L${SHOOTER.x + 48},${FLOOR + 30}`, stroke: '#fff', 'stroke-width': 2, opacity: 0.8 }),
          s('path', { d: `M276,${FLOOR + 2} L280,${FLOOR + 30}`, stroke: '#fff', 'stroke-width': 2, opacity: 0.8 }),
        );

        // Poste, tabela, aro (metade de trás) e rede.
        scene.append(
          s('path', { d: `M${BOARD.x + 6},84 L284,84 L284,${FLOOR}`, fill: 'none', stroke: '#868e96', 'stroke-width': 5, 'stroke-linejoin': 'round' }),
          s('rect', { x: BOARD.x, y: BOARD.top, width: 6, height: BOARD.bottom - BOARD.top, rx: 1, fill: '#f8f9fa', stroke: '#adb5bd', 'stroke-width': 1 }),
          s('rect', { x: BOARD.x - 1, y: 84, width: 2, height: 22, fill: '#e03131' }),
          s('path', { d: `M${RIM.x - RIM.rx},${RIM.y} A${RIM.rx},4 0 0 1 ${RIM.x + RIM.rx},${RIM.y}`, fill: 'none', stroke: '#c2410c', 'stroke-width': 2.5 }),
          s('line', { x1: RIM.x + RIM.rx, y1: RIM.y, x2: BOARD.x, y2: RIM.y, stroke: '#c2410c', 'stroke-width': 2.5 }),
        );
        net = s('g', { class: 'basq-net' });
        for (let i = 0; i <= 6; i++) {
          const top = RIM.x - RIM.rx + 2 + i * ((2 * RIM.rx - 4) / 6);
          const bottom = RIM.x - 11 + i * (22 / 6);
          net.append(s('line', { x1: top, y1: RIM.y + 1, x2: bottom, y2: RIM.y + 26, stroke: '#f1f3f5', 'stroke-width': 1 }));
        }
        for (const dy of [9, 18]) net.append(s('line', { x1: RIM.x - RIM.rx + 4 + dy * 0.35, y1: RIM.y + dy, x2: RIM.x + RIM.rx - 4 - dy * 0.35, y2: RIM.y + dy, stroke: '#f1f3f5', 'stroke-width': 0.8 }));
        scene.append(net);

        // Placa da resposta certa, no topo à esquerda (nenhuma bola passa lá).
        answerText = text({ x: 100, y: 22, 'text-anchor': 'middle', class: 'basq-answer' }, '?');
        scene.append(
          s('rect', { x: 10, y: 6, width: 140, height: 24, rx: 7, class: 'basq-plaque' }),
          text({ x: 17, y: 21, class: 'basq-plaque-label' }, 'RESPOSTA'),
          answerText,
        );

        shooterLayer = s('g', { class: 'basq-shooter' });
        ballsLayer = s('g', { class: 'basq-balls' });
        fireLayer = s('g', { class: 'basq-fire-layer' });
        fxLayer = s('g', { class: 'basq-fx' });
        // Metade da frente do aro, por cima das bolas (a bola passa por dentro do aro).
        const rimFront = s('path', { d: `M${RIM.x - RIM.rx},${RIM.y} A${RIM.rx},4 0 0 0 ${RIM.x + RIM.rx},${RIM.y}`, fill: 'none', stroke: '#e8590c', 'stroke-width': 2.8 });

        // Fila em baixo: o boneco de cada jogador. Com mais de 6, duas filas desencontradas.
        const rowLayer = s('g', { class: 'basq-row' });
        if (!twoRows) {
          const slot = VW / n;
          const h = Math.min(60, slot * 1.25);
          const w = h * (100 / 130);
          players.forEach((p, i) => {
            const g = s('g', { class: 'basq-row-player', 'data-id': p.id });
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
            const g = s('g', { class: 'basq-row-player', 'data-id': p.id });
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

        scene.append(rowLayer, shooterLayer, ballsLayer, rimFront, fireLayer, fxLayer);
        container.append(scene);
        plans = plan(players);
      },

      revealPlayer(player, precision, { instant }) {
        const pl = plans[player.id];
        row[player.id].g.classList.add('shot');
        showShooter(player, 'basquete');
        const node = ballShape(player);
        ballsLayer.append(node);
        if (instant || kit.reducedMotion()) {
          put(node, pl.rest);
          land(player, pl, false);
          return;
        }
        const legs = legsOf(pl, handPoint());
        const total = LEGS_MS.reduce((a, b) => a + b, 0);
        const start = performance.now();
        let landed = false;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          cancelAnimationFrame(flights.get(player.id)?.frame);
          flights.delete(player.id);
          put(node, pl.rest);
          if (!landed) { landed = true; land(player, pl, false); }
        };
        const frame = (now) => {
          const t = now - start;
          let acc = 0;
          let i = 0;
          while (i < 2 && t > acc + LEGS_MS[i]) acc += LEGS_MS[i++];
          const k = Math.min(1, (t - acc) / LEGS_MS[i]);
          put(node, at(legs[i], i === 0 ? k * (2 - k) * 0.5 + k * 0.5 : k), t * 0.6);
          // Ao chegar ao cesto (fim do 1.º troço): swish, aro, tabela, curta ou air ball.
          if (!landed && i >= 1) { landed = true; land(player, pl, true); }
          if (t < total) { flights.get(player.id).frame = requestAnimationFrame(frame); return; }
          finish();
        };
        flights.set(player.id, { frame: requestAnimationFrame(frame), finish });
      },

      // Resposta certa na placa (a rolar até ao valor). Na fila, o mais perto festeja e o mais
      // longe reage (com as escolhas de cada um); em grande, quem ganhou a festejar.
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
        if (closest.length && row[closest[0]]) showShooter(row[closest[0]].player, 'festejar');
        for (const b of ballsLayer.children) {
          b.classList.toggle('near', closest.includes(b.dataset.id));
          b.classList.toggle('far', farthest.includes(b.dataset.id) && !closest.includes(b.dataset.id));
        }
      },

      skipToEnd() {
        for (const f of [...flights.values()]) f.finish();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        fxLayer.replaceChildren();
        fireLayer.replaceChildren();
        net.classList.remove('ripple');
      },

      destroy() {
        for (const f of flights.values()) cancelAnimationFrame(f.frame);
        flights.clear();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        if (answerText) kit.stopCount(answerText);
        if (scene) scene.remove();
        scene = net = fireLayer = ballsLayer = fxLayer = shooterLayer = answerText = null;
        plans = {};
        row = {};
      },
    };
  });
})();
