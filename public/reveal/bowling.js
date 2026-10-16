'use strict';

// Tema "bowling": UMA pista partilhada, em perspetiva, onde cada jogador lança à vez (o seu
// boneco na pose "a lançar bola", com uma bola da sua cor), e um PLACAR por baixo onde fica o
// resultado de cada um. Com 12 jogadores, 12 pistas lado a lado ficariam com ~25 px no iPhone
// (pinos ilegíveis); assim cada lançamento vê-se em grande e cada resultado tem a sua célula.
//
// Os pinos que caem vêm da posição de apresentação (player.show), relativa à ronda: o
// vencedor faz sempre strike ("STRIKE PERFEITO!" no "em cheio"); o "mais longe" e quem errou
// mais de 100% vão para a caleira; os outros, de 9 a 3 pinos.
//
// Cena SVG de tamanho fixo (viewBox 300 × 300, quadrada para ocupar a largura do iPhone dentro
// dos 45% da altura do ecrã; com mais de 6 jogadores mais alta, para o placar), por zonas:
//   - pista com os pinos, em cima;
//   - faixa da resposta certa a meio (nada se mexe lá, nunca fica tapada);
//   - placar em baixo (3 colunas com 5-6 jogadores; senão 2, com nomes maiores).
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const VW = 300;
  const VH = 300;
  // Pista em perspetiva: fundo estreito em cima, frente larga em baixo.
  const LANE = { topY: 8, botY: 126, topL: 116, topR: 184, botL: 74, botR: 226 };
  const ANSWER_Y = 130; // faixa da resposta: 130..152
  const BOARD_Y = 156;
  const MANY_CELL_H = 34; // altura de cada célula do placar com mais de 6 jogadores
  const ROLL_MS = 520;
  const FALL_MS = 320;
  const PIN_GAP_MS = 25; // entre a queda de um pino e a do seguinte
  // Lançamento completo: rolar + o último pino a começar a cair + a queda.
  const THROW_MS = ROLL_MS + 9 * PIN_GAP_MS + FALL_MS;

  // Ordem em que os pinos caem (do pino da frente para trás), para n pinos parecer natural.
  const FALL_ORDER = [0, 1, 2, 4, 3, 5, 7, 8, 6, 9];
  // Posições dos 10 pinos (filas 1-2-3-4, da frente para o fundo), em frações da largura.
  const PIN_ROWS = [[0], [-0.5, 0.5], [-1, 0, 1], [-1.5, -0.5, 0.5, 1.5]];

  function s(tag, attrs = {}, children = []) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    for (const c of children) if (c) node.append(c);
    return node;
  }
  const text = (attrs, str) => s('text', attrs, [document.createTextNode(str)]);

  // Largura e x de um ponto da pista à altura y (perspetiva linear).
  function laneAt(y) {
    const t = (y - LANE.topY) / (LANE.botY - LANE.topY);
    const left = LANE.topL + (LANE.botL - LANE.topL) * t;
    const right = LANE.topR + (LANE.botR - LANE.topR) * t;
    return { left, right, mid: (left + right) / 2, width: right - left, scale: 0.35 + 0.65 * t };
  }

  // Pinos derrubados, a partir da posição de apresentação (relativa à ronda): o vencedor faz
  // sempre strike (10); o "mais longe" e quem errou mais de 100% vão para a caleira (null); os
  // outros, de 9 (nível 0,15) a 3 (nível 0,85). Palpites iguais: os mesmos pinos.
  function pinsDown(show) {
    if (show.winner) return 10;
    if (show.miss) return null;
    return Math.max(1, Math.min(9, Math.round(10.2 - 9 * show.level)));
  }
  const scoreText = (n) => (n === null ? 'caleira' : n === 10 ? 'X' : String(n));

  window.RevealThemes.register('bowling', () => {
    let kit = null;
    let scene = null;
    let pins = [];
    let thrower = null;
    let ballLayer = null;
    let fxLayer = null;
    let answerText = null;
    let cells = {}; // id → { g, boneco, score, player, box, h }
    let current = null; // lançamento a decorrer: { frame, finish }
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

    function resetPins() {
      for (const p of pins) p.classList.remove('down', 'falling');
    }

    // `speed` (0..1) encurta a queda quando o palpite seguinte vem depressa.
    function knock(n, animate, speed = 1) {
      FALL_ORDER.slice(0, n).forEach((i, k) => {
        const pin = pins[i];
        pin.style.setProperty('--dir', `${(i % 2 ? 1 : -1) * (40 + ((i * 17) % 40))}deg`);
        pin.style.setProperty('--fall', `${Math.round(FALL_MS * speed)}ms`);
        if (animate) {
          pin.classList.add('falling');
          later(() => pin.classList.add('down'), k * PIN_GAP_MS * speed);
        } else pin.classList.add('down');
      });
    }

    // "STRIKE!" com estrelinhas; no "em cheio", "STRIKE PERFEITO!" maior, com o dobro das
    // estrelinhas, numa coroa mais larga.
    function strikeFx(perfect) {
      const count = perfect ? 16 : 8;
      const rx = perfect ? 62 : 26;
      const g = s('g', { class: `bowl-strike${perfect ? ' perfect' : ''}`, transform: `translate(${VW / 2} 46)` }, [
        ...Array.from({ length: count }, (_, i) => s('circle', {
          cx: Math.cos((i * 2 * Math.PI) / count) * rx, cy: Math.sin((i * 2 * Math.PI) / count) * (perfect ? 22 : 14), r: perfect ? 3 : 2.5,
          fill: ['#ffd43b', '#3ddc97', '#f783ac', '#4dabf7'][i % 4],
        })),
        text({ x: 0, y: 5, 'text-anchor': 'middle', class: 'bowl-strike-text' }, perfect ? 'STRIKE PERFEITO!' : 'STRIKE!'),
      ]);
      fxLayer.append(g);
      later(() => g.remove(), perfect ? 1500 : 1300);
    }

    // O "mais longe" (bola na caleira): "CALEIRA!", no momento em que a bola chega ao fim.
    function gutterFx() {
      const g = s('g', { class: 'bowl-strike gutter', transform: `translate(${VW / 2} 46)` }, [
        text({ x: 0, y: 5, 'text-anchor': 'middle', class: 'bowl-strike-text' }, 'CALEIRA!'),
      ]);
      fxLayer.append(g);
      later(() => g.remove(), 1300);
    }

    // O boneco de cada jogador desenha-se sempre com o drawCharacter (o tema só escolhe a pose).
    // A versão pequena (sem capa) só com mais de 6 jogadores.
    // Cada jogador só aparece uma vez no cenário: quem está em grande ao lado da pista fica, na
    // sua célula do placar, só com o retrato pequeno (em vez do boneco).
    let throwerId = null;
    function drawCellBoneco(id, pose) {
      const c = cells[id];
      c.pose = pose;
      if (id === throwerId) {
        const r = Math.min(c.h * 0.32, 11);
        c.boneco.replaceChildren(kit.portraitMark(c.player, r, c.box.x + 3 + c.h * 0.38, c.box.y + c.box.h / 2, 1));
        return;
      }
      const svg = kit.drawCharacter(c.player, pose, { size: c.h, small: c.small });
      svg.setAttribute('x', c.box.x + 3);
      svg.setAttribute('y', c.box.y + (c.box.h - c.h) / 2);
      c.boneco.replaceChildren(svg);
    }

    function record(id, n) {
      const c = cells[id];
      c.score.textContent = scoreText(n);
      c.g.classList.add('done');
      c.g.classList.toggle('strike', n === 10);
      c.g.classList.toggle('gutter', n === null);
      drawCellBoneco(id, 'lancar');
    }

    // Ao festejar, o boneco grande ao lado da pista leva o animal de estimação (há espaço).
    // Quando muda quem está em grande, o anterior volta a ter o boneco na sua célula.
    function showThrower(player, pose = 'lancar') {
      const svg = kit.drawCharacter(player, pose, { size: 70, withPet: pose === 'festejar' });
      svg.setAttribute('x', 4);
      svg.setAttribute('y', LANE.botY - 70);
      thrower.replaceChildren(svg);
      const prev = throwerId;
      if (prev === player.id) return;
      throwerId = player.id;
      if (prev && cells[prev]) drawCellBoneco(prev, cells[prev].pose);
      if (cells[player.id]) drawCellBoneco(player.id, cells[player.id].pose);
    }

    return {
      mount(container, { players, kit: k }) {
        kit = k;
        cells = {};
        throwerId = null;
        // Placar: 2 colunas com até 4 jogadores, 3 com 5-6. Com mais de 6, 2 colunas outra vez
        // (nomes maiores) e a cena cresce para baixo o que for preciso (células de 34).
        const n = players.length;
        const many = n > 6;
        const cols = n <= 4 || many ? 2 : 3;
        const rows = Math.ceil(n / cols);
        const gap = 4;
        const vh = many ? BOARD_Y + gap + rows * (MANY_CELL_H + gap) : VH;
        scene = s('svg', { viewBox: `0 0 ${VW} ${vh}`, class: 'bowl-scene', role: 'img', 'aria-label': 'Bowling: quanto mais pinos caem, mais perto da resposta certa' });
        kit.sizeScene(scene, VW, vh, many ? 62 : 45);

        // Fundo, pista (madeira com tábuas) e caleiras.
        scene.append(s('rect', { x: 0, y: 0, width: VW, height: BOARD_Y - 4, rx: 10, fill: '#241e55' }));
        const gutter = 9;
        scene.append(s('path', {
          d: `M${LANE.topL - gutter * 0.4},${LANE.topY} L${LANE.topR + gutter * 0.4},${LANE.topY} L${LANE.botR + gutter},${LANE.botY} L${LANE.botL - gutter},${LANE.botY} Z`,
          fill: '#3a3a4a',
        }));
        scene.append(s('path', { d: `M${LANE.topL},${LANE.topY} L${LANE.topR},${LANE.topY} L${LANE.botR},${LANE.botY} L${LANE.botL},${LANE.botY} Z`, fill: '#e0a96d' }));
        for (let i = 1; i < 8; i++) {
          const f = i / 8;
          const x1 = LANE.topL + (LANE.topR - LANE.topL) * f;
          const x2 = LANE.botL + (LANE.botR - LANE.botL) * f;
          scene.append(s('path', { d: `M${x1},${LANE.topY} L${x2},${LANE.botY}`, stroke: '#c98a4b', 'stroke-width': 0.6 }));
        }
        // Setas de pontaria na pista.
        for (const f of [0.3, 0.5, 0.7]) {
          const { left, width } = laneAt(96);
          scene.append(s('path', { d: `M${left + width * f - 3},98 L${left + width * f},92 L${left + width * f + 3},98 Z`, fill: '#8d5a2b' }));
        }

        // Pinos (brancos, com risca vermelha), do fundo para a frente para a sobreposição certa.
        pins = [];
        const pinLayer = s('g', { class: 'bowl-pins' });
        const rowsY = [36, 28, 21, 15];
        PIN_ROWS.forEach((row, r) => {
          const { mid, width, scale } = laneAt(rowsY[r]);
          row.forEach((f) => {
            const x = mid + f * width * 0.22;
            const y = rowsY[r];
            const h = 12 * scale + 4;
            const pin = s('g', { class: 'bowl-pin' }, [
              s('ellipse', { cx: x, cy: y, rx: h * 0.28, ry: h * 0.42, fill: '#f8f9fa', stroke: '#adb5bd', 'stroke-width': 0.6 }),
              s('circle', { cx: x, cy: y - h * 0.55, r: h * 0.2, fill: '#f8f9fa', stroke: '#adb5bd', 'stroke-width': 0.6 }),
              s('rect', { x: x - h * 0.22, y: y - h * 0.32, width: h * 0.44, height: h * 0.1, fill: '#e03131' }),
            ]);
            pins.push(pin);
          });
        });
        // Ordem dos pinos no array: da frente (pino 1) para o fundo.
        pins = [...pins];
        [...pins].reverse().forEach((p) => pinLayer.append(p));
        scene.append(pinLayer);

        thrower = s('g', { class: 'bowl-thrower' });
        ballLayer = s('g', { class: 'bowl-ball-layer' });
        fxLayer = s('g', { class: 'bowl-fx' });
        scene.append(thrower, ballLayer, fxLayer);

        // Faixa da resposta certa (nada se mexe aqui).
        answerText = text({ x: VW / 2 + 22, y: ANSWER_Y + 16, 'text-anchor': 'middle', class: 'bowl-answer' }, '?');
        scene.append(
          s('rect', { x: 50, y: ANSWER_Y, width: 200, height: 22, rx: 7, class: 'bowl-plaque' }),
          text({ x: 60, y: ANSWER_Y + 14.5, class: 'bowl-plaque-label' }, 'RESPOSTA'),
          answerText,
        );

        // Placar: uma célula por jogador, pela ordem da revelação. Com 2 colunas há espaço para
        // nomes maiores (classe "wide").
        const cw = (VW - gap * (cols + 1)) / cols;
        const ch = Math.min(46, (vh - BOARD_Y - gap * (rows + 1)) / rows);
        const maxName = cols === 2 ? 12 : 9;
        const board = s('g', { class: `bowl-board${cols === 2 ? ' wide' : ''}` });
        players.forEach((p, i) => {
          const box = { x: gap + (i % cols) * (cw + gap), y: BOARD_Y + gap + Math.floor(i / cols) * (ch + gap), w: cw, h: ch };
          const boneco = s('g');
          const score = text({ x: box.x + box.w - 6, y: box.y + box.h / 2 + 5.5, 'text-anchor': 'end', class: 'bowl-score' }, '·');
          const name = text({ x: box.x + ch * 0.62 + 6, y: box.y + box.h / 2 + 3.5, class: 'bowl-name' }, p.name.length > maxName ? `${p.name.slice(0, maxName - 1)}…` : p.name);
          const g = s('g', { class: 'bowl-cell', 'data-id': p.id }, [
            s('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 6, class: 'bowl-cell-bg', style: `--c:${p.color}` }),
            s('rect', { x: box.x, y: box.y, width: 3, height: box.h, rx: 1.5, fill: p.color }),
            boneco, name, score,
          ]);
          cells[p.id] = { g, boneco, score, player: p, box, h: ch - 4, small: many };
          board.append(g);
          drawCellBoneco(p.id, 'parado');
        });
        scene.append(board);
        container.append(scene);
      },

      revealPlayer(player, precision, { instant, duration = THROW_MS + 80 }) {
        if (current) current.finish(); // o lançamento anterior acaba já
        // Com os palpites rápidos (os mais longe), o lançamento todo encurta para caber antes
        // do seguinte, em vez de ser cortado a meio.
        const speed = Math.min(1, Math.max(0.3, (duration - 80) / THROW_MS));
        const rollMs = ROLL_MS * speed;
        const n = pinsDown(player.show);
        showThrower(player);
        resetPins();
        ballLayer.replaceChildren();
        if (instant || kit.reducedMotion()) {
          knock(n || 0, false);
          record(player.id, n);
          return;
        }

        // Bola da cor do jogador, com o seu retrato, a rolar da frente para os pinos (fica mais
        // pequena com a distância). Na caleira, desvia-se para o lado.
        const ball = s('g', { class: 'bowl-ball' }, [kit.portraitMark(player, 9, 0, 0, 1.2)]);
        ballLayer.append(ball);
        const side = Object.keys(cells).indexOf(player.id) % 2 ? 1 : -1;
        const start = performance.now();
        const fromY = LANE.botY - 6;
        const toY = n === null ? 30 : 34;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          cancelAnimationFrame(current && current.frame);
          current = null;
          ball.remove();
          knock(n || 0, false);
          record(player.id, n);
        };
        const frame = (now) => {
          const t = Math.min(1, (now - start) / rollMs);
          const y = fromY + (toY - fromY) * (1 - (1 - t) ** 1.6);
          const lane = laneAt(y);
          const x = n === null ? lane.mid + side * (lane.width / 2 + 4) * Math.min(1, t * 1.6) : lane.mid;
          ball.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${lane.scale.toFixed(2)}) rotate(${(t * 540).toFixed(0)})`);
          if (t < 1) { current.frame = requestAnimationFrame(frame); return; }
          // Chegou aos pinos: caem (ou nada, na caleira) e o resultado vai para o placar.
          ball.classList.add('gone');
          if (n) knock(n, true, speed);
          if (n === 10) strikeFx(player.show.exact);
          else if (player.show.farthest) gutterFx();
          later(() => { if (!done) { done = true; current = null; ball.remove(); record(player.id, n); } }, (9 * PIN_GAP_MS + FALL_MS) * speed);
        };
        current = { frame: requestAnimationFrame(frame), finish };
      },

      // Resposta certa na faixa do meio (a rolar até ao valor). No placar, o mais perto
      // festeja e o mais longe fica triste (se não empatou toda a gente).
      revealAnswer(answer, { closest, farthest, instant }) {
        if (current) current.finish();
        if (instant) answerText.textContent = kit.fmt(answer);
        else kit.countUp(answerText, answer);
        for (const id of Object.keys(cells)) {
          const near = closest.includes(id);
          const far = farthest.includes(id) && !near;
          if (near) drawCellBoneco(id, 'festejar');
          else if (far) drawCellBoneco(id, 'triste');
          cells[id].g.classList.toggle('near', near);
          cells[id].g.classList.toggle('far', far);
        }
        // Ao lado da pista, em grande, quem ficou mais perto a festejar.
        if (closest.length && cells[closest[0]]) showThrower(cells[closest[0]].player, 'festejar');
      },

      skipToEnd() {
        if (current) current.finish();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        fxLayer.replaceChildren();
        for (const p of pins) p.classList.remove('falling');
      },

      destroy() {
        if (current) cancelAnimationFrame(current.frame);
        current = null;
        for (const t of timers) clearTimeout(t);
        timers.clear();
        if (answerText) kit.stopCount(answerText);
        if (scene) scene.remove();
        scene = thrower = ballLayer = fxLayer = answerText = null;
        pins = [];
        cells = {};
      },
    };
  });
})();
