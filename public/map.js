'use strict';

/*
 * Mapa-mundo das perguntas de mapa: o que desenha o mapa, o zoom, o enquadramento e a
 * revelação (pinos, linhas até à resposta e etiquetas sem sobreposições). Partilhado pelo jogo
 * (client.js) e pela página de pré-visualização (dev/reveal.html), para a página mostrar
 * exatamente o mesmo que o jogo.
 *
 * O mapa (mapa.svg) é uma projeção equirretangular recortada entre as latitudes MAP_TOP e
 * MAP_BOTTOM (tem de bater certo com scripts/gerar-mapa.js). Cada mapa vive num ".map-wrap"
 * com ".map-box" (a vista, de tamanho fixo, que se arrasta) > ".map-inner" (o mapa, que cresce
 * com o zoom) > ".pins", e os botões [data-zoom].
 */
(function (root) {
  const MAP_TOP = 84;
  const MAP_BOTTOM = -58;
  const ZOOMS = [1, 2, 4, 8];
  const MAP_RATIO = (MAP_TOP - MAP_BOTTOM) / 360; // altura / largura do mapa
  const NS = 'http://www.w3.org/2000/svg';
  let mapSvg = '';

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  // Carrega o desenho do mapa (uma vez). Devolve uma promessa.
  function load(url) {
    return fetch(url).then((r) => {
      if (!r.ok) throw new Error(`mapa: ${r.status}`);
      return r.text();
    }).then((svg) => { mapSvg = svg; return svg; });
  }
  const loaded = () => Boolean(mapSvg);

  const toPercent = ({ lat, lon }) => ({
    x: ((lon + 180) / 360) * 100,
    y: ((MAP_TOP - lat) / (MAP_TOP - MAP_BOTTOM)) * 100,
  });
  // Ponto do mapa onde se tocou (para escolher o palpite).
  function pointAt(event, inner) {
    const rect = inner.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    return { lon: fx * 360 - 180, lat: MAP_TOP - fy * (MAP_TOP - MAP_BOTTOM) };
  }

  // `face` (opcional): o mini-retrato do jogador, antes do texto da etiqueta.
  function pin(point, cls = '', label = '', color = null, face = null) {
    const { x, y } = toPercent(point);
    return el('span', { class: `pin ${cls}`, style: `left:${x}%;top:${y}%${color ? `;--c:${color}` : ''}` },
      label ? el('span', { class: 'pin-label' }, [face, label]) : null);
  }

  // Muda o zoom e põe o ponto (cx, cy), em frações do mapa, no centro da vista.
  function setZoom(wrap, level, cx, cy) {
    const box = wrap.querySelector('.map-box');
    const inner = wrap.querySelector('.map-inner');
    wrap.dataset.zoom = String(level);
    inner.style.width = `${ZOOMS[level] * 100}%`;
    box.scrollLeft = cx * inner.offsetWidth - box.clientWidth / 2;
    box.scrollTop = cy * inner.offsetHeight - box.clientHeight / 2;
    if (wrap.relayout) wrap.relayout(); // com outro zoom, as etiquetas chocam de outra maneira
  }

  const narrowScreen = () => window.innerWidth < 600;
  // No telemóvel o mapa inteiro fica muito baixo: o zoom mínimo é 2×.
  const minZoom = () => (narrowScreen() ? 1 : 0);

  // O contentor do mapa tem tamanho FIXO: largura total e altura até 45% do ecrã (nunca maior
  // do que o mapa no zoom mínimo, para não sobrar mar). O zoom acontece só lá dentro, sem
  // fazer crescer a página.
  function sizeMapBox(wrap) {
    const box = wrap.querySelector('.map-box');
    if (!box.clientWidth) return;
    const full = box.clientWidth * ZOOMS[minZoom()] * MAP_RATIO;
    box.style.height = `${Math.round(Math.min(window.innerHeight * 0.45, full))}px`;
  }
  window.addEventListener('resize', () => document.querySelectorAll('.map-wrap').forEach(sizeMapBox));

  // Sem barras de scroll: no telemóvel arrasta-se com o dedo (scroll nativo); no computador,
  // com o rato. Um arrasto não conta como toque para escolher o sítio.
  function enableMouseDrag(box) {
    let start = null;
    let moved = false;
    box.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop };
      moved = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) { moved = true; box.classList.add('dragging'); }
      box.scrollLeft = start.left - dx;
      box.scrollTop = start.top - dy;
    });
    window.addEventListener('pointerup', () => { start = null; box.classList.remove('dragging'); });
    box.addEventListener('click', (e) => {
      if (!moved) return;
      moved = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  // Põe o SVG no mapa (quando já chegou) e liga os botões de zoom uma vez.
  function setup(wrap) {
    const box = wrap.querySelector('.map-box');
    const inner = wrap.querySelector('.map-inner');
    // (O mapa da revelação também tem um <svg class="lines"> por cima, para as linhas.)
    if (mapSvg && !inner.querySelector('svg:not(.lines):not(.leaders)')) inner.insertAdjacentHTML('afterbegin', mapSvg);
    sizeMapBox(wrap);
    if (wrap.dataset.ready) return;
    wrap.dataset.ready = '1';
    wrap.dataset.zoom = String(minZoom());
    enableMouseDrag(box);
    // Ao arrastar o mapa, a parte à vista muda: volta a arrumar as etiquetas junto às bordas.
    let relayoutFrame = 0;
    box.addEventListener('scroll', () => {
      if (!wrap.relayout || relayoutFrame) return;
      relayoutFrame = requestAnimationFrame(() => { relayoutFrame = 0; wrap.relayout(); });
    }, { passive: true });
    wrap.querySelectorAll('[data-zoom]').forEach((btn) => {
      // O botão não fica com o foco (no Safari do iPhone, um botão focado podia fazer a página
      // saltar quando o mapa muda de tamanho por dentro).
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        const current = Number(wrap.dataset.zoom);
        // (O enquadramento automático pode ter afastado abaixo do mínimo, para caber tudo.)
        const level = Math.min(ZOOMS.length - 1, Math.max(Math.min(minZoom(), current), current + Number(btn.dataset.zoom)));
        // Mantém o centro da vista ao aproximar ou afastar.
        const cx = (box.scrollLeft + box.clientWidth / 2) / inner.offsetWidth;
        const cy = (box.scrollTop + box.clientHeight / 2) / inner.offsetHeight;
        // Os botões do mapa nunca mexem no scroll da página: fica exatamente onde estava.
        const pageY = window.scrollY;
        const keep = () => { if (window.scrollY !== pageY) window.scrollTo(window.scrollX, pageY); };
        setZoom(wrap, level, cx, cy);
        keep();
        requestAnimationFrame(() => { keep(); requestAnimationFrame(keep); });
      });
    });
  }

  // Revelação: enquadra a zona com todos os palpites e o país certo, com alguma margem,
  // escolhendo o maior zoom em que tudo cabe na vista.
  function frame(wrap, points) {
    const box = wrap.querySelector('.map-box');
    const inner = wrap.querySelector('.map-inner');
    const ps = points.map(toPercent);
    const minX = Math.min(...ps.map((p) => p.x));
    const maxX = Math.max(...ps.map((p) => p.x));
    const minY = Math.min(...ps.map((p) => p.y));
    const maxY = Math.max(...ps.map((p) => p.y));
    // Folga mínima, para um só ponto (ou pontos muito juntos) não dar um zoom exagerado.
    const spanX = Math.max(maxX - minX, 8) * 1.3;
    const spanY = Math.max(maxY - minY, 14) * 1.3;
    sizeMapBox(wrap);
    // O maior zoom em que cabem todos os pontos (os palpites e o país certo). Se nem no zoom
    // mínimo do telemóvel couberem (ex.: palpites dos dois lados do mundo), mostra o mapa
    // inteiro: nunca fica nenhum ponto fora da vista.
    const fits = (z) => {
      const w = box.clientWidth * ZOOMS[z];
      const h = w * MAP_RATIO;
      return (spanX / 100) * w <= box.clientWidth && (spanY / 100) * h <= Math.max(box.clientHeight, 1);
    };
    let level = 0;
    for (let z = ZOOMS.length - 1; z >= 0; z--) {
      if (fits(z)) { level = z; break; }
    }
    setZoom(wrap, level, (minX + maxX) / 200, (minY + maxY) / 200);
    return inner.offsetWidth > 0;
  }

  // Etiquetas dos pinos no mapa (deteção de colisões): cada etiqueta experimenta ficar por
  // cima do pino, por baixo, um pouco para cada lado e depois cada vez mais afastada (uma fila
  // de cada vez), e fica no sítio menos mau. Nunca tapa o país certo (nem o anel à volta dele)
  // se houver outro sítio, e evita as outras etiquetas, os pinos e as bordas do mapa. Quando
  // fica afastada, uma linha fina liga-a ao seu pino. A lista por baixo do mapa garante que
  // nada fica ilegível.
  function layoutLabels(wrap) {
    // Limites: a parte À VISTA (com zoom, o mapa inteiro vai muito além do ecrã e uma etiqueta
    // "dentro do mapa" podia estar cortada pela borda do contentor). Com o mundo inteiro no
    // telemóvel, o mapa é mais baixo do que a vista: as etiquetas também podem usar o mar livre
    // por baixo dele.
    const view = wrap.querySelector('.map-box').getBoundingClientRect();
    const bounds = { left: view.left + 4, right: view.right - 4, top: view.top + 4, bottom: view.bottom - 4 };
    const pins = [...wrap.querySelectorAll('.pins .pin')].map((p) => p.getBoundingClientRect());
    const labels = [];
    // A resposta certa: o anel à volta do país e o próprio país (se não ocupar quase toda a
    // vista, como um país enorme muito aproximado, ou um país com territórios muito afastados).
    const answer = [];
    const ring = wrap.querySelector('.pins .pin.target');
    if (ring) answer.push(ring.getBoundingClientRect());
    const country = wrap.querySelector('path.target');
    if (country) {
      const b = country.getBoundingClientRect();
      if (b.width < view.width * 0.6 && b.height < view.height * 0.6) answer.push(b);
    }
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const count = (a, list) => list.filter((b) => overlaps(a, b)).length;
    // Quanto pior é uma posição: tapar a resposta certa (muito mau), chocar com outra etiqueta,
    // ficar cortada em cima ou em baixo, tapar um pino e, por fim, ficar longe do seu pino.
    const badness = (a, [, row, shift]) => count(a, answer) * 40 + count(a, labels) * 10
      + (a.top < bounds.top || a.bottom > bounds.bottom ? 6 : 0) + count(a, pins)
      + row * 0.2 + (shift ? 0.1 : 0);
    const ROW = 22; // um pouco mais do que a altura de uma etiqueta
    const leaders = [];
    for (const label of wrap.querySelectorAll('.pins .pin-label')) {
      // Pino fora da parte à vista (com zoom): a etiqueta não aparece (ficava encostada à borda,
      // longe do pino). O palpite continua na lista por baixo do mapa.
      const p = label.parentElement.getBoundingClientRect();
      const px = (p.left + p.right) / 2;
      const py = (p.top + p.bottom) / 2;
      const offView = px < view.left || px > view.right || py < view.top || py > view.bottom;
      label.style.visibility = offView ? 'hidden' : '';
      if (offView) continue;
      // Na horizontal: perto da borda esquerda ou direita, a etiqueta desliza para dentro (a
      // linha até ao pino continua a apontar para ele).
      label.style.setProperty('--dx', '0px');
      label.style.top = 'auto';
      label.style.bottom = '14px';
      const box = label.getBoundingClientRect();
      const side = Math.max(0, box.width / 2 - 14); // desvio para o lado (o pino fica por baixo da etiqueta)
      const dxFor = (shift) => {
        const left = box.left + shift;
        const right = box.right + shift;
        return shift + (left < bounds.left ? bounds.left - left : right > bounds.right ? bounds.right - right : 0);
      };
      const options = [0, 1, 2, 3, 4].flatMap((row) => [0, -side, side].flatMap((shift) => [['above', row, shift], ['below', row, shift]]));
      const apply = ([where, row, shift]) => {
        label.style.top = where === 'below' ? `${14 + row * ROW}px` : 'auto';
        label.style.bottom = where === 'above' ? `${14 + row * ROW}px` : 'auto';
        label.style.setProperty('--dx', `${Math.round(dxFor(shift))}px`);
        label.classList.toggle('lead', row > 0);
        label.classList.toggle('below', where === 'below');
        label.style.setProperty('--lead', `${row * ROW + 7}px`);
      };
      let best = null;
      for (const option of options) {
        apply(option);
        const score = badness(label.getBoundingClientRect(), option);
        if (!best || score < best.score) best = { option, score };
        if (score < 0.05) break;
      }
      apply(best.option);
      // Sem lugar perto do pino (taparia outra etiqueta ou a resposta certa): vai para o lugar
      // livre mais perto, em toda a parte à vista do mapa, ligado ao pino por uma linha fina.
      if (best.score >= 10) {
        const spot = nearestFreeSpot(box.width, box.height, px, py, bounds, (q) => !count(q, labels) && !count(q, answer));
        if (spot) {
          placeAt(label, spot);
          leaders.push({ x1: px, y1: py, ...closestPoint(spot, px, py), color: label.parentElement.style.getPropertyValue('--c') });
        }
      }
      labels.push(label.getBoundingClientRect());
    }
    drawLeaders(wrap, leaders);
  }

  // Lugar livre (sem tapar o que `ok` recusa) mais perto do ponto (px, py), numa grelha de 8 px.
  function nearestFreeSpot(w, h, px, py, bounds, ok) {
    let best = null;
    let bestD = Infinity;
    for (let top = bounds.top; top + h <= bounds.bottom; top += 8) {
      for (let left = bounds.left; left + w <= bounds.right; left += 8) {
        const q = { left, top, right: left + w, bottom: top + h };
        const dx = Math.max(0, q.left - px, px - q.right);
        const dy = Math.max(0, q.top - py, py - q.bottom);
        const d = dx * dx + dy * dy;
        if (d < bestD && ok(q)) { best = q; bestD = d; }
      }
    }
    return best;
  }
  // Põe a etiqueta num sítio qualquer (coordenadas do ecrã), mexendo no desvio e na altura em
  // relação ao seu pino (sem a linha vertical: a ligação é desenhada à parte).
  function placeAt(label, spot) {
    label.classList.remove('lead', 'below');
    label.style.top = 'auto';
    label.style.bottom = '14px';
    label.style.setProperty('--dx', '0px');
    const base = label.getBoundingClientRect();
    label.style.setProperty('--dx', `${Math.round(spot.left - base.left)}px`);
    label.style.bottom = `${Math.round(14 + base.top - spot.top)}px`;
  }
  const closestPoint = (q, px, py) => ({ x2: Math.max(q.left, Math.min(px, q.right)), y2: Math.max(q.top, Math.min(py, q.bottom)) });
  // Linhas finas das etiquetas afastadas até aos seus pinos, num SVG por cima do mapa (em
  // píxeis do mapa, por isso acompanham o zoom e o scroll: são redesenhadas a cada arrumação).
  function drawLeaders(wrap, leaders) {
    const inner = wrap.querySelector('.map-inner');
    let svg = inner.querySelector('svg.leaders');
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'leaders');
      svg.setAttribute('aria-hidden', 'true');
      inner.append(svg);
    }
    const r = inner.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${Math.round(r.width)} ${Math.round(r.height)}`);
    svg.replaceChildren(...leaders.map((d) => {
      const line = document.createElementNS(NS, 'line');
      for (const [k, v] of Object.entries({ x1: d.x1 - r.left, y1: d.y1 - r.top, x2: d.x2 - r.left, y2: d.y2 - r.top })) line.setAttribute(k, v.toFixed(1));
      line.setAttribute('stroke', d.color || '#26262b');
      return line;
    }));
  }

  /**
   * Desenha a revelação de uma pergunta de mapa em `wrap`:
   *   key      identifica a ronda (o enquadramento automático só acontece uma vez por ronda);
   *   ids      os palpites já revelados, pela ordem da revelação;
   *   answers  { id: { lat, lon } }; center = ponto de referência da resposta (o anel);
   *   country  código do país certo (fica pintado);
   *   classOf(id) 'near' | 'far' | ''; labelOf(id) texto da etiqueta; colorOf(id); faceOf(id)
   *   (o mini-retrato, opcional).
   */
  function drawReveal(wrap, { key, ids, answers, center: centerPoint, country, classOf, labelOf, colorOf, faceOf = () => null }) {
    setup(wrap);
    wrap.querySelectorAll('path').forEach((p) => p.classList.toggle('target', p.dataset.c === country));
    const shown = ids.length;
    const fresh = wrap.dataset.round !== String(key) || Number(wrap.dataset.shown || 0) > shown;
    const before = fresh ? 0 : Number(wrap.dataset.shown || 0);
    wrap.dataset.round = String(key);
    wrap.dataset.shown = String(shown);

    const center = centerPoint && toPercent(centerPoint);
    // Linha de cada palpite até à resposta, pelo caminho mais curto: se for mais perto pelo
    // outro lado dos 180° (ex.: um palpite em Tonga para Fiji), a linha sai por uma borda do
    // mapa e volta a entrar pela outra, em vez de o atravessar todo.
    const segment = (a, b, cls) => {
      const line = document.createElementNS(NS, 'line');
      for (const [k, v] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) line.setAttribute(k, v);
      line.setAttribute('class', cls);
      return line;
    };
    wrap.querySelector('.lines').replaceChildren(...(center ? ids.flatMap((id) => {
      const p = toPercent(answers[id]);
      const dx = center.x - p.x;
      if (Math.abs(dx) <= 50) return [segment(p, center, classOf(id))];
      const shift = dx > 0 ? -100 : 100; // a resposta "do outro lado" do mapa
      return [segment(p, { x: center.x + shift, y: center.y }, classOf(id)), segment({ x: p.x - shift, y: p.y }, center, classOf(id))];
    }) : []));
    wrap.querySelector('.pins').replaceChildren(
      center ? pin(centerPoint, 'target') : null,
      // A etiqueta leva o retrato e uma borda na cor do jogador: lê-se a quem pertence mesmo
      // quando fica afastada do pino.
      ...ids.map((id, i) => pin(answers[id], `${classOf(id)} ${i >= before ? 'appear' : ''}`, labelOf(id), colorOf(id), faceOf(id))),
    );
    wrap.relayout = () => layoutLabels(wrap);

    // Enquadra uma vez por ronda, logo no início, com todos os palpites e o país certo
    // (depois o jogador pode mexer no zoom à vontade).
    if (wrap.dataset.framed !== String(key) && mapSvg) {
      const points = Object.values(answers).concat(centerPoint ? [centerPoint] : []);
      if (points.length && frame(wrap, points)) wrap.dataset.framed = String(key);
    }
    wrap.relayout();
    // Os pinos novos aparecem a crescer (e as etiquetas com eles): no fim da animação, as
    // etiquetas já têm o tamanho final e são arrumadas outra vez (senão podiam ficar sobrepostas).
    const growing = wrap.querySelector('.pins .pin.appear');
    if (growing) growing.addEventListener('animationend', () => { if (wrap.relayout) wrap.relayout(); }, { once: true });
  }

  root.MapView = { MAP_TOP, MAP_BOTTOM, ZOOMS, load, loaded, toPercent, pointAt, pin, setZoom, minZoom, sizeMapBox, setup, frame, drawReveal };
})(window);
