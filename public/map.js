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
  // A área do próprio mapa dentro de ".map-inner" (sem a margem de mar da revelação): é a
  // mesma da camada dos pinos.
  const mapRect = (inner) => inner.querySelector('.pins').getBoundingClientRect();
  // Ponto do mapa onde se tocou (para escolher o palpite).
  function pointAt(event, inner) {
    const rect = mapRect(inner);
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

  // Margem de mar à volta do mapa da revelação, em píxeis: 10% da vista de cada lado, mais o
  // raio do anel da resposta (que tem tamanho fixo). Assim, um ponto encostado à ponta do mapa
  // (ex.: Fiji, a 178°) ou ao topo pode ficar afastado das bordas da vista como os outros.
  // O mapa onde se responde não tem margem.
  const RING = 17;
  const margins = (box) => ({ x: Math.round(box.clientWidth * 0.1 + RING), y: Math.round(box.clientHeight * 0.1 + RING) });
  const padOf = (wrap) => (wrap.dataset.reveal ? margins(wrap.querySelector('.map-box')) : { x: 0, y: 0 });

  // Muda a escala (largura do mapa / largura da vista; 1 = o mundo inteiro à largura da vista)
  // e põe o ponto (cx, cy), em frações do mapa, no centro da vista.
  function setScale(wrap, scale, cx, cy) {
    const box = wrap.querySelector('.map-box');
    const inner = wrap.querySelector('.map-inner');
    const pad = padOf(wrap);
    wrap.dataset.scale = String(scale);
    // (Nível dos botões: o maior zoom "redondo" que não passa desta escala.)
    wrap.dataset.zoom = String(ZOOMS.reduce((best, z, i) => (z <= scale + 1e-6 ? i : best), 0));
    inner.style.setProperty('--px', `${pad.x}px`);
    inner.style.setProperty('--py', `${pad.y}px`);
    inner.style.width = `calc(${scale * 100}% + ${2 * pad.x}px)`;
    const map = mapRect(inner);
    box.scrollLeft = pad.x + cx * map.width - box.clientWidth / 2;
    box.scrollTop = pad.y + cy * map.height - box.clientHeight / 2;
    if (wrap.relayout) wrap.relayout(); // com outro zoom, as etiquetas chocam de outra maneira
  }
  // Muda o zoom para um dos níveis dos botões (ZOOMS).
  const setZoom = (wrap, level, cx, cy) => setScale(wrap, ZOOMS[level], cx, cy);

  // A escala em que o mundo inteiro cabe na vista (com a margem de mar, na revelação).
  function wholeScale(wrap) {
    const box = wrap.querySelector('.map-box');
    const pad = padOf(wrap);
    const w = box.clientWidth;
    const h = Math.max(box.clientHeight, 1);
    return Math.min(1, (w - 2 * pad.x) / w, (h - 2 * pad.y) / (w * MAP_RATIO));
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
    // A margem de mar depende do tamanho da vista: acerta-a (mantendo a escala).
    const inner = wrap.querySelector('.map-inner');
    if (wrap.dataset.scale) {
      const pad = padOf(wrap);
      inner.style.setProperty('--px', `${pad.x}px`);
      inner.style.setProperty('--py', `${pad.y}px`);
      inner.style.width = `calc(${Number(wrap.dataset.scale) * 100}% + ${2 * pad.x}px)`;
    }
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
        const current = Number(wrap.dataset.scale || ZOOMS[minZoom()]);
        // Escalas possíveis: os níveis redondos e, na revelação, o mundo inteiro com margem. Não
        // se afasta abaixo do mínimo (a não ser que o enquadramento automático já tenha afastado
        // mais, para caber tudo).
        const whole = wholeScale(wrap);
        const floor = wrap.dataset.reveal ? whole : Math.min(ZOOMS[minZoom()], current);
        const steps = ZOOMS.concat(wrap.dataset.reveal ? [whole] : []).filter((z) => z >= floor - 1e-6).sort((a, b) => a - b);
        const up = Number(btn.dataset.zoom) > 0;
        const next = up ? steps.find((z) => z > current + 1e-3) : steps.filter((z) => z < current - 1e-3).pop();
        if (next === undefined) return;
        // Mantém o centro da vista ao aproximar ou afastar.
        const map = mapRect(inner);
        const view = viewRect(box);
        const cx = ((view.left + view.right) / 2 - map.left) / map.width;
        const cy = ((view.top + view.bottom) / 2 - map.top) / map.height;
        // Os botões do mapa nunca mexem no scroll da página: fica exatamente onde estava.
        const pageY = window.scrollY;
        const keep = () => { if (window.scrollY !== pageY) window.scrollTo(window.scrollX, pageY); };
        setScale(wrap, next, cx, cy);
        keep();
        requestAnimationFrame(() => { keep(); requestAnimationFrame(keep); });
      });
    });
  }

  // A parte à vista do mapa, no ecrã (sem a moldura de madeira do contentor).
  function viewRect(box) {
    const r = box.getBoundingClientRect();
    const left = r.left + box.clientLeft;
    const top = r.top + box.clientTop;
    return { left, top, right: left + box.clientWidth, bottom: top + box.clientHeight, width: box.clientWidth, height: box.clientHeight };
  }

  // Revelação: enquadra a zona com todos os palpites e o país certo, com uma margem interior
  // à volta (10% da vista de cada lado, mais o raio do anel da resposta, para nada ficar
  // encostado ou cortado nas bordas), escolhendo o maior zoom em que tudo cabe assim.
  function frame(wrap, points) {
    const box = wrap.querySelector('.map-box');
    const inner = wrap.querySelector('.map-inner');
    const ps = points.map(toPercent);
    const minX = Math.min(...ps.map((p) => p.x)) / 100;
    const maxX = Math.max(...ps.map((p) => p.x)) / 100;
    const minY = Math.min(...ps.map((p) => p.y)) / 100;
    const maxY = Math.max(...ps.map((p) => p.y)) / 100;
    sizeMapBox(wrap);
    const w = box.clientWidth;
    const h = Math.max(box.clientHeight, 1);
    const m = margins(box);
    // Folga mínima, para um só ponto (ou pontos muito juntos) não dar um zoom exagerado.
    const spanX = Math.max(maxX - minX, 0.06);
    const spanY = Math.max(maxY - minY, 0.1);
    // Se os pontos estiverem dos dois lados do mundo, a escala desce até ao mundo inteiro (com a
    // margem de mar): nunca fica nenhum ponto fora da vista.
    const scale = Math.max(wholeScale(wrap), Math.min(ZOOMS[ZOOMS.length - 1],
      (w - 2 * m.x) / (w * spanX), (h - 2 * m.y) / (w * MAP_RATIO * spanY)));
    setScale(wrap, scale, (minX + maxX) / 2, (minY + maxY) / 2);
    showWhole(box, wrap.querySelector('.pins .pin.target'));
    return inner.offsetWidth > 0;
  }

  // Garante que o elemento (o anel da resposta certa) fica por inteiro à vista, com folga:
  // se for preciso, arrasta a vista o mínimo possível.
  function showWhole(box, node) {
    if (!node) return;
    const view = viewRect(box);
    const r = node.getBoundingClientRect();
    const gap = 6;
    const dx = r.left - gap < view.left ? r.left - gap - view.left : r.right + gap > view.right ? r.right + gap - view.right : 0;
    const dy = r.top - gap < view.top ? r.top - gap - view.top : r.bottom + gap > view.bottom ? r.bottom + gap - view.bottom : 0;
    if (dx) box.scrollLeft += dx;
    if (dy) box.scrollTop += dy;
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
    const view = viewRect(wrap.querySelector('.map-box'));
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
    // Quanto pior é uma posição: tapar a resposta certa (muito mau), ficar cortada por uma borda
    // da vista, chocar com outra etiqueta, tapar um pino e, por fim, ficar longe do seu pino.
    const cut = (a) => a.left < bounds.left - 0.5 || a.right > bounds.right + 0.5 || a.top < bounds.top - 0.5 || a.bottom > bounds.bottom + 0.5;
    const badness = (a, [, row, shift]) => count(a, answer) * 40 + (cut(a) ? 25 : 0) + count(a, labels) * 10
      + count(a, pins) + row * 0.2 + (shift ? 0.1 : 0);
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
      // Perto de uma borda, a etiqueta vira-se primeiro para dentro do mapa: para baixo quando
      // o pino está em cima, para a esquerda quando está à direita, etc.
      const near = 3 * ROW;
      const vertical = py - bounds.top < near ? ['below', 'above'] : ['above', 'below'];
      const shifts = bounds.right - px < near + side ? [-side, 0, side] : px - bounds.left < near + side ? [side, 0, -side] : [0, -side, side];
      const options = [0, 1, 2, 3, 4].flatMap((row) => shifts.flatMap((shift) => vertical.map((where) => [where, row, shift])));
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
      const color = label.parentElement.style.getPropertyValue('--c');
      // Sem lugar perto do pino (taparia outra etiqueta ou a resposta certa, ou ficava cortada):
      // vai para o lugar livre mais perto, em toda a parte à vista do mapa, ligado ao pino por
      // uma linha fina.
      if (best.score >= 10) {
        const spot = nearestFreeSpot(box.width, box.height, px, py, bounds, (q) => !count(q, labels) && !count(q, answer));
        if (spot) {
          placeAt(label, spot);
          leaders.push({ x1: px, y1: py, ...closestPoint(spot, px, py), color });
        }
      } else {
        // Empurrada para o lado por uma borda, a etiqueta pode já não ficar por cima do pino: a
        // linha fina passa a ir do pino até ao canto mais perto da etiqueta.
        const r = label.getBoundingClientRect();
        if (px < r.left + 4 || px > r.right - 4) {
          label.classList.remove('lead');
          leaders.push({ x1: px, y1: py, ...closestPoint(r, px, py), color });
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
    const r = mapRect(inner); // a camada das linhas cobre o mapa, tal como a dos pinos
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
    wrap.dataset.reveal = '1'; // com margem de mar à volta do mapa
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

  root.MapView = { MAP_TOP, MAP_BOTTOM, ZOOMS, load, loaded, toPercent, pointAt, pin, setZoom, setScale, minZoom, sizeMapBox, setup, frame, drawReveal };
})(window);
