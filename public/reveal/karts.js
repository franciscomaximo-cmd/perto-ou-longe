'use strict';

// Tema "karts" (corrida de karts): pista reta com uma faixa por jogador, linha de partida à
// esquerda e meta em xadrez à direita. Cada jogador tem um kart da sua cor com o boneco na pose
// "a conduzir kart". Na vez de cada um, o kart arranca e avança até uma distância que depende
// da precisão: 0 = chega à meta (e a bandeira agita), 1 = fica perto da partida. Com precisão
// acima de 1 o kart despista-se cedo (pião e fumo).
//
// Cena SVG de tamanho fixo (viewBox 300 × 300), por zonas:
//   - faixa de cima: placa da resposta certa junto à meta e a bandeira (nenhum kart passa lá);
//   - pista: uma faixa por jogador. No início de cada faixa, uma "box" com o emoji do jogador
//     num círculo da sua cor, para se ler bem de quem é cada faixa mesmo com 12 jogadores.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const VW = 300;
  const VH = 300;
  const TOP = 26; // a pista começa aqui
  const BOTTOM = 296;
  const START_X = 38; // linha de partida
  const FINISH_X = 262; // meta
  const DRIVE_MS = 700;
  const SPIN_MS = 650;
  // Despiste: uma volta inteira e fica inclinado (25°), dentro da sua faixa.
  const SPIN_DEG = 385;
  const SPUN_DEG = 25;

  function s(tag, attrs = {}, children = []) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    for (const c of children) if (c) node.append(c);
    return node;
  }
  const text = (attrs, str) => s('text', attrs, [document.createTextNode(str)]);

  // Até onde chega a frente do kart, a partir de onde está estacionado (`parked`, logo a seguir
  // à linha de partida). "Em cheio": passa a meta. Até 1: proporcional (1 = perto da partida).
  // Acima de 1: despiste a 15–30% da pista (mais cedo quanto maior o erro).
  function finalX(precision, parked) {
    const len = FINISH_X - parked;
    if (precision === 0) return { x: FINISH_X + 14, spin: false };
    if (precision <= 1) return { x: parked + 8 + (len - 14) * (1 - precision), spin: false };
    const worse = Math.min(1, (precision - 1) / 0.33);
    return { x: parked + len * (0.3 - 0.15 * worse), spin: true };
  }

  // Bandeira de xadrez (4 × 3 quadrados) num mastro.
  function flag() {
    const squares = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      squares.push(s('rect', { x: 2 + c * 5, y: 1 + r * 5, width: 5, height: 5, fill: (r + c) % 2 ? '#111' : '#fff' }));
    }
    return s('g', { class: 'kart-flag', transform: `translate(${FINISH_X + 3} 3)` }, [
      s('line', { x1: 0, y1: 0, x2: 0, y2: 22, stroke: '#ced4da', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
      s('g', { class: 'kart-flag-cloth' }, squares),
    ]);
  }

  window.RevealThemes.register('karts', () => {
    let kit = null;
    let scene = null;
    let flagNode = null;
    let fxLayer = null;
    let answerText = null;
    let lanes = {}; // id → { g, kart, y, h, w, player, to }
    const runs = new Map(); // id → { frame, finish }
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

    // O boneco (com o kart) desenha-se sempre com o drawCharacter; o tema só escolhe a pose.
    function drawKart(id, pose) {
      const l = lanes[id];
      const svg = kit.drawCharacter(l.player, pose, { size: l.h, small: l.small, kartColor: l.player.color });
      l.kart.replaceChildren(svg);
    }

    // Posição da frente do kart (x) e rotação (pião).
    function place(id, x, deg = 0) {
      const l = lanes[id];
      const left = x - l.w * 0.92; // a frente do kart fica a ~92% da largura do desenho
      const cx = l.w / 2;
      const cy = l.h * 0.78;
      l.kart.setAttribute('transform', `translate(${left.toFixed(1)} ${l.y.toFixed(1)}) rotate(${deg.toFixed(0)} ${cx.toFixed(1)} ${cy.toFixed(1)})`);
    }

    function smoke(id, x) {
      const l = lanes[id];
      const cy = l.y + l.h * 0.85;
      const g = s('g', { class: 'kart-smoke' }, [
        s('circle', { cx: x - 10, cy, r: 4, fill: '#adb5bd' }),
        s('circle', { cx: x - 4, cy: cy - 4, r: 5, fill: '#ced4da' }),
        s('circle', { cx: x - 16, cy: cy - 3, r: 3.5, fill: '#dee2e6' }),
      ]);
      fxLayer.append(g);
      return g;
    }

    function waveFlag() {
      flagNode.classList.remove('waving');
      void flagNode.getBoundingClientRect();
      flagNode.classList.add('waving');
    }

    return {
      mount(container, { players, kit: k }) {
        kit = k;
        lanes = {};
        scene = s('svg', { viewBox: `0 0 ${VW} ${VH}`, class: 'kart-scene', role: 'img', 'aria-label': 'Corrida de karts: quanto mais longe chega o kart, mais perto da resposta certa' });

        // Relva à volta, asfalto, faixas, partida e meta em xadrez.
        const n = players.length;
        const laneH = (BOTTOM - TOP) / n;
        scene.append(
          s('rect', { x: 0, y: 0, width: VW, height: VH, rx: 10, fill: '#2b8a3e' }),
          s('rect', { x: 0, y: TOP - 2, width: VW, height: BOTTOM - TOP + 4, fill: '#3b3b46' }),
        );
        players.forEach((p, i) => {
          const y = TOP + i * laneH;
          scene.append(s('rect', { x: 0, y, width: VW, height: laneH, fill: i % 2 ? '#41414d' : '#383843' }));
          if (i > 0) scene.append(s('line', { x1: START_X, y1: y, x2: VW, y2: y, stroke: '#f1f3f5', 'stroke-width': 0.8, 'stroke-dasharray': '6 5', opacity: 0.55 }));
        });
        scene.append(s('rect', { x: START_X - 2, y: TOP, width: 3, height: BOTTOM - TOP, fill: '#f8f9fa' }));
        const sq = 4;
        for (let y = TOP, r = 0; y < BOTTOM; y += sq, r++) {
          for (let c = 0; c < 2; c++) scene.append(s('rect', { x: FINISH_X - sq + c * sq, y, width: sq, height: Math.min(sq, BOTTOM - y), fill: (r + c) % 2 ? '#111' : '#fff' }));
        }

        // Faixa de cima: resposta certa junto à meta, e a bandeira (nenhum kart passa aqui).
        answerText = text({ x: FINISH_X - 8, y: 17, 'text-anchor': 'end', class: 'kart-answer' }, '?');
        scene.append(
          s('rect', { x: FINISH_X - 128, y: 2, width: 124, height: 21, rx: 6, class: 'kart-plaque' }),
          text({ x: FINISH_X - 122, y: 15.5, class: 'kart-plaque-label' }, 'RESPOSTA'),
          answerText,
        );
        flagNode = flag();
        scene.append(flagNode);

        // Karts: um por faixa, parados atrás da linha de partida. Com muitos jogadores ficam
        // mais pequenos (versão simplificada do boneco), mas a "box" com o emoji continua grande.
        const karts = s('g', { class: 'kart-karts' });
        fxLayer = s('g', { class: 'kart-fx' });
        players.forEach((p, i) => {
          const laneTop = TOP + i * laneH;
          const h = Math.min(62, laneH * 1.12);
          const w = h * (100 / 130);
          const r = Math.min(12, laneH / 2 - 1.5);
          // "Box" de partida: círculo da cor do jogador com o emoji.
          scene.append(
            s('circle', { cx: 18, cy: laneTop + laneH / 2, r, fill: p.color, stroke: '#fff', 'stroke-width': 1.2 }),
            text({ x: 18, y: laneTop + laneH / 2 + 0.5, 'font-size': r * 1.15, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'kart-emoji' }, p.emoji || ''),
          );
          const g = s('g', { class: 'kart-lane', 'data-id': p.id });
          const kart = s('g', { class: 'kart' });
          g.append(kart);
          karts.append(g);
          // Estacionado logo a seguir à linha de partida (não tapa a "box" com o emoji).
          const parked = START_X + w * 0.92 + 2;
          lanes[p.id] = { g, kart, player: p, h, w, small: laneH < 30, y: laneTop + laneH - h * 0.97, parked, to: finalX(p.precision, parked) };
          drawKart(p.id, 'kart');
          place(p.id, parked);
        });
        scene.append(karts, fxLayer);
        container.append(scene);
      },

      revealPlayer(player, precision, { instant }) {
        const l = lanes[player.id];
        const { x: toX, spin } = l.to;
        if (instant || kit.reducedMotion()) {
          place(player.id, toX, spin ? SPUN_DEG : 0);
          if (spin) smoke(player.id, toX);
          l.g.classList.add('done', spin ? 'spun' : 'ran');
          return;
        }
        // Arranca e avança (a abrandar no fim); se despista, gira e deita fumo.
        const fromX = l.parked;
        const start = performance.now();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          cancelAnimationFrame(runs.get(player.id)?.frame);
          runs.delete(player.id);
          place(player.id, toX, spin ? SPUN_DEG : 0);
          l.g.classList.add('done', spin ? 'spun' : 'ran');
        };
        const frame = (now) => {
          const t = Math.min(1, (now - start) / DRIVE_MS);
          const e = 1 - (1 - t) ** 2.2;
          place(player.id, fromX + (toX - fromX) * e);
          if (t < 1) { runs.get(player.id).frame = requestAnimationFrame(frame); return; }
          if (!spin) {
            if (precision === 0) waveFlag();
            finish();
            return;
          }
          // Pião: uma volta inteira com fumo, e fica inclinado.
          const puff = smoke(player.id, toX);
          puff.classList.add('puff');
          const spinStart = performance.now();
          const spinFrame = (t2) => {
            const k = Math.min(1, (t2 - spinStart) / SPIN_MS);
            place(player.id, toX + 4 * Math.sin(k * Math.PI), SPIN_DEG * (1 - (1 - k) ** 2));
            if (k < 1) runs.get(player.id).frame = requestAnimationFrame(spinFrame);
            else finish();
          };
          runs.get(player.id).frame = requestAnimationFrame(spinFrame);
        };
        runs.set(player.id, { frame: requestAnimationFrame(frame), finish });
      },

      // Resposta certa junto à meta (a rolar até ao valor). O mais perto sai do kart e festeja;
      // o mais longe fica triste (se não empatou toda a gente).
      revealAnswer(answer, { closest, farthest, instant }) {
        for (const r of [...runs.values()]) r.finish();
        if (instant) answerText.textContent = kit.fmt(answer);
        else kit.countUp(answerText, answer);
        for (const id of Object.keys(lanes)) {
          const near = closest.includes(id);
          const far = farthest.includes(id) && !near;
          const l = lanes[id];
          if (near || far) {
            drawKart(id, near ? 'festejar' : 'triste');
            place(id, Math.min(l.to.x, VW - 2 - l.w * 0.08)); // de pé, sem rodar
          }
          l.g.classList.toggle('near', near);
          l.g.classList.toggle('far', far);
        }
        if (!instant && closest.some((id) => lanes[id] && lanes[id].player.precision === 0)) waveFlag();
      },

      skipToEnd() {
        for (const r of [...runs.values()]) r.finish();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        for (const puff of fxLayer.querySelectorAll('.puff')) puff.classList.remove('puff');
        flagNode.classList.remove('waving');
      },

      destroy() {
        for (const r of runs.values()) cancelAnimationFrame(r.frame);
        runs.clear();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        if (answerText) kit.stopCount(answerText);
        if (scene) scene.remove();
        scene = flagNode = fxLayer = answerText = null;
        lanes = {};
      },
    };
  });
})();
