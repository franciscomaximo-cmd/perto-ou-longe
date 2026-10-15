'use strict';

// Tema "arco" (tiro com arco): um alvo com os anéis clássicos e, em baixo, a fila de arqueiros
// (os bonecos dos jogadores na pose "a disparar arco"). Na vez de cada jogador, o seu boneco
// dispara e a seta voa até ao alvo. Onde acerta vem da posição de apresentação (player.show),
// relativa à ronda: o vencedor acerta sempre no centro (o "em cheio" com uma seta dourada);
// os outros pelos anéis; o "mais longe" e quem errou mais de 100% falham (parede ou relva).
//
// Cena SVG de tamanho fixo (viewBox 300 × 270; 300 × 330 com mais de 6 jogadores, com duas
// filas de arqueiros), por zonas, para nada tapar o que importa:
//   - placa da resposta certa, no topo (nenhuma seta cai lá);
//   - alvo, a meio, com a parede à volta (falhanços nas laterais);
//   - relva por baixo do alvo (falhanços no chão);
//   - fila de arqueiros, em baixo.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const VW = 300;
  const VH = 270;
  const VH_TALL = 330; // com mais de 6 jogadores (duas filas de arqueiros)
  const TARGET = { x: 150, y: 106, r: 70 };
  const GRASS_Y = 182;
  const ARCHER_BOTTOM = 266;
  // Anéis do exterior para o centro: branco, preto, azul, vermelho, dourado (2 de cada).
  const RINGS = ['#f8f9fa', '#f1f3f5', '#2b2b33', '#212126', '#1c7ed6', '#1971c2', '#e03131', '#c92a2a', '#ffd43b', '#fcc419'];
  const FLIGHT_MS = 650;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ângulo de ouro: espalha bem os pontos

  function s(tag, attrs = {}, children = []) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    for (const c of children) if (c) node.append(c);
    return node;
  }

  // Onde acerta cada seta (coordenadas da cena), a partir da posição de apresentação (show):
  //   - vencedor(es) do "mais perto": no centro (o "em cheio" mesmo no meio); se forem vários,
  //     à volta do centro, todos no dourado;
  //   - os outros: raio pelo nível (0,15 → anel vermelho … 0,85 → anel branco) e ângulo
  //     variado pela semente da ronda (palpites iguais: mesmo anel, sítios diferentes);
  //   - falhanços (o "mais longe" e quem errou mais de 100%): alternam entre a parede (laterais
  //     do alvo) e a relva; o "mais longe" é o mais afastado.
  // Pontos demasiado juntos afastam-se no ângulo.
  function aimPoints(players, seed) {
    const hits = players.filter((p) => !p.show.miss);
    const misses = players.filter((p) => p.show.miss);
    const winners = hits.filter((p) => p.show.winner);

    const points = {};
    const items = hits.map((p, i) => {
      const rnd = window.RevealSeeded.seeded(`${seed}|${p.id}|arco`);
      if (p.show.winner) {
        const k = winners.indexOf(p);
        const alone = winners.length === 1;
        return {
          id: p.id,
          exact: p.show.exact,
          rad: alone ? (p.show.exact ? 0 : 0.06) : (p.show.exact ? 0.09 : 0.13),
          ang: -Math.PI / 2 + k * ((2 * Math.PI) / Math.max(3, winners.length)) + (rnd() - 0.5) * 0.4,
        };
      }
      return { id: p.id, exact: false, rad: 0.12 + 0.9 * p.show.level, ang: rnd() * 2 * Math.PI + i * GOLDEN };
    });
    const pos = (it) => ({ x: TARGET.x + it.rad * TARGET.r * Math.cos(it.ang), y: TARGET.y + it.rad * TARGET.r * Math.sin(it.ang) });
    const MIN = 11; // distância mínima entre pontas de setas (cauda com emoji ~12)
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
          const push = Math.min(0.4, (MIN - d) / (Math.max(items[i].rad, items[j].rad, 0.07) * TARGET.r + 1)) / 2;
          items[i].ang -= Math.sign(diff) * push;
          items[j].ang += Math.sign(diff) * push;
        }
      }
      if (!clash) break;
    }
    for (const it of items) points[it.id] = { ...pos(it), where: 'alvo', exact: it.exact };

    misses.forEach((p, k) => {
      // O "mais longe" fica o mais afastado do alvo; os outros falhanços, mais perto da borda.
      const far = p.show.farthest ? 1 : Math.min(0.8, p.show.level);
      if (k % 2 === 0) {
        const side = k % 4 === 0 ? 1 : -1;
        const x = TARGET.x + side * (TARGET.r + 16 + far * 44);
        const y = 58 + ((k * 37) % 100);
        points[p.id] = { x, y, where: 'parede' };
      } else {
        const x = 34 + ((k * 71 + 40) % 232);
        points[p.id] = { x, y: GRASS_Y + 4, where: 'chão' };
      }
    });
    return points;
  }

  window.RevealThemes.register('arco', () => {
    let kit = null;
    let scene = null;
    let arrowsLayer = null;
    let fxLayer = null;
    let answerText = null;
    let archers = {}; // id → { g, slot, player }
    let points = {};
    let flights = new Map(); // id → { frame, finish }
    const timers = new Set();

    // Arqueiro de cada jogador (só a pose muda; o desenho é sempre o drawCharacter).
    function placeArcher(id, pose) {
      const a = archers[id];
      const svg = kit.drawCharacter(a.player, pose, { size: a.h, small: a.small });
      svg.setAttribute('x', a.x);
      svg.setAttribute('y', a.bottom - a.h);
      a.g.replaceChildren(svg);
    }

    function bowPoint(id) {
      const a = archers[id];
      return { x: a.x + a.w * 0.86, y: a.bottom - a.h + a.h * (50 / 130) };
    }

    // Seta: haste na cor do jogador, penas e, na cauda, um círculo com o emoji do jogador.
    // `len` = distância da ponta ao centro da cauda (30 por omissão; mais comprida para afastar
    // caudas que ficariam juntas). O desenho fica num grupo interior (.arco-arrow-body), para a
    // vibração do "em cheio" (CSS) não apagar a posição (atributo transform do grupo de fora).
    function arrowShape(player, len = 30) {
      const f = len - 6; // onde começam as penas
      return s('g', { class: 'arco-arrow' }, [s('g', { class: 'arco-arrow-body' }, [
        s('line', { x1: -f, y1: 0, x2: 0, y2: 0, stroke: player.color, 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
        s('path', { d: 'M0,0 L-5,-2.6 L-5,2.6 Z', fill: '#495057' }),
        s('path', { d: `M${-f},0 L${-f - 5},-4 L${-f - 2},0 L${-f - 5},4 Z`, fill: player.color, stroke: 'rgba(0,0,0,.35)', 'stroke-width': 0.6 }),
        s('circle', { cx: -len, cy: 0, r: 6.2, fill: player.color, stroke: '#fff', 'stroke-width': 1.2 }),
        s('text', { x: -len, y: 0.4, 'font-size': 7.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'arco-emoji' }, [document.createTextNode(player.emoji || '')]),
      ])]);
    }

    // Curva do voo de cada seta: do arco do jogador até ao ponto onde acerta, a passar por cima.
    const flightOf = (id) => {
      const from = bowPoint(id);
      const to = points[id];
      return { from, to, ctrl: { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 40 } };
    };

    // Seta parada no sítio onde acertou, com a inclinação final (calculada uma vez, igual com e
    // sem animação). No alvo e na parede fica na direção do fim do voo; no chão fica quase de pé.
    function settle(node, id) {
      const { to } = flightOf(id);
      const deg = to.deg;
      node.setAttribute('transform', `translate(${to.x.toFixed(1)} ${to.y.toFixed(1)}) rotate(${deg.toFixed(1)})`);
      // O emoji da cauda fica sempre direito.
      node.querySelector('text').setAttribute('transform', `rotate(${(-deg).toFixed(1)} ${-to.len} 0)`);
    }

    function missFx(to) {
      // Nuvem de pó e "Falhou!" que desaparecem (só CSS: opacity/transform, uma vez).
      const g = s('g', { class: 'arco-miss', transform: `translate(${to.x} ${to.y})` }, [
        s('circle', { cx: -4, cy: 0, r: 4, fill: '#ced4da' }),
        s('circle', { cx: 3, cy: -2, r: 5, fill: '#dee2e6' }),
        s('circle', { cx: 6, cy: 3, r: 3.5, fill: '#ced4da' }),
        s('text', { x: 0, y: -12, 'text-anchor': 'middle', class: 'arco-miss-text' }, [document.createTextNode('Falhou!')]),
      ]);
      fxLayer.append(g);
      const t = setTimeout(() => { g.remove(); timers.delete(t); }, 1300);
      timers.add(t);
    }

    function hitFx(to) {
      const ring = s('circle', { cx: to.x, cy: to.y, r: 4, class: 'arco-hit' });
      fxLayer.append(ring);
      const t = setTimeout(() => { ring.remove(); timers.delete(t); }, 700);
      timers.add(t);
    }

    // "Em cheio": a seta dourada vibra (umas vezes, não para sempre), dois anéis dourados e
    // "EM CHEIO!" por baixo do alvo (nunca em cima da placa da resposta).
    function exactFx(node, to) {
      node.classList.add('quiver');
      const g = s('g', { class: 'arco-exact' }, [
        s('circle', { cx: to.x, cy: to.y, r: 5, class: 'arco-hit gold' }),
        s('circle', { cx: to.x, cy: to.y, r: 9, class: 'arco-hit gold' }),
        s('text', { x: TARGET.x, y: TARGET.y + TARGET.r + 3, 'text-anchor': 'middle', class: 'arco-exact-text' }, [document.createTextNode('EM CHEIO!')]),
      ]);
      fxLayer.append(g);
      const t = setTimeout(() => { g.remove(); timers.delete(t); }, 1400);
      timers.add(t);
    }

    return {
      mount(container, { players, kit: k, seed }) {
        kit = k;
        archers = {};
        // Com mais de 6 jogadores a cena é mais alta: os arqueiros ficam em duas filas
        // desencontradas, maiores (senão, com 12, ficavam minúsculos).
        const n = players.length;
        const twoRows = n > 6;
        const vh = twoRows ? VH_TALL : VH;
        scene = s('svg', { viewBox: `0 0 ${VW} ${vh}`, class: 'arco-scene', role: 'img', 'aria-label': 'Tiro com arco: quanto mais perto do centro do alvo, mais perto da resposta certa' });
        kit.sizeScene(scene, VW, vh, twoRows ? 60 : 45);

        // Parede, relva e chão.
        scene.append(
          s('rect', { x: 0, y: 0, width: VW, height: GRASS_Y, rx: 10, fill: 'url(#arco-wall)' }),
          s('defs', {}, [
            s('linearGradient', { id: 'arco-wall', x1: 0, y1: 0, x2: 0, y2: 1 }, [
              s('stop', { offset: '0', 'stop-color': '#2a2360' }),
              s('stop', { offset: '1', 'stop-color': '#3b3380' }),
            ]),
          ]),
          s('path', { d: `M0,${GRASS_Y} L${VW},${GRASS_Y} L${VW},${vh} L0,${vh} Z`, fill: '#2b8a3e' }),
          s('path', { d: `M0,${GRASS_Y} L${VW},${GRASS_Y}`, stroke: '#51cf66', 'stroke-width': 3 }),
          s('path', { d: `M0,${GRASS_Y + 22} L${VW},${GRASS_Y + 22}`, stroke: '#237032', 'stroke-width': 1, opacity: 0.6 }),
        );

        // Pés do alvo e o alvo (10 anéis, das cores clássicas).
        scene.append(
          s('path', { d: `M${TARGET.x - 34},${GRASS_Y} L${TARGET.x - 14},${TARGET.y + 30} M${TARGET.x + 34},${GRASS_Y} L${TARGET.x + 14},${TARGET.y + 30}`, stroke: '#8d5a2b', 'stroke-width': 5, 'stroke-linecap': 'round' }),
          s('circle', { cx: TARGET.x, cy: TARGET.y, r: TARGET.r + 4, fill: '#8d5a2b' }),
        );
        RINGS.forEach((color, i) => {
          const r = TARGET.r * (1 - i / RINGS.length);
          scene.append(s('circle', { cx: TARGET.x, cy: TARGET.y, r, fill: color, stroke: i < 2 ? '#adb5bd' : 'rgba(255,255,255,.35)', 'stroke-width': 0.6 }));
        });
        scene.append(s('path', { d: `M${TARGET.x - 3},${TARGET.y} L${TARGET.x + 3},${TARGET.y} M${TARGET.x},${TARGET.y - 3} L${TARGET.x},${TARGET.y + 3}`, stroke: '#7a5a00', 'stroke-width': 0.8 }));

        // Placa da resposta certa, no topo (zona onde nunca cai nenhuma seta).
        answerText = s('text', { x: VW / 2, y: 26, 'text-anchor': 'middle', class: 'arco-answer' }, [document.createTextNode('?')]);
        scene.append(
          s('rect', { x: VW / 2 - 62, y: 4, width: 124, height: 30, rx: 8, class: 'arco-plaque' }),
          s('text', { x: VW / 2 - 56, y: 13, class: 'arco-plaque-label' }, [document.createTextNode('RESPOSTA')]),
          answerText,
        );

        arrowsLayer = s('g', { class: 'arco-arrows' });
        fxLayer = s('g', { class: 'arco-fx' });
        const archersLayer = s('g', { class: 'arco-archers' });

        // Fila de arqueiros: um lugar por jogador. Com mais de 6, duas filas desencontradas (a de
        // trás meio lugar ao lado), com a versão pequena do boneco mas maior do que numa só fila.
        if (!twoRows) {
          const slot = VW / n;
          const h = Math.min(74, slot * 1.25);
          const w = h * (100 / 130);
          players.forEach((p, i) => {
            const g = s('g', { class: 'arco-archer', 'data-id': p.id });
            archers[p.id] = { g, player: p, x: i * slot + (slot - w) / 2, bottom: ARCHER_BOTTOM, w, h, small: false };
            archersLayer.append(g);
          });
        } else {
          const cols = Math.ceil(n / 2);
          const slot = VW / (cols + 0.5);
          const h = Math.min(64, slot * 1.3);
          const w = h * (100 / 130);
          const back = s('g');
          const front = s('g');
          players.forEach((p, i) => {
            const row = i % 2; // 0 = à frente, 1 = atrás
            const col = Math.floor(i / 2);
            const g = s('g', { class: 'arco-archer', 'data-id': p.id });
            archers[p.id] = {
              g, player: p, w, h, small: true,
              x: col * slot + (slot - w) / 2 + (row ? slot / 2 : 0),
              bottom: row ? vh - 4 - h * 0.85 : vh - 4,
            };
            (row ? back : front).append(g);
          });
          archersLayer.append(back, front);
        }
        for (const p of players) placeArcher(p.id, 'arco');

        scene.append(archersLayer, arrowsLayer, fxLayer);
        container.append(scene);
        points = aimPoints(players, seed);
        // Inclinação final de cada seta: na direção de quem a disparou, por isso a cauda aponta
        // sempre para baixo, para os arqueiros, e nunca sobe até à placa da resposta. No chão
        // fica quase de pé.
        for (const p of players) {
          const { from, to } = flightOf(p.id);
          to.deg = to.where === 'chão' ? 70 + ((to.x * 7) % 20) : (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
          to.len = 30;
        }
        // Caudas (com o emoji) demasiado juntas: rodam as duas em sentidos opostos e, se não
        // chegar, uma fica um pouco mais comprida, até se verem todas.
        const rad = (d) => (d * Math.PI) / 180;
        const tail = (pt) => ({ x: pt.x - pt.len * Math.cos(rad(pt.deg)), y: pt.y - pt.len * Math.sin(rad(pt.deg)) });
        // A cauda continua virada para baixo (setas que sobem: entre −165° e −15°); as espetadas
        // no chão ficam quase de pé.
        const clamp = (pt) => {
          pt.deg = pt.where === 'chão' ? Math.max(55, Math.min(125, pt.deg)) : Math.max(-165, Math.min(-15, pt.deg));
        };
        const list = players.map((p) => points[p.id]);
        for (let iter = 0; iter < 200; iter++) {
          let clash = false;
          for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
              const a = tail(list[i]);
              const b = tail(list[j]);
              if (Math.hypot(a.x - b.x, a.y - b.y) >= 14) continue;
              clash = true;
              const side = a.x <= b.x ? 1 : -1; // cada cauda afasta-se para o lado de que já está
              list[i].deg -= side * 4;
              list[j].deg += side * 4;
              clamp(list[i]);
              clamp(list[j]);
              if (iter > 20) list[j].len = Math.min(44, list[j].len + 2);
            }
          }
          if (!clash) break;
        }
      },

      revealPlayer(player, precision, { instant }) {
        const { from, to, ctrl } = flightOf(player.id);
        const node = arrowShape(player, to.len);
        node.dataset.id = player.id;
        arrowsLayer.append(node);
        archers[player.id].g.classList.add('shot');
        // "Em cheio": seta dourada, que vibra no centro ao cravar-se.
        if (player.show.exact) node.classList.add('gold');

        if (instant || kit.reducedMotion()) {
          settle(node, player.id);
          return;
        }
        // Voo em arco (curva de Bézier), com a seta a apontar sempre na direção do movimento.
        const start = performance.now();
        const finish = () => {
          cancelAnimationFrame(flights.get(player.id)?.frame);
          flights.delete(player.id);
          settle(node, player.id);
          if (player.show.exact) exactFx(node, to);
          else if (to.where === 'alvo') hitFx(to);
          else missFx(to);
        };
        const frame = (now) => {
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
          flights.get(player.id).frame = requestAnimationFrame(frame);
        };
        flights.set(player.id, { frame: requestAnimationFrame(frame), finish });
      },

      // Resposta certa na placa (a rolar até ao valor). O mais perto festeja; o mais longe fica
      // triste (se não empatou toda a gente); os outros baixam o arco (pose normal). As setas do
      // mais perto ganham um brilho.
      revealAnswer(answer, { closest, farthest, instant }) {
        for (const f of [...flights.values()]) f.finish();
        if (instant) answerText.textContent = kit.fmt(answer);
        else kit.countUp(answerText, answer);
        for (const id of Object.keys(archers)) {
          const near = closest.includes(id);
          const far = farthest.includes(id) && !near;
          placeArcher(id, near ? 'festejar' : far ? 'triste' : 'parado');
          archers[id].g.classList.toggle('near', near);
          archers[id].g.classList.toggle('far', far);
        }
        for (const node of arrowsLayer.children) {
          node.classList.toggle('near', closest.includes(node.dataset.id));
          node.classList.toggle('far', farthest.includes(node.dataset.id) && !closest.includes(node.dataset.id));
        }
        // As setas do mais perto ficam por cima das outras.
        for (const node of [...arrowsLayer.children]) if (node.classList.contains('near')) arrowsLayer.append(node);
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
        scene = arrowsLayer = fxLayer = answerText = null;
        archers = {};
      },
    };
  });
})();
