'use strict';

/*
 * Legendas da revelação das perguntas de NÚMEROS (código comum a todos os temas, usado pelo
 * controlador em public/reveal/index.js). Para se perceber QUAL FOI O PALPITE de cada um
 * enquanto se olha para a animação:
 *
 *   1. Legenda "tipo televisão" na vez de cada jogador: retrato, nome e o palpite em destaque,
 *      com a unidade ("Ana · 452 metros"). Fica numa faixa própria por cima do cenário (não tapa
 *      nada) e sai quando começa a vez seguinte. Antes da resposta certa só mostra o palpite.
 *   2. Etiqueta no cenário com o palpite, na cor do jogador, junto ao sítio onde ficou (a bola,
 *      a seta, o kart…). Aparece no fim da vez dele. As etiquetas nunca se sobrepõem nem tapam a
 *      resposta certa: procura-se um lugar livre à volta da marca; se não houver, a etiqueta
 *      encurta (sem o nome, depois sem a diferença) e, em último caso, não aparece (o palpite
 *      continua na lista por baixo). Com mais de 6 jogadores nunca leva o nome.
 *   3. Depois da resposta certa: cada etiqueta mostra também a diferença ("452 · −1554"); a do
 *      vencedor diz "em cheio!" ou "mais perto" e ganha destaque. Na faixa de cima aparece, ~2 s,
 *      o resumo: "Mais perto: Carla (2005)" e "Mais longe: Bruno (3)".
 *
 * Onde fica a marca de cada jogador diz-o o TEMA, com o método opcional markOf(id), que devolve:
 *   - um elemento (a etiqueta fica à volta dele), ou
 *   - { el } ou { x, y } (ponto em coordenadas da cena SVG), com opções:
 *       prefer: ordem dos lados a experimentar ('above', 'below', 'right', 'left');
 *       fixed: true — a etiqueta fica exatamente no ponto (ex.: dentro da célula do placar);
 *       align: 'start' — com `fixed`, a etiqueta começa no ponto (em vez de ficar centrada);
 *       maxWidth — com `fixed`, largura máxima em unidades da cena;
 *   - null: sem etiqueta para esse jogador.
 * Sem markOf, procura um elemento com data-mark="<id>" na cena. Os elementos com o atributo
 * data-avoid (a placa da resposta certa e a zona principal do tema: a baliza, o alvo, o cesto…)
 * nunca ficam tapados por etiquetas. Quando à volta da marca não há lugar, a etiqueta vai para o
 * lugar livre mais perto, em toda a cena, ligada à marca por uma linha fina.
 */
(function (root) {
  const numberFormat = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 3 });
  const fmt = (n) => numberFormat.format(n);
  const withUnit = (n, unit) => (unit ? `${fmt(n)} ${unit}` : fmt(n));
  const reducedMotion = () => root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAX_NAMES = 6; // com mais jogadores, as etiquetas só levam o número
  const SUMMARY_MS = 2300;
  const GAP = 3;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }
  // Texto escuro nas cores claras, branco nas escuras.
  function inkOn(hex) {
    const n = parseInt(String(hex || '#888').replace('#', '').slice(0, 6), 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.62 ? '#1d1846' : '#ffffff';
  }
  const shortName = (name) => (name.length > 10 ? `${name.slice(0, 9)}…` : name);
  const overlaps = (a, b) => a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1;
  // Entre etiquetas, pelo menos 2 px de folga (as posições são arredondadas ao píxel).
  const crowds = (a, b) => a.l < b.r + 2 && a.r > b.l - 2 && a.t < b.b + 2 && a.b > b.t - 2;

  function createCaptions({ stage, avatarOf }) {
    let c = null; // estado da ronda atual

    function stop() {
      if (!c) return;
      for (const t of c.timers) clearTimeout(t);
      clearInterval(c.interval);
      if (c.observer) c.observer.disconnect();
      c = null;
    }
    const later = (fn, ms) => {
      const t = setTimeout(() => { if (c) c.timers.delete(t); fn(); }, ms);
      c.timers.add(t);
    };

    // Ronda nova: a faixa de cima (legenda e resumo) e a camada das etiquetas. Chamado depois
    // de o tema montar a cena (fica por cima dela).
    function start(r, theme) {
      stop();
      stage.classList.remove('captions-closing');
      stage.classList.add('has-captions');
      const caption = el('div', { class: 'rv-caption', 'aria-live': 'polite' });
      const layer = el('div', { class: 'rv-marks', 'aria-hidden': 'true' });
      // Linhas finas da etiqueta até à marca, quando a etiqueta teve de ficar mais afastada.
      const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      lines.setAttribute('class', 'rv-lines');
      layer.append(lines);
      stage.append(caption, layer);
      c = { r, theme, caption, layer, lines, labels: new Map(), revealed: [], answer: false, timers: new Set(), interval: null, observer: null };
      if (root.ResizeObserver) {
        c.observer = new ResizeObserver(() => layout());
        c.observer.observe(stage);
      }
      // Enquanto há coisas a mexer, as etiquetas acompanham as marcas.
      c.interval = setInterval(layout, 250);
      // Quando as letras acabam de carregar, as etiquetas mudam de largura: volta a arrumá-las.
      if (document.fonts) {
        const round = c;
        document.fonts.ready.then(() => { if (c === round) { c.lastLayout = null; layout(); } });
      }
    }

    // A vez de um jogador: legenda na faixa de cima; as etiquetas de quem já jogou aparecem
    // todas e a deste aparece no fim da sua vez (ou logo, sem animação).
    function turn(id, { duration = 0, instant = false, caption = true } = {}) {
      if (!c) return;
      for (const prev of c.revealed) showLabel(prev);
      c.revealed.push(id);
      if (caption && !c.answer) showCaption(id, instant);
      if (instant) showLabel(id);
      else later(() => showLabel(id), Math.max(0, duration - 150));
    }

    function showCaption(id, instant) {
      const { r } = c;
      const p = r.players[id] || { name: '?' };
      c.caption.replaceChildren(el('div', {
        class: `rv-caption-box${instant || reducedMotion() ? '' : ' in'}`,
        style: `--c:${p.color || '#888'}`,
      }, [
        avatarOf(id, 'm'),
        el('span', { class: 'rv-caption-name', text: p.name }),
        el('strong', { class: 'rv-caption-value', text: withUnit(r.answers[id], r.unit) }),
      ]));
    }

    function showLabel(id) {
      if (!c || c.labels.has(id) || !c.r.players[id]) return;
      const p = c.r.players[id];
      const node = el('span', { class: `rv-mark${reducedMotion() ? '' : ' in'}`, style: `--c:${p.color};--ink:${inkOn(p.color)}` });
      c.labels.set(id, node);
      c.layer.append(node);
      layout();
    }

    // Resposta certa: as etiquetas passam a ter a diferença, e o resumo aparece ~2 s.
    function answer({ summary = true } = {}) {
      if (!c) return;
      c.answer = true;
      c.caption.replaceChildren();
      for (const id of c.revealed) showLabel(id);
      layout();
      if (!summary || !showSummary()) collapse();
      // As marcas ainda podem mexer um pouco (festejos); depois disso, já não é preciso seguir.
      later(() => clearInterval(c.interval), 2500);
    }

    function showSummary() {
      const { r } = c;
      const who = (ids) => ids.filter((id) => r.players[id]).map((id) => `${r.players[id].name} (${fmt(r.answers[id])})`).join(', ');
      const near = r.closest.filter((id) => r.players[id]);
      const far = r.farthest.filter((id) => r.players[id] && !r.closest.includes(id));
      if (!near.length) return false;
      const box = el('div', { class: `rv-summary${reducedMotion() ? ' still' : ''}` }, [
        el('div', { class: 'near' }, [el('b', { text: 'Mais perto: ' }), who(near)]),
        far.length ? el('div', { class: 'far' }, [el('b', { text: 'Mais longe: ' }), who(far)]) : null,
      ]);
      c.caption.replaceChildren(box);
      later(() => { box.remove(); collapse(); }, SUMMARY_MS);
      return true;
    }

    // Fim da revelação: a faixa de cima já não tem nada (o resumo saiu, ou não houve resumo).
    // Encolhe-se, para não ficar um espaço vazio por cima do cenário; enquanto o cenário sobe,
    // as etiquetas acompanham-no.
    function collapse() {
      if (!c || !stage.classList.contains('has-captions')) return;
      stage.classList.add('captions-closing');
      stage.classList.remove('has-captions');
      const round = c;
      const end = performance.now() + 500;
      const follow = () => {
        if (c !== round) return;
        layout();
        if (performance.now() < end) requestAnimationFrame(follow);
      };
      requestAnimationFrame(follow);
    }

    // Variantes do texto de cada etiqueta, da mais completa para a mais curta.
    function variants(id) {
      const { r } = c;
      const many = r.order.length > MAX_NAMES;
      const name = shortName(r.players[id].name);
      const value = fmt(r.answers[id]);
      if (!c.answer) return many ? [{ value }] : [{ name, value }, { value }];
      const dist = r.distances[id];
      const winner = r.closest.includes(id);
      const diff = dist === 0 ? 'em cheio!' : winner ? 'mais perto' : `${r.answers[id] < r.correct ? '−' : '+'}${fmt(dist)}`;
      // Sem espaço, o vencedor fica com uma estrela (nunca perde o destaque).
      const full = [{ name, value, diff }, { value, diff }, ...(winner ? [{ value, diff: '★' }] : []), { value }];
      return many ? full.slice(1) : full;
    }
    function paint(node, v, id) {
      const { r } = c;
      node.replaceChildren(...[
        v.name ? el('span', { class: 'nm', text: v.name }) : null,
        el('b', { text: v.value }),
        v.diff ? el('span', { class: 'df', text: ` · ${v.diff}` }) : null,
      ].filter(Boolean));
      node.classList.toggle('near', c.answer && r.closest.includes(id));
      node.classList.toggle('far', c.answer && r.farthest.includes(id) && !r.closest.includes(id));
    }

    // Onde fica a marca de um jogador (retângulo relativo ao palco), a partir do tema.
    function specOf(id) {
      let m = c.theme && typeof c.theme.markOf === 'function' ? c.theme.markOf(id) : undefined;
      if (m === undefined) m = stage.querySelector(`[data-mark="${CSS.escape(id)}"]`);
      if (!m) return null;
      return m instanceof Element ? { el: m } : m;
    }
    function sceneSvg() {
      return [...stage.children].find((n) => n.tagName && n.tagName.toLowerCase() === 'svg') || null;
    }
    function anchorOf(spec, S) {
      if (spec.el) {
        if (!spec.el.isConnected) return null;
        const b = spec.el.getBoundingClientRect();
        if (!b.width && !b.height) return null;
        return { l: b.left - S.left, t: b.top - S.top, r: b.right - S.left, b: b.bottom - S.top };
      }
      const svg = spec.svg || sceneSvg();
      const ctm = svg && svg.getScreenCTM();
      if (!ctm) return null;
      const p = new DOMPoint(spec.x, spec.y).matrixTransform(ctm);
      return { l: p.x - S.left, t: p.y - S.top, r: p.x - S.left, b: p.y - S.top, scale: ctm.a };
    }
    function candidates(a, w, h, spec) {
      const cx = (a.l + a.r) / 2;
      const cy = (a.t + a.b) / 2;
      const rect = (l, t) => ({ l, t, r: l + w, b: t + h });
      if (spec.fixed) return [rect(spec.align === 'start' ? a.l : cx - w / 2, cy - h / 2)];
      const base = {
        above: (k, s) => rect(cx - w / 2 + s, a.t - GAP - h - k * (h + 2)),
        below: (k, s) => rect(cx - w / 2 + s, a.b + GAP + k * (h + 2)),
        right: (k, s) => rect(a.r + GAP + Math.abs(s) / 2, cy - h / 2 + k * (s < 0 ? -1 : 1) * (h + 2)),
        left: (k, s) => rect(a.l - GAP - w - Math.abs(s) / 2, cy - h / 2 + k * (s < 0 ? -1 : 1) * (h + 2)),
      };
      const order = spec.prefer || ['above', 'below', 'right', 'left'];
      const out = [];
      for (let k = 0; k <= 3; k++) {
        for (const shift of k === 0 ? [0] : [0, -(w / 2 + 2), w / 2 + 2]) {
          for (const side of order) out.push(base[side](k, shift));
        }
      }
      return out;
    }

    // Lugar livre mais perto da marca em toda a cena (procura numa grelha de 6 px), para quando
    // à volta da marca não há espaço (ex.: muitas bolas dentro da baliza, que não se pode tapar).
    // A etiqueta fica onde houver lugar e uma linha fina liga-a à marca.
    function nearestFree(a, w, h, bounds, ok) {
      const ax = (a.l + a.r) / 2;
      const ay = (a.t + a.b) / 2;
      let best = null;
      let bestD = Infinity;
      for (let t = bounds.t; t + h <= bounds.b; t += 6) {
        for (let l = bounds.l; l + w <= bounds.r; l += 6) {
          const q = { l, t, r: l + w, b: t + h };
          const dx = Math.max(0, q.l - ax, ax - q.r);
          const dy = Math.max(0, q.t - ay, ay - q.b);
          const d = dx * dx + dy * dy;
          if (d < bestD && ok(q)) { best = q; bestD = d; }
        }
      }
      return best;
    }

    // Coloca todas as etiquetas visíveis, sem se sobreporem, dentro da cena e sem tapar a placa
    // da resposta nem a zona principal do tema (data-avoid). O vencedor escolhe primeiro (depois
    // da resposta certa). Se nada mudou desde a última vez, não faz nada.
    function layout() {
      if (!c || !c.labels.size) return;
      const S = stage.getBoundingClientRect();
      if (!S.width) return;
      const rel = (b) => ({ l: b.left - S.left, t: b.top - S.top, r: b.right - S.left, b: b.bottom - S.top });
      const scene = [...stage.children].find((n) => !n.classList.contains('rv-caption') && !n.classList.contains('rv-marks'));
      const bounds = scene ? rel(scene.getBoundingClientRect()) : { l: 0, t: 0, r: S.width, b: S.height };
      const avoid = [...stage.querySelectorAll('[data-avoid]')].map((n) => rel(n.getBoundingClientRect()));
      const ids = [...c.labels.keys()];
      if (c.answer) ids.sort((a, b) => c.r.closest.includes(b) - c.r.closest.includes(a));
      const anchors = new Map();
      for (const id of c.revealed) {
        const spec = specOf(id);
        anchors.set(id, spec ? { spec, rect: anchorOf(spec, S) } : null);
      }
      const round = (q) => q && [q.l, q.t, q.r, q.b].map(Math.round).join(',');
      const signature = JSON.stringify([c.answer, ids, round(bounds), avoid.map(round), [...anchors].map(([k, v]) => [k, v && round(v.rect)])]);
      if (signature === c.lastLayout) return;
      c.lastLayout = signature;
      const placed = [];
      const leaders = [];
      const inside = (q) => q.l >= bounds.l && q.t >= bounds.t && q.r <= bounds.r && q.b <= bounds.b;
      const free = (q, list) => !list.some((o) => overlaps(q, o));
      const apart = (q) => !placed.some((o) => crowds(q, o)) && !avoid.some((o) => crowds(q, o));
      for (const id of ids) {
        const node = c.labels.get(id);
        const anchor = anchors.get(id);
        let spot = null;
        if (anchor && anchor.rect) {
          const marks = [...anchors].filter(([k, v]) => k !== id && v && v.rect).map(([, v]) => v.rect);
          for (const v of variants(id)) {
            paint(node, v, id);
            const w = node.offsetWidth;
            const h = node.offsetHeight;
            if (anchor.spec.maxWidth && anchor.rect.scale && w > anchor.spec.maxWidth * anchor.rect.scale) continue;
            const cands = candidates(anchor.rect, w, h, anchor.spec);
            spot = cands.find((q) => inside(q) && apart(q) && free(q, marks))
              || cands.find((q) => inside(q) && apart(q));
            // Sem lugar à volta: o lugar livre mais perto, em toda a cena (sem tapar marcas e,
            // se não houver, tapando só marcas).
            if (!spot && !anchor.spec.fixed) {
              spot = nearestFree(anchor.rect, w, h, bounds, (q) => apart(q) && free(q, marks))
                || nearestFree(anchor.rect, w, h, bounds, apart);
            }
            if (spot) break;
          }
        }
        node.classList.toggle('off', !spot);
        if (!spot) continue;
        placed.push(spot);
        node.style.left = `${Math.round(spot.l)}px`;
        node.style.top = `${Math.round(spot.t)}px`;
        // Longe da marca: uma linha liga-as (do centro da marca ao ponto mais perto da etiqueta).
        const a = anchor.rect;
        const ax = (a.l + a.r) / 2;
        const ay = (a.t + a.b) / 2;
        const px = Math.max(spot.l, Math.min(ax, spot.r));
        const py = Math.max(spot.t, Math.min(ay, spot.b));
        const gapX = Math.max(0, a.l - spot.r, spot.l - a.r);
        const gapY = Math.max(0, a.t - spot.b, spot.t - a.b);
        if (Math.hypot(gapX, gapY) > 8) leaders.push({ ax, ay, px, py, color: c.r.players[id].color });
      }
      const NS = 'http://www.w3.org/2000/svg';
      c.lines.replaceChildren(...leaders.map((d) => {
        const line = document.createElementNS(NS, 'line');
        for (const [k, v] of Object.entries({ x1: d.ax, y1: d.ay, x2: d.px, y2: d.py, stroke: d.color })) line.setAttribute(k, typeof v === 'number' ? v.toFixed(1) : v);
        return line;
      }));
    }

    // O anfitrião saltou (ou entrou-se a meio): todas as etiquetas de uma vez.
    function showAll() {
      if (!c) return;
      for (const id of c.revealed) showLabel(id);
      layout();
    }

    function destroy() {
      stop();
      stage.classList.remove('has-captions', 'captions-closing');
    }

    return { start, turn, answer, showAll, layout, destroy };
  }

  root.RevealCaptions = { createCaptions };
})(window);
