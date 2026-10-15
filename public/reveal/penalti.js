'use strict';

// Tema "penálti", com guarda-redes. Na vez de cada jogador, o seu boneco (pose "a rematar")
// corre e remata; o guarda-redes atira-se.
//
// Quem marca e quem falha vem da posição de apresentação (player.show), relativa à ronda e
// calculada a partir do resultado do SERVIDOR:
//   - golo: SÓ quem ganhou o ponto de "mais perto" (se houver empate, todos), sempre no ângulo,
//     com o guarda-redes atirado para o lado errado; no "em cheio", GOLAÇO e a rede rasga;
//   - o "mais longe": a bola vai parar à bancada (cantos de cima);
//   - defesa: os outros que não falharam por mais de 100% (agarra, soca ou desvia com a mão ou
//     o pé); quanto pior o nível, mais ao centro;
//   - erro um pouco acima de 100%: bate no poste ou na barra e sai; maior: por cima ou ao lado.
//
// O canto e o ponto exato vêm de um gerador com semente (ronda + id do jogador), por isso são
// IGUAIS em todos os telemóveis e depois de recarregar. O mesmo para o mergulho do
// guarda-redes. As marcas nunca ficam no mesmo sítio.
//
// Cena SVG de tamanho fixo (viewBox 300 × 300; 300 × 340 com mais de 6 jogadores, com duas
// filas em baixo), por zonas:
//   - topo: placa da resposta certa (nenhuma bola vai lá);
//   - baliza com rede, postes e barra;
//   - relvado com a marca de penálti e o boneco de quem remata;
//   - em baixo, a fila com o boneco de cada jogador.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const VW = 300;
  const VH = 300;
  const VH_TALL = 340; // com mais de 6 jogadores (duas filas em baixo)
  const GOAL = { l: 64, r: 236, t: 46, b: 134 }; // dentro dos postes e da barra
  const CENTER = { x: 150, y: 92 };
  const SPOT = { x: 150, y: 198 };
  const ROW_TOP = 228;
  const KEEPER = { x: 150, y: 110 }; // centro do corpo do guarda-redes, de pé
  const REACH = 27; // do centro do corpo às luvas
  const MARK_R = 7.5;
  const MIN_GAP = 17; // distância mínima entre marcas
  const RUN_MS = 220;
  const FLY_MS = 380;
  const FX_MS = 900;

  function s(tag, attrs = {}, children = []) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    for (const c of children) if (c) node.append(c);
    return node;
  }
  const text = (attrs, str) => s('text', attrs, [document.createTextNode(str)]);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // Guarda-redes (não é um jogador: desenha-se aqui), equipamento cinzento-escuro neutro.
  // Origem no centro do corpo; braços no ar, luvas brancas a ~REACH do centro.
  function keeperShape() {
    return s('g', { class: 'pen-keeper-body' }, [
      s('path', { d: 'M-5,8 L-7,24 M5,8 L7,24', stroke: '#212529', 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
      s('rect', { x: -8, y: 2, width: 16, height: 8, rx: 2, fill: '#212529' }),
      s('rect', { x: -9, y: -12, width: 18, height: 16, rx: 4, fill: '#495057', stroke: '#2b2f33', 'stroke-width': 1 }),
      s('path', { d: 'M-9,-6 L9,-6', stroke: '#adb5bd', 'stroke-width': 1.5 }),
      s('path', { d: 'M-7,-10 L-11,-27 M7,-10 L11,-27', stroke: '#495057', 'stroke-width': 4, 'stroke-linecap': 'round' }),
      s('circle', { cx: -11.5, cy: -28, r: 3.6, fill: '#f8f9fa', stroke: '#adb5bd', 'stroke-width': 0.8 }),
      s('circle', { cx: 11.5, cy: -28, r: 3.6, fill: '#f8f9fa', stroke: '#adb5bd', 'stroke-width': 0.8 }),
      s('circle', { cx: 0, cy: -18, r: 6, fill: '#ffd8a8', stroke: '#e0a96d', 'stroke-width': 0.8 }),
      s('path', { d: 'M-6,-20 Q0,-27 6,-20', fill: '#343a40' }),
    ]);
  }

  // Onde vai cada remate, como reage o guarda-redes e que tipo de defesa, a partir da posição
  // de apresentação (player.show) e da semente da ronda + id do jogador (determinístico).
  function plan(players, seed) {
    const placed = [];
    const out = {};
    const corners = [
      { x: GOAL.l + 9, y: GOAL.t + 9 }, { x: GOAL.r - 9, y: GOAL.t + 9 },
      { x: GOAL.l + 9, y: GOAL.b - 9 }, { x: GOAL.r - 9, y: GOAL.b - 9 },
    ];
    const free = (pt) => (placed.length ? Math.min(...placed.map((q) => dist(pt, q))) : Infinity);
    // Vencedores: cada um no seu ângulo (primeiro os de cima, a começar por um lado ao calhas).
    const winners = players.filter((p) => p.show.winner);
    const firstSide = Math.floor(window.RevealSeeded.seeded(`${seed}|golo`)() * 2);
    const farthest = players.filter((p) => p.show.farthest);

    for (const p of players) {
      const rng = window.RevealSeeded.seeded(`${seed}|${p.id}`);
      const show = p.show;
      const kind = show.winner ? 'golo' : show.farthest ? 'bancada' : !show.miss ? 'defesa' : p.precision <= 1.12 ? 'ferro' : 'fora';
      // Melhor de várias tentativas: o ponto mais afastado das marcas já postas.
      let best = null;
      for (let tries = 0; tries < 24; tries++) {
        let pt;
        let hit = null; // ferro: onde bate antes de sair
        if (kind === 'golo') {
          // No ângulo (o "em cheio" mesmo no canto), longe do guarda-redes.
          const k = winners.indexOf(p);
          const c = tries < 8
            ? corners[k < 2 ? (firstSide + k) % 2 : 2 + ((firstSide + k) % 2)]
            : corners[Math.floor(rng() * 4)];
          const f = (show.exact ? 0.02 : 0.07) + (tries < 8 ? 0 : rng() * 0.15);
          pt = {
            x: clamp(c.x + (CENTER.x - c.x) * f + (rng() - 0.5) * 6, GOAL.l + 8, GOAL.r - 8),
            y: clamp(c.y + (CENTER.y - c.y) * f + (rng() - 0.5) * 4, GOAL.t + 8, GOAL.b - 8),
          };
        } else if (kind === 'defesa') {
          // Defendido: quanto pior o nível, mais para o centro (mais fácil para o guarda-redes).
          const c = corners[Math.floor(rng() * 4)];
          const f = 0.12 + 0.8 * show.level;
          const jitter = (rng() - 0.5) * 22;
          pt = {
            x: c.x + (CENTER.x - c.x) * f + jitter * 0.6,
            y: c.y + (CENTER.y - c.y) * f + jitter * 0.4,
          };
          pt.x = clamp(pt.x, GOAL.l + 8, GOAL.r - 8);
          pt.y = clamp(pt.y, GOAL.t + 8, GOAL.b - 8);
        } else if (kind === 'ferro') {
          const which = Math.floor(rng() * 3); // 0 poste esq., 1 poste dir., 2 barra
          if (which === 2) {
            hit = { x: GOAL.l + 20 + rng() * (GOAL.r - GOAL.l - 40), y: GOAL.t - 1, where: 'barra' };
            pt = { x: hit.x + (rng() - 0.5) * 30, y: GOAL.t - 16 };
          } else {
            const left = which === 0;
            hit = { x: left ? GOAL.l - 1 : GOAL.r + 1, y: GOAL.t + 14 + rng() * (GOAL.b - GOAL.t - 30), where: 'poste' };
            pt = { x: left ? GOAL.l - 20 : GOAL.r + 20, y: hit.y + (rng() - 0.5) * 24 };
          }
        } else if (kind === 'bancada') {
          // O "mais longe": a bola vai parar à bancada, num dos cantos de cima (longe da placa
          // da resposta, ao meio). Se forem vários, alternam os lados.
          const left = (farthest.indexOf(p) + (rng() < 0.5 ? 0 : 1)) % 2 === 0;
          pt = { x: left ? 12 + rng() * 52 : 236 + rng() * 52, y: 9 + rng() * 22, where: 'bancada' };
        } else {
          const over = rng() < 0.5;
          pt = over
            ? { x: 78 + rng() * 144, y: 30 + rng() * 6, where: 'por cima' }
            : { x: rng() < 0.5 ? 32 + rng() * 16 : 252 + rng() * 16, y: 62 + rng() * 64, where: 'ao lado' };
        }
        const score = free(pt);
        if (!best || score > best.score) best = { pt, hit, score };
        if (score >= MIN_GAP) break;
      }
      const pt = best.pt;
      placed.push(pt);

      // Guarda-redes: nas defesas chega à bola; nos golos atira-se SEMPRE para o lado errado;
      // nos remates para fora atira-se para um dos lados.
      let dive;
      if (kind === 'defesa') dive = { to: pt, reach: 1 };
      else if (kind === 'golo') {
        const wrongX = pt.x < CENTER.x ? GOAL.r - 22 : GOAL.l + 22;
        dive = { to: { x: wrongX, y: clamp(GOAL.b - pt.y + GOAL.t + (rng() - 0.5) * 16, GOAL.t + 14, GOAL.b - 10) }, reach: 0.9 };
      } else dive = { to: { x: rng() < 0.5 ? GOAL.l + 20 : GOAL.r - 20, y: GOAL.t + 20 + rng() * 50 }, reach: 0.8 };

      // Tipo de defesa: em baixo, pé ou agarra; em cima, soco ou desvio com a mão; a meio, qualquer.
      let save = null;
      if (kind === 'defesa') {
        const low = pt.y > GOAL.b - 26;
        const high = pt.y < GOAL.t + 24;
        const options = low ? ['pé', 'agarra'] : high ? ['soco', 'mão'] : ['agarra', 'mão', 'soco'];
        save = options[Math.floor(rng() * options.length)];
      }
      out[p.id] = { kind, pt, hit: best.hit, dive, save, exact: show.exact, where: pt.where || (best.hit && best.hit.where) };
    }
    return out;
  }

  // Posição do guarda-redes a mergulhar: corpo virado para o alvo, com as luvas a chegar lá
  // (reach = fração da distância que consegue fazer).
  function divePose(to, reach) {
    const dx = to.x - KEEPER.x;
    const dy = to.y - KEEPER.y;
    const len = Math.hypot(dx, dy) || 1;
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = braços para cima
    const move = Math.max(0, len - REACH) * reach;
    return { x: KEEPER.x + (dx / len) * move, y: KEEPER.y + (dy / len) * move, deg: clamp(deg, -100, 100) };
  }

  window.RevealThemes.register('penalti', () => {
    let kit = null;
    let scene = null;
    let keeper = null;
    let net = null;
    let ballLayer = null;
    let marksLayer = null;
    let fxLayer = null;
    let shooterLayer = null;
    let answerText = null;
    let plans = {};
    let row = {}; // id → { g, player, x, h, w }
    let current = null;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

    const setKeeper = ({ x, y, deg }) => keeper.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(0)})`);
    const standKeeper = () => setKeeper({ x: KEEPER.x, y: KEEPER.y, deg: 0 });

    function drawRow(id, pose) {
      const r = row[id];
      const svg = kit.drawCharacter(r.player, pose, { size: r.h, small: r.small });
      svg.setAttribute('x', r.x);
      svg.setAttribute('y', r.bottom - r.h);
      r.g.replaceChildren(svg);
    }

    // Boneco grande de quem remata, com o pé de remate encostado à bola na marca de penálti.
    function showShooter(player, pose = 'rematar', dx = 0) {
      const h = 64;
      const w = h * (100 / 130);
      const svg = kit.drawCharacter(player, pose, { size: h });
      svg.setAttribute('x', (SPOT.x - w * 0.86 + dx).toFixed(1));
      svg.setAttribute('y', (SPOT.y + 7 - h * 0.86).toFixed(1));
      shooterLayer.replaceChildren(svg);
    }

    function addMark(player, plan) {
      if (plan.kind === 'golo' && plan.exact) tearNet(plan.pt);
      const g = s('g', { class: `pen-mark ${plan.kind}`, 'data-id': player.id, transform: `translate(${plan.pt.x.toFixed(1)} ${plan.pt.y.toFixed(1)})` }, [
        s('circle', { r: MARK_R, fill: player.color }),
        text({ y: 0.5, 'font-size': 8.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'pen-emoji' }, player.emoji || ''),
      ]);
      marksLayer.append(g);
    }

    function fxText(str, cls) {
      const t = text({ x: CENTER.x, y: 82, 'text-anchor': 'middle', class: `pen-fx-text ${cls}` }, str);
      fxLayer.append(t);
      later(() => t.remove(), FX_MS);
    }

    const resultText = (pl) => (pl.kind === 'golo' ? [pl.exact ? 'GOLAÇO!' : 'GOLO!', 'golo']
      : pl.kind === 'defesa' ? [{ agarra: 'AGARRA!', soco: 'SOCO!', mão: 'DEFESA!', pé: 'COM O PÉ!' }[pl.save], 'defesa']
      : pl.kind === 'ferro' ? [pl.hit.where === 'barra' ? 'BARRA!' : 'POSTE!', 'fora']
      : pl.kind === 'bancada' ? ['PARA A BANCADA!', 'fora']
      : [pl.pt.where === 'por cima' ? 'POR CIMA!' : 'AO LADO!', 'fora']);

    // "Em cheio": a bola rasga a rede no ângulo (um buraco com fios soltos, que fica).
    function tearNet(pt) {
      const r = 9;
      const jag = Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * 2 * Math.PI;
        const rr = r * (i % 2 ? 0.6 : 1);
        return `${(pt.x + rr * Math.cos(a)).toFixed(1)},${(pt.y + rr * Math.sin(a)).toFixed(1)}`;
      }).join(' ');
      net.append(s('g', { class: 'pen-tear' }, [
        s('polygon', { points: jag, fill: '#0c0a24', stroke: '#dee2e6', 'stroke-width': 0.7 }),
        s('path', { d: `M${pt.x - r},${pt.y - 3} l-5,-4 M${pt.x + r},${pt.y + 2} l6,3 M${pt.x - 2},${pt.y + r} l-2,6 M${pt.x + 3},${pt.y - r} l3,-5`, stroke: '#dee2e6', 'stroke-width': 0.7, opacity: 0.8 }),
      ]));
    }

    return {
      mount(container, { players, kit: k, seed }) {
        kit = k;
        row = {};
        // Com mais de 6 jogadores a cena é mais alta: a fila de baixo passa a duas filas
        // desencontradas, com bonecos maiores.
        const n = players.length;
        const twoRows = n > 6;
        const vh = twoRows ? VH_TALL : VH;
        scene = s('svg', { viewBox: `0 0 ${VW} ${vh}`, class: 'pen-scene', role: 'img', 'aria-label': 'Penálti: só quem ficou mais perto marca golo' });
        kit.sizeScene(scene, VW, vh, twoRows ? 60 : 45);

        // Bancada (com público nos cantos de cima), relvado com riscas, grande área e marca.
        scene.append(s('rect', { x: 0, y: 0, width: VW, height: GOAL.b, rx: 10, fill: '#241e55' }));
        const crowd = s('g', { class: 'pen-crowd', opacity: 0.55 });
        for (let r = 0; r < 3; r++) {
          for (let x = 10 + (r % 2) * 5; x < VW - 6; x += 10) {
            if (x > 80 && x < 220) continue; // a placa da resposta fica ao meio
            crowd.append(s('circle', { cx: x, cy: 10 + r * 10, r: 3, fill: ['#f783ac', '#4dabf7', '#ffd43b', '#3ddc97', '#ff922b'][(x / 5 + r * 2) % 5 | 0] }));
          }
        }
        scene.append(crowd);
        for (let i = 0; i < 6; i++) {
          const y = GOAL.b + i * ((vh - GOAL.b) / 6);
          scene.append(s('rect', { x: 0, y, width: VW, height: (vh - GOAL.b) / 6 + 0.5, fill: i % 2 ? '#2f9e44' : '#37b24d' }));
        }
        scene.append(
          s('path', { d: `M20,${GOAL.b} L20,${GOAL.b + 52} L280,${GOAL.b + 52} L280,${GOAL.b}`, fill: 'none', stroke: '#e9fbe9', 'stroke-width': 1.5, opacity: 0.85 }),
          s('path', { d: `M0,${GOAL.b} L${VW},${GOAL.b}`, stroke: '#e9fbe9', 'stroke-width': 1.5, opacity: 0.85 }),
          s('circle', { cx: SPOT.x, cy: SPOT.y + 7, r: 2, fill: '#f8f9fa' }),
        );

        // Rede (grelha) atrás da baliza; abana nos golos.
        net = s('g', { class: 'pen-net' }, [s('rect', { x: GOAL.l, y: GOAL.t, width: GOAL.r - GOAL.l, height: GOAL.b - GOAL.t, fill: '#1b1740' })]);
        for (let x = GOAL.l + 8; x < GOAL.r; x += 8) net.append(s('line', { x1: x, y1: GOAL.t, x2: x, y2: GOAL.b, stroke: '#dee2e6', 'stroke-width': 0.5, opacity: 0.5 }));
        for (let y = GOAL.t + 8; y < GOAL.b; y += 8) net.append(s('line', { x1: GOAL.l, y1: y, x2: GOAL.r, y2: y, stroke: '#dee2e6', 'stroke-width': 0.5, opacity: 0.5 }));
        scene.append(net);

        keeper = s('g', { class: 'pen-keeper' }, [keeperShape()]);
        scene.append(keeper);
        standKeeper();
        // Postes e barra por cima do guarda-redes.
        scene.append(s('path', { d: `M${GOAL.l - 2},${GOAL.b} L${GOAL.l - 2},${GOAL.t - 2} L${GOAL.r + 2},${GOAL.t - 2} L${GOAL.r + 2},${GOAL.b}`, fill: 'none', stroke: '#f8f9fa', 'stroke-width': 4, 'stroke-linejoin': 'round' }));

        // Placa da resposta certa, no topo (nenhuma bola vai lá).
        answerText = text({ x: VW / 2 + 22, y: 18, 'text-anchor': 'middle', class: 'pen-answer' }, '?');
        scene.append(
          s('rect', { x: 88, y: 4, width: 124, height: 20, rx: 6, class: 'pen-plaque' }),
          text({ x: 94, y: 16.5, class: 'pen-plaque-label' }, 'RESPOSTA'),
          answerText,
        );

        shooterLayer = s('g', { class: 'pen-shooter' });
        ballLayer = s('g');
        marksLayer = s('g', { class: 'pen-marks' });
        fxLayer = s('g', { class: 'pen-fx' });

        // Fila em baixo: o boneco de cada jogador (pela ordem dos remates). Com mais de 6, duas
        // filas desencontradas (a de trás meio lugar ao lado).
        const rowLayer = s('g', { class: 'pen-row' });
        if (!twoRows) {
          const slot = VW / n;
          const h = Math.min(60, slot * 1.25);
          const w = h * (100 / 130);
          players.forEach((p, i) => {
            const g = s('g', { class: 'pen-row-player', 'data-id': p.id });
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
            const g = s('g', { class: 'pen-row-player', 'data-id': p.id });
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

        scene.append(rowLayer, shooterLayer, marksLayer, ballLayer, fxLayer);
        container.append(scene);
        plans = plan(players, seed);
      },

      revealPlayer(player, precision, { instant }) {
        if (current) current.finish();
        const pl = plans[player.id];
        const others = row[player.id];
        if (others) others.g.classList.add('shot');
        if (instant || kit.reducedMotion()) {
          showShooter(player, 'rematar');
          standKeeper();
          addMark(player, pl);
          return;
        }

        // Corrida, remate e voo da bola; o guarda-redes atira-se ao mesmo tempo.
        let done = false;
        let frame = 0;
        // A posição vai no grupo de fora (atributo transform); o desvio do soco, no de dentro (CSS).
        const inner = s('g', { class: 'pen-ball-inner' }, [
          s('circle', { r: 6, fill: '#fff', stroke: '#343a40', 'stroke-width': 1.2 }),
          s('path', { d: 'M0,-2.6 L2.5,-0.8 L1.5,2.2 L-1.5,2.2 L-2.5,-0.8 Z', fill: '#343a40' }),
        ]);
        const ball = s('g', { class: 'pen-ball' }, [inner]);
        ball.setAttribute('transform', `translate(${SPOT.x} ${SPOT.y})`);
        ballLayer.replaceChildren(ball);
        standKeeper();
        const end = divePose(pl.dive.to, pl.dive.reach);
        const finish = () => {
          if (done) return;
          done = true;
          cancelAnimationFrame(frame);
          current = null;
          ball.remove();
          showShooter(player, 'rematar');
          setKeeper(end);
          addMark(player, pl);
        };
        current = { finish };

        const t0 = performance.now();
        // Bola: da marca até ao alvo (no ferro, primeiro bate no poste/barra e depois sai).
        const legs = pl.hit ? [[SPOT, pl.hit], [pl.hit, pl.pt]] : [[SPOT, pl.pt]];
        let landed = false;
        const step = (now) => {
          const t = now - t0;
          if (t < RUN_MS) {
            showShooter(player, 'parado', -26 * (1 - t / RUN_MS)); // corrida até à bola
            frame = requestAnimationFrame(step);
            return;
          }
          if (shooterLayer.dataset.kicked !== player.id) { shooterLayer.dataset.kicked = player.id; showShooter(player, 'rematar'); }
          const k = Math.min(1, (t - RUN_MS) / FLY_MS);
          // Guarda-redes a mergulhar.
          const e = 1 - (1 - k) ** 2;
          setKeeper({ x: KEEPER.x + (end.x - KEEPER.x) * e, y: KEEPER.y + (end.y - KEEPER.y) * e, deg: end.deg * e });
          // Bola (fica mais pequena com a distância; sobe um pouco em arco).
          const [a, b] = legs.length === 1 || k < 0.5 ? legs[0] : legs[1];
          // Fração do troço atual (no ferro há dois: até ao poste/barra e depois para fora).
          const lt = legs.length === 1 ? k : k < 0.5 ? k * 2 : (k - 0.5) * 2;
          const x = a.x + (b.x - a.x) * lt;
          const y = a.y + (b.y - a.y) * lt - Math.sin(lt * Math.PI) * (legs.length === 1 ? 14 : 6);
          const sc = 1 - 0.38 * Math.min(1, (SPOT.y - y) / (SPOT.y - GOAL.t));
          ball.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${sc.toFixed(2)}) rotate(${(k * 720).toFixed(0)})`);
          if (k < 1) { frame = requestAnimationFrame(step); return; }
          if (!landed) {
            landed = true;
            const [label, cls] = resultText(pl);
            fxText(label, cls);
            if (pl.kind === 'golo') {
              net.classList.remove('ripple');
              void net.getBoundingClientRect();
              net.classList.add('ripple');
              kit.sound('golo');
            }
            // Soco e desvios: a bola sai disparada e desaparece; ao agarrar, fica nas luvas.
            if (pl.kind === 'defesa' && pl.save !== 'agarra') {
              inner.classList.add('pen-deflect');
              inner.style.setProperty('--dx', `${(pl.pt.x < CENTER.x ? -1 : 1) * 30}px`);
              inner.style.setProperty('--dy', `${pl.save === 'pé' ? 10 : -20}px`);
            }
          }
          later(finish, 260);
        };
        frame = requestAnimationFrame(step);
      },

      // Resposta certa na placa (a rolar até ao valor). O guarda-redes volta ao centro; na
      // fila, quem marcou festeja e o mais longe fica triste. Em grande, quem marcou a festejar.
      revealAnswer(answer, { closest, farthest, instant }) {
        if (current) current.finish();
        if (instant) answerText.textContent = kit.fmt(answer);
        else kit.countUp(answerText, answer);
        standKeeper();
        for (const id of Object.keys(row)) {
          const near = closest.includes(id);
          const far = farthest.includes(id) && !near;
          if (near) drawRow(id, 'festejar');
          else if (far) drawRow(id, 'triste');
          row[id].g.classList.toggle('near', near);
          row[id].g.classList.toggle('far', far);
        }
        if (closest.length && row[closest[0]]) showShooter(row[closest[0]].player, 'festejar');
        for (const m of marksLayer.children) m.classList.toggle('far', farthest.includes(m.dataset.id) && !closest.includes(m.dataset.id));
      },

      skipToEnd() {
        if (current) current.finish();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        fxLayer.replaceChildren();
        ballLayer.replaceChildren();
        net.classList.remove('ripple');
        standKeeper();
      },

      destroy() {
        if (current) current.finish();
        current = null;
        for (const t of timers) clearTimeout(t);
        timers.clear();
        if (answerText) kit.stopCount(answerText);
        if (scene) scene.remove();
        scene = keeper = net = ballLayer = marksLayer = fxLayer = shooterLayer = answerText = null;
        plans = {};
        row = {};
      },
    };
  });
})();
