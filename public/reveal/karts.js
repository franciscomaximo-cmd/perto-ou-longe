'use strict';

// Tema "karts" (corrida de karts): pista reta com uma faixa por jogador, linha de partida à
// esquerda e meta em xadrez à direita. Cada jogador tem um kart da sua cor com o boneco na pose
// "a conduzir kart". Na vez de cada um, o kart arranca e avança até uma distância que vem da
// posição de apresentação (player.show), relativa à ronda: o vencedor corta sempre a meta
// primeiro (a bandeira agita; no "em cheio", foto-finish com confetti); os outros param pelo
// caminho; quem errou mais de 100% despista-se (pião e fumo), e o "mais longe" logo à saída.
//
// Cena SVG de tamanho fixo (viewBox 300 × 300; com mais de 9 jogadores mais alta, para cada
// faixa ter pelo menos 30), por zonas:
//   - faixa de cima: placa da resposta certa junto à meta e a bandeira (nenhum kart passa lá);
//   - pista: uma faixa por jogador. No início de cada faixa, uma "box" com o retrato do jogador
//     num círculo da sua cor, para se ler bem de quem é cada faixa mesmo com 12 jogadores.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const VW = 300;
  const VH = 300;
  const TOP = 26; // a pista começa aqui
  const BOTTOM = 296;
  const MANY_LANE_H = 30; // altura de cada faixa com mais de 6 jogadores (a cena cresce)
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
  // à linha de partida), pela posição de apresentação (relativa à ronda): o vencedor corta
  // sempre a meta (e é o único); os outros param pelo nível (0,15 → perto da meta … 0,85 →
  // perto da partida); quem errou mais de 100% chega aí e despista-se; o "mais longe"
  // despista-se logo à saída, atrás de todos. Palpites iguais: o mesmo sítio, cada um na faixa.
  function finalX(show, parked) {
    const len = FINISH_X - parked;
    if (show.winner) return { x: FINISH_X + 14, spin: false };
    if (show.farthest) return { x: parked + 4 + len * 0.05, spin: true };
    return { x: parked + 8 + (len - 22) * (1 - show.level), spin: show.miss };
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
    let sceneH = VH;
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

    // "Em cheio": foto-finish, com o flash da câmara, "FOTO-FINISH!" e confetti a cair sobre a
    // meta (tudo uma só vez).
    function photoFinish(id) {
      const l = lanes[id];
      const cy = l.y + l.h / 2;
      const colors = ['#ffd43b', '#3ddc97', '#f783ac', '#4dabf7', '#ff922b'];
      const g = s('g', { class: 'kart-photo' }, [
        s('rect', { x: 0, y: 0, width: VW, height: sceneH, rx: 10, class: 'kart-flash' }),
        ...Array.from({ length: 18 }, (_, i) => s('rect', {
          x: FINISH_X - 40 + ((i * 37) % 76), y: Math.max(TOP, cy - 34 + ((i * 23) % 20)), width: 3.5, height: 3.5,
          fill: colors[i % colors.length], class: 'kart-confetti', style: `--d:${(i % 5) * 60}ms`,
        })),
        text({ x: VW / 2, y: Math.min(sceneH - 20, Math.max(TOP + 30, cy)), 'text-anchor': 'middle', class: 'kart-photo-text' }, 'FOTO-FINISH!'),
      ]);
      fxLayer.append(g);
      later(() => g.remove(), 1500);
    }

    return {
      mount(container, { players, kit: k }) {
        kit = k;
        lanes = {};
        // Com mais de 6 jogadores a cena cresce para baixo o que for preciso para cada faixa ter
        // pelo menos 30 (em vez de ~22 com 12 jogadores numa cena quadrada).
        const n = players.length;
        const many = n > 6;
        const bottom = TOP + Math.max(BOTTOM - TOP, n * MANY_LANE_H);
        const vh = bottom + 4;
        scene = s('svg', { viewBox: `0 0 ${VW} ${vh}`, class: 'kart-scene', role: 'img', 'aria-label': 'Corrida de karts: quanto mais longe chega o kart, mais perto da resposta certa' });
        kit.sizeScene(scene, VW, vh, vh > VH ? 62 : 45);
        sceneH = vh;

        // Relva à volta, asfalto, faixas, partida e meta em xadrez.
        const laneH = (bottom - TOP) / n;
        scene.append(
          s('rect', { x: 0, y: 0, width: VW, height: vh, rx: 10, fill: '#2b8a3e' }),
          s('rect', { x: 0, y: TOP - 2, width: VW, height: bottom - TOP + 4, fill: '#3b3b46' }),
        );
        players.forEach((p, i) => {
          const y = TOP + i * laneH;
          scene.append(s('rect', { x: 0, y, width: VW, height: laneH, fill: i % 2 ? '#41414d' : '#383843' }));
          if (i > 0) scene.append(s('line', { x1: START_X, y1: y, x2: VW, y2: y, stroke: '#f1f3f5', 'stroke-width': 0.8, 'stroke-dasharray': '6 5', opacity: 0.55 }));
        });
        scene.append(s('rect', { x: START_X - 2, y: TOP, width: 3, height: bottom - TOP, fill: '#f8f9fa' }));
        const sq = 4;
        for (let y = TOP, r = 0; y < bottom; y += sq, r++) {
          for (let c = 0; c < 2; c++) scene.append(s('rect', { x: FINISH_X - sq + c * sq, y, width: sq, height: Math.min(sq, bottom - y), fill: (r + c) % 2 ? '#111' : '#fff' }));
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
        // mais pequenos (versão simplificada do boneco), mas a "box" com o retrato continua grande.
        const karts = s('g', { class: 'kart-karts' });
        fxLayer = s('g', { class: 'kart-fx' });
        players.forEach((p, i) => {
          const laneTop = TOP + i * laneH;
          // Com muitos jogadores o kart passa um pouco para a faixa de cima (estão desencontrados
          // na horizontal), para o boneco se ver maior.
          const h = Math.min(62, laneH * (many ? 1.32 : 1.12));
          const w = h * (100 / 130);
          const r = Math.min(12, laneH / 2 - 1.5);
          // "Box" de partida: o retrato do jogador num círculo da sua cor.
          scene.append(kit.portraitMark(p, r, 18, laneTop + laneH / 2, 1.2));
          const g = s('g', { class: 'kart-lane', 'data-id': p.id });
          const kart = s('g', { class: 'kart' });
          g.append(kart);
          karts.append(g);
          // Estacionado logo a seguir à linha de partida (não tapa a "box" com o retrato).
          const parked = START_X + w * 0.92 + 2;
          lanes[p.id] = { g, kart, player: p, h, w, small: many, y: laneTop + laneH - h * 0.97, parked, to: finalX(p.show, parked) };
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
            if (player.show.winner) waveFlag();
            if (player.show.exact) photoFinish(player.id);
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

      // Resposta certa junto à meta (a rolar até ao valor). O mais perto festeja sentado no seu
      // kart, de braços no ar; o mais longe fica triste no kart (se não empatou toda a gente).
      // Os karts ficam onde pararam.
      revealAnswer(answer, { closest, farthest, instant }) {
        for (const r of [...runs.values()]) r.finish();
        if (instant) answerText.textContent = kit.fmt(answer);
        else kit.countUp(answerText, answer);
        for (const id of Object.keys(lanes)) {
          const near = closest.includes(id);
          const far = farthest.includes(id) && !near;
          const l = lanes[id];
          if (near || far) drawKart(id, near ? 'kart_festejar' : 'kart_triste');
          l.g.classList.toggle('near', near);
          l.g.classList.toggle('far', far);
        }
        if (!instant && closest.length) waveFlag();
      },

      skipToEnd() {
        for (const r of [...runs.values()]) r.finish();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        for (const puff of fxLayer.querySelectorAll('.puff')) puff.classList.remove('puff');
        for (const photo of fxLayer.querySelectorAll('.kart-photo')) photo.remove();
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
