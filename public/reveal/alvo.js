'use strict';

// Tema "alvo": anéis concêntricos com a resposta certa no centro (escondida com "?" até ao
// fim). A distância ao centro é a precisão (precision.js): cada anel é uma ordem de grandeza
// do erro (até 1%, até 10%, até 100%) e os erros maiores ficam no anel de fora. Os avatares
// aterram um a um com um pequeno voo e ressalto.
(function () {
  const CENTER = 0.19; // raio do centro, em fração do raio útil
  const MAX_PRECISION = 4 / 3; // precisão de um erro de 1000%: encosta ao anel de fora
  const RING_ERRORS = [{ err: 0.01, label: '1%' }, { err: 0.1, label: '10%' }, { err: 1, label: '100%' }];
  const RING_FILLS = ['#2a2360', '#332b72', '#3d3584', '#473f96'];
  const NS = 'http://www.w3.org/2000/svg';

  // 0,24 (erro mínimo) até 1 (erro de 1000% ou mais). O "em cheio" fica encostado ao centro,
  // à volta da resposta certa (nunca por cima dela).
  const radiusOf = (precision, exactRad) => (precision === 0 ? exactRad
    : 0.24 + 0.76 * (Math.min(precision, MAX_PRECISION) / MAX_PRECISION));

  // Tamanho dos avatares: ~16% do alvo (48 px num alvo de 300 px), para o encosto ao centro
  // ainda ficar dentro do anel de 1%; com mais de 6 jogadores encolhem, para caberem todos.
  const avatarSize = (size, n) => Math.round(Math.min(52, Math.max(30, size * 0.16 * Math.min(1, Math.sqrt(6 / Math.max(n, 1))))));

  // Ângulos distribuídos pela ordem da revelação, com meio passo de desvio para nenhum ficar no
  // topo (onde estão as etiquetas dos anéis). Se dois avatares ficarem quase no mesmo sítio
  // (ex.: palpites iguais), afasta-os no ângulo e, se não chegar, um pouco no raio.
  function layout(players, size, av) {
    const R = size / 2 - av / 2 - 4; // raio útil, em px (o avatar nunca sai do alvo)
    const exactRad = CENTER + (av / 2 + 3) / R;
    const n = Math.max(players.length, 1);
    // Ninguém fica mais perto do centro do que o encosto à resposta certa (nunca a tapa).
    const items = players.map((p, i) => {
      const rad = Math.max(exactRad, radiusOf(p.precision, exactRad));
      return { id: p.id, rad, min: exactRad, ang: -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / n };
    });
    const pos = (it) => ({ x: it.rad * R * Math.cos(it.ang), y: it.rad * R * Math.sin(it.ang) });
    // Distância mínima entre avatares a contar com a etiqueta do valor por baixo de cada um
    // (que pode ser mais larga do que o avatar, ex.: "10 000").
    const minDist = av * 1.3;
    for (let iter = 0; iter < 300; iter++) {
      let clash = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const A = items[i];
          const B = items[j];
          const a = pos(A);
          const b = pos(B);
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d >= minDist) continue;
          clash = true;
          let diff = B.ang - A.ang;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff)) || 0.01;
          const push = Math.min(0.35, (minDist - d) / (Math.max(A.rad, B.rad) * R + 1)) / 2;
          A.ang -= Math.sign(diff) * push;
          B.ang += Math.sign(diff) * push;
          // Depois de muitas voltas sem resolver, também no raio (o de fora vai para fora).
          if (iter > 60) {
            const [inner, outer] = A.rad <= B.rad ? [A, B] : [B, A];
            const step = ((minDist - d) / R) * 0.25;
            outer.rad = Math.min(1, outer.rad + step);
            inner.rad = Math.max(inner.min, inner.rad - step);
          }
        }
      }
      if (!clash) break;
    }
    return Object.fromEntries(items.map((it) => {
      const p = pos(it);
      return [it.id, { x: 50 + (p.x / size) * 100, y: 50 + (p.y / size) * 100 }];
    }));
  }

  function rings(svg, size, av, precisionOf) {
    const R = ((size / 2 - av / 2 - 4) / size) * 100; // em unidades do viewBox (0..100)
    const make = (tag, attrs) => {
      const node = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      return node;
    };
    // Fronteiras dos anéis: as precisões dos erros de 1%, 10% e 100%, e a borda de fora.
    const radii = [...RING_ERRORS.map((r) => ({ ...r, r: radiusOf(precisionOf(1 + r.err, 1), 0) })), { r: 1 }];
    const nodes = [make('circle', { cx: 50, cy: 50, r: 49.5, class: 'tgt-rim' })];
    [...radii].reverse().forEach((ring, i) => nodes.push(make('circle', { cx: 50, cy: 50, r: ring.r * R, fill: RING_FILLS[i], class: 'tgt-ring' })));
    for (const ring of radii) {
      if (!ring.label) continue;
      const label = make('text', { x: 50, y: 50 - ring.r * R + 3.6, class: 'tgt-label' });
      label.textContent = ring.label;
      nodes.push(label);
    }
    svg.replaceChildren(...nodes);
    return R;
  }

  window.RevealThemes.register('alvo', () => {
    let kit = null;
    let board = null;
    let layer = null;
    let center = null;
    let positions = {};

    return {
      mount(container, { players, kit: k }) {
        kit = k;
        board = kit.el('div', { class: 'tgt-board', role: 'img', 'aria-label': 'Alvo: quanto mais perto do centro, mais perto da resposta certa' });
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('aria-hidden', 'true');
        center = kit.el('span', { text: '?' });
        layer = kit.el('div', { class: 'tgt-players' });
        board.append(svg, kit.el('div', { class: 'tgt-center' }, center), layer);
        container.append(board);
        // Tamanho fixo desde o início: tudo é calculado já com todos os jogadores.
        const size = board.clientWidth || 300;
        const av = avatarSize(size, players.length);
        board.style.setProperty('--av', `${av}px`);
        const R = rings(svg, size, av, kit.precisionOf);
        board.style.setProperty('--center', `${CENTER * R * 2}%`);
        positions = layout(players, size, av);
      },

      revealPlayer(player, precision, { value, instant }) {
        const node = kit.el('div', { class: `tgt-player ${instant ? '' : 'land'}`, 'data-id': player.id }, [
          player.avatar('l'),
          kit.el('span', { class: 'tgt-val', text: kit.fmt(value) }),
        ]);
        const pos = positions[player.id] || { x: 50, y: 50 };
        node.style.left = `${pos.x}%`;
        node.style.top = `${pos.y}%`;
        layer.append(node);
      },

      // O "?" passa a ser a resposta certa, a rolar até ao valor. O mais perto ganha brilho
      // verde; o mais longe, contorno vermelho e um abanão (se não empatou toda a gente).
      revealAnswer(answer, { closest, farthest, instant }) {
        const box = center.parentElement;
        box.classList.add('revealed');
        if (instant) box.classList.add('instant');
        center.dataset.len = String(kit.fmt(answer).length);
        if (instant) center.textContent = kit.fmt(answer);
        else kit.countUp(center, answer);
        for (const node of layer.children) {
          const id = node.dataset.id;
          node.classList.toggle('near', closest.includes(id));
          node.classList.toggle('far', farthest.includes(id) && !closest.includes(id));
          if (instant) node.classList.add('instant');
        }
      },

      skipToEnd() {
        for (const node of layer.children) node.classList.remove('land');
      },

      destroy() {
        if (center) kit.stopCount(center);
        if (board) board.remove();
        board = layer = center = null;
      },
    };
  });
})();
