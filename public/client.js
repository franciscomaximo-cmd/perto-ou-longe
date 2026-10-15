'use strict';

(() => {
  const socket = io();
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const SESSION_KEY = 'pertoOuLonge.session';
  const NAME_KEY = 'pertoOuLonge.name';
  const SOUND_KEY = 'pertoOuLonge.sound';
  const CHAR_KEY = 'pertoOuLonge.character'; // boneco escolhido (para o jogo seguinte)
  const numberFormat = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 3 });
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Utilitários --------------------------------------------------------

  // O nome e o som ficam no localStorage (comuns a todos os separadores); a sessão fica no
  // sessionStorage, para cada separador ser um jogador diferente. Recarregar a página no
  // mesmo separador mantém a sessão, por isso volta-se à sala na mesma.
  function load(key, storage = localStorage) {
    try { return JSON.parse(storage.getItem(key)); } catch { return null; }
  }
  function store(key, value, storage = localStorage) {
    try {
      if (value == null) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    } catch { /* modo privado: segue sem guardar */ }
  }
  function saveSession(value) {
    session = value;
    store(SESSION_KEY, value, sessionStorage);
  }
  // Versões antigas guardavam a sessão no localStorage, partilhada entre separadores.
  store(SESSION_KEY, null);

  let state = null; // último estado recebido do servidor
  let session = load(SESSION_KEY, sessionStorage); // { code, playerId, name } para voltar à sala
  let deadline = null;
  let lastRound = null;
  let lastView = null;
  let selectedVote = null;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  let toastTimer = null;
  function toast(message) {
    const t = $('#toast');
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  const fmt = (n) => numberFormat.format(n);
  const withUnit = (n, unit) => (unit ? `${fmt(n)} ${unit}` : fmt(n));
  const formatTime = (s) => (s > 0 ? `${s} s` : 'Sem limite');

  // Leitura de números à portuguesa: ver public/numero.js.
  const { parseNumber } = window;

  const player = (id) => (state && state.players.find((p) => p.id === id)) || null;
  const nameOf = (id) => (player(id) ? player(id).name : '?');
  const colorOf = (id) => (player(id) ? player(id).color : 'var(--muted)');
  // Avatar de um jogador (o mesmo em todo o lado): emoji grande num círculo com gradiente da
  // sua cor, borda branca fina e sombra. "Tu" tem um anel brilhante, o anfitrião uma coroa e
  // quem está desligado fica a cinzento. Tamanhos: 's' (~26 px, dentro de etiquetas),
  // 'm' (~40 px, listas) e 'l' (~56 px, alvo e ecrã final).
  // (O desenho está em public/reveal/index.js, partilhado com os temas de revelação.)
  function avatar(p, size = 'm') {
    return window.RevealThemes.kit.avatar(p, size, {
      me: p.id === state.me,
      host: p.id === state.hostId,
      off: p.connected === false,
    });
  }
  // [avatar, nome] para pôr em listas.
  const who = (id, size = 'm') => {
    const p = player(id);
    return p ? [avatar(p, size), el('span', { class: 'nm', text: p.name })] : ['?'];
  };
  const isHost = () => state && state.hostId === state.me;

  // Envia uma ação e mostra o erro, se houver.
  // Se o servidor não responder em 10 s (ex.: está a acordar ou caiu), mostra um erro em vez
  // de ficar à espera em silêncio.
  function act(event, payload = {}, onOk) {
    if (!socket.connected) return toast('Sem ligação ao servidor. Espera um pouco e tenta outra vez.');
    socket.timeout(10000).emit(event, payload, (err, res) => {
      if (err) toast('O servidor não respondeu. Tenta outra vez.');
      else if (!res || !res.ok) toast((res && res.error) || 'Sem resposta do servidor.');
      else if (onOk) onOk(res);
    });
  }

  // Faixa "A ligar ao servidor…" enquanto não houver ligação (só aparece se demorar mais de
  // meio segundo, para não piscar ao abrir a página). No Render gratuito o servidor pode
  // demorar até um minuto a acordar.
  let offlineTimer = null;
  function renderConnection() {
    const online = socket.connected;
    clearTimeout(offlineTimer);
    if (online) $('#offline').hidden = true;
    else offlineTimer = setTimeout(() => { $('#offline').hidden = socket.connected; }, 500);
    for (const sel of ['#btn-create', '#btn-join']) $(sel).disabled = !online;
  }

  // --- Entrar / sair ------------------------------------------------------

  function enterRoom(res) {
    saveSession({ code: res.code, playerId: res.playerId, name: res.name });
    store(NAME_KEY, res.name);
    history.replaceState(null, '', location.pathname);
    // Volta a vestir o boneco guardado. A meio de um jogo o servidor recusa (só na sala de
    // espera se muda o boneco): aí ignora-se a resposta, sem aviso.
    const saved = window.CharacterOptions.cleanCharacter(load(CHAR_KEY));
    if (saved) socket.emit('player:character', saved, () => {});
  }

  function rejoin() {
    if (!session) return;
    socket.emit('room:join', session, (res) => {
      if (res && res.ok) {
        enterRoom(res);
      } else {
        saveSession(null);
        state = null;
        render();
        if (res && res.error) toast('Já não foi possível voltar à sala.');
      }
    });
  }

  $('#btn-create').addEventListener('click', () => {
    act('room:create', { name: $('#home-name').value }, enterRoom);
  });

  function join() {
    const code = $('#home-code').value.trim().toUpperCase();
    if (code.length !== 4) return toast('O código tem 4 letras.');
    act('room:join', { code, name: $('#home-name').value }, enterRoom);
  }
  $('#btn-join').addEventListener('click', join);
  $('#home-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

  $$('.btn-leave').forEach((btn) => btn.addEventListener('click', () => {
    if (state && state.phase !== 'lobby' && state.phase !== 'end' && !confirm('Sair a meio do jogo?')) return;
    socket.emit('room:leave', {}, () => {});
    saveSession(null);
    state = null;
    render();
  }));

  $('#btn-share').addEventListener('click', async () => {
    const url = inviteUrl();
    const text = `Junta-te ao Perto ou Longe! Código da sala: ${state.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Perto ou Longe', text, url });
      else { await navigator.clipboard.writeText(url); toast('Ligação copiada.'); }
    } catch { /* partilha cancelada */ }
  });

  // --- Configuração da sala (só o anfitrião mexe) --------------------------

  const SETTINGS = [
    { input: '#set-rounds', out: '#out-rounds', key: 'rounds', format: (n) => String(n) },
    { input: '#set-answer', out: '#out-answer', key: 'answerTime', format: formatTime },
    { input: '#set-vote', out: '#out-vote', key: 'voteTime', format: formatTime },
  ];

  for (const s of SETTINGS) {
    const input = $(s.input);
    input.addEventListener('input', () => { $(s.out).textContent = s.format(Number(input.value)); });
    input.addEventListener('change', () => {
      act('settings:update', Object.fromEntries(SETTINGS.map((x) => [x.key, Number($(x.input).value)])));
    });
  }

  $('#set-custom').addEventListener('change', (e) => act('settings:update', { playerQuestions: e.target.checked }));

  // Como nos palpites: mostra como o número vai ser lido, ou o erro por baixo do campo.
  function checkCustomAnswer(showError) {
    const raw = $('#custom-answer').value;
    const n = parseNumber(raw);
    $('#custom-preview').textContent = n === null || !raw.trim() ? '' : `Resposta: ${fmt(n)}`;
    $('#custom-error').textContent = n === null && (showError || raw.trim()) ? 'A resposta tem de ser um número.' : '';
    return n;
  }
  $('#custom-answer').addEventListener('input', () => checkCustomAnswer(false));

  $('#custom-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const answer = checkCustomAnswer(true);
    if (answer === null) return $('#custom-answer').focus();
    act('question:submit', {
      text: $('#custom-text').value,
      answer,
      unit: $('#custom-unit').value,
    }, () => toast('Pergunta guardada.'));
  });

  $('#btn-start').addEventListener('click', () => act('game:start'));
  // Avançar e saltar levam a fase e a pergunta que o anfitrião está a ver: se entretanto
  // mudaram, o servidor ignora o pedido (não salta uma fase sem querer).
  const seen = () => ({ phase: state.phase, round: state.round, tb: state.tiebreak ? state.tiebreak.number : null });
  $$('.btn-force').forEach((btn) => btn.addEventListener('click', () => act('round:force', seen())));
  $('#btn-next').addEventListener('click', () => act('round:next', seen()));
  $('#btn-step').addEventListener('click', () => act('reveal:skip', seen()));
  $('#btn-tb-next').addEventListener('click', () => act('round:next', seen()));
  $('#btn-again').addEventListener('click', () => act('game:lobby'));

  // --- Responder e votar --------------------------------------------------

  $('#ans-input').addEventListener('input', () => {
    const raw = $('#ans-input').value;
    const n = parseNumber(raw);
    $('#ans-preview').textContent = !raw.trim() ? '' : n === null ? 'Isso não parece um número.' : `Vais responder: ${fmt(n)}`;
  });

  $('#ans-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = parseNumber($('#ans-input').value);
    if (value === null) return toast('Escreve um número.');
    $('#ans-input').blur();
    act('answer:submit', { value });
  });

  $('#btn-vote').addEventListener('click', () => {
    if (selectedVote) act('vote:submit', { targetId: selectedVote });
  });

  // --- Mapa ---------------------------------------------------------------
  // O recorte tem de bater certo com scripts/gerar-mapa.js (projeção equirretangular).
  const MAP_TOP = 84;
  const MAP_BOTTOM = -58;
  const ZOOMS = [1, 2, 4, 8];
  let mapSvg = '';
  let mapPick = null; // ponto escolhido e ainda não enviado

  fetch('mapa.svg')
    .then((r) => r.text())
    .then((svg) => { mapSvg = svg; render(); })
    .catch(() => toast('Não foi possível carregar o mapa.'));

  const toPercent = ({ lat, lon }) => ({
    x: ((lon + 180) / 360) * 100,
    y: ((MAP_TOP - lat) / (MAP_TOP - MAP_BOTTOM)) * 100,
  });

  function pin(point, cls = '', label = '', color = null) {
    const { x, y } = toPercent(point);
    return el('span', { class: `pin ${cls}`, style: `left:${x}%;top:${y}%${color ? `;--c:${color}` : ''}` },
      label ? el('span', { class: 'pin-label', text: label }) : null);
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
  const MAP_RATIO = (MAP_TOP - MAP_BOTTOM) / 360; // altura / largura do mapa

  // O contentor do mapa tem tamanho FIXO: largura total e altura até 45% do ecrã (nunca maior
  // do que o mapa no zoom mínimo, para não sobrar mar). O zoom acontece só lá dentro, sem
  // fazer crescer a página.
  function sizeMapBox(wrap) {
    const box = wrap.querySelector('.map-box');
    if (!box.clientWidth) return;
    const full = box.clientWidth * ZOOMS[minZoom()] * MAP_RATIO;
    box.style.height = `${Math.round(Math.min(window.innerHeight * 0.45, full))}px`;
  }
  window.addEventListener('resize', () => $$('.map-wrap').forEach(sizeMapBox));

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
  function setupMap(wrap) {
    const box = wrap.querySelector('.map-box');
    const inner = wrap.querySelector('.map-inner');
    // (O mapa da revelação também tem um <svg class="lines"> por cima, para as linhas.)
    if (mapSvg && !inner.querySelector('svg:not(.lines)')) inner.insertAdjacentHTML('afterbegin', mapSvg);
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
    wrap.querySelectorAll('[data-zoom]').forEach((btn) => btn.addEventListener('click', () => {
      const level = Math.min(ZOOMS.length - 1, Math.max(minZoom(), Number(wrap.dataset.zoom) + Number(btn.dataset.zoom)));
      // Mantém o centro da vista ao aproximar ou afastar.
      const cx = (box.scrollLeft + box.clientWidth / 2) / inner.offsetWidth;
      const cy = (box.scrollTop + box.clientHeight / 2) / inner.offsetHeight;
      setZoom(wrap, level, cx, cy);
    }));
  }

  // Cada pergunta de mapa começa no zoom mínimo (2× no telemóvel), centrada no meio do mapa;
  // o jogador arrasta para os lados para procurar.
  function resetAnswerMap(wrap) {
    if (wrap.dataset.round === lastRound) return;
    const inner = wrap.querySelector('.map-inner');
    if (!inner.querySelector('svg:not(.lines)') || !inner.offsetWidth) return; // ainda sem mapa ou escondido
    wrap.dataset.round = lastRound;
    setZoom(wrap, minZoom(), 0.5, 0.45);
  }

  // Revelação: enquadra a zona com todos os palpites e o país certo, com alguma margem,
  // escolhendo o maior zoom em que tudo cabe na vista.
  function frameMap(wrap, points) {
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
    let level = minZoom();
    for (let z = ZOOMS.length - 1; z > minZoom(); z--) {
      const w = box.clientWidth * ZOOMS[z];
      const h = w * MAP_RATIO;
      if ((spanX / 100) * w <= box.clientWidth && (spanY / 100) * h <= box.clientHeight) { level = z; break; }
    }
    setZoom(wrap, level, (minX + maxX) / 200, (minY + maxY) / 200);
    return inner.offsetWidth > 0;
  }

  $('#ans-map .map-inner').addEventListener('click', (e) => {
    if (!state || state.myAnswer !== null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    mapPick = { lon: fx * 360 - 180, lat: MAP_TOP - fy * (MAP_TOP - MAP_BOTTOM) };
    renderAnswer();
  });

  $('#btn-map-answer').addEventListener('click', () => {
    if (mapPick) act('answer:submit', { value: mapPick });
  });

  // --- Ligação ------------------------------------------------------------

  // 'connect' também cobre reconexões depois de o telemóvel bloquear.
  socket.on('connect', () => { renderConnection(); rejoin(); });
  socket.on('disconnect', renderConnection);
  renderConnection();
  socket.on('room:state', (s) => { state = s; render(); });

  // --- Desenho ------------------------------------------------------------

  const SCREENS = {
    home: '#screen-home', lobby: '#screen-lobby', answering: '#screen-answer',
    voting: '#screen-vote', reveal: '#screen-reveal', end: '#screen-end',
    tiebreak: '#screen-answer', 'tiebreak-reveal': '#screen-tiebreak',
  };

  let lastPhase = null;

  // Volta ao topo de forma robusta (sobretudo no Safari do iPhone):
  // - tira o foco do botão ou campo onde se tocou (ex.: "Começar jogo" ou a pergunta escrita
  //   na sala de espera), senão o Safari volta a fazer scroll até ele;
  // - repete depois de o ecrã novo estar desenhado, porque um scrollTo feito no mesmo
  //   instante em que a página encolhe pode ser ignorado.
  function scrollToTop() {
    const active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === 'function') active.blur();
    const go = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };
    go();
    requestAnimationFrame(go);
    setTimeout(go, 150);
  }

  function render() {
    const phase = state ? state.phase : 'home';
    // De volta à sala de espera depois de um jogo: a pergunta antiga já foi usada.
    if (phase === 'lobby' && lastPhase && lastPhase !== 'lobby') {
      for (const sel of ['#custom-text', '#custom-answer', '#custom-unit']) $(sel).value = '';
      $('#custom-preview').textContent = '';
      $('#custom-error').textContent = '';
      // As marcas "já feito nesta pergunta" (zoom do mapa, contador, animações) usam o número
      // da pergunta: no jogo seguinte a pergunta 1 é outra, por isso começam do zero.
      for (const sel of ['#ans-map', '#rev-map', '#rev-answer', '#rev-list', '#rev-scores']) {
        const node = $(sel);
        for (const key of ['round', 'framed', 'shown', 'anim']) delete node.dataset[key];
      }
      lastEffect = null;
    }
    // Fora da revelação, o tema da ronda é desmontado (para as animações e os eventos).
    if (phase !== 'reveal') revealCtl.destroy();
    lastPhase = phase;
    for (const sel of new Set(Object.values(SCREENS))) $(sel).hidden = sel !== SCREENS[phase];

    deadline = state && state.remainingMs != null ? Date.now() + state.remainingMs : null;
    renderTopbar();
    tick();

    // Cada pergunta (ronda normal ou desempate) começa com a caixa de resposta limpa.
    const questionKey = state && `${state.round}-${state.tiebreak ? state.tiebreak.number : 0}`;
    if (state && questionKey !== lastRound) {
      lastRound = questionKey;
      $('#ans-input').value = '';
      $('#ans-preview').textContent = '';
      selectedVote = null;
      mapPick = null;
    }
    // Nova fase ou nova pergunta: volta ao topo, para a pergunta não abrir a meio da página.
    const view = `${phase}|${questionKey}`;
    if (view !== lastView) {
      lastView = view;
      scrollToTop();
    }

    if (phase === 'home') renderHome();
    if (phase === 'lobby') renderLobby();
    if (phase === 'answering' || phase === 'tiebreak') renderAnswer();
    if (phase === 'voting') renderVote();
    if (phase === 'reveal') renderReveal();
    if (phase === 'tiebreak-reveal') renderTiebreakReveal();
    if (phase === 'end') renderEnd();

    $$('.btn-force').forEach((b) => { b.hidden = !isHost(); });
  }

  function renderTopbar() {
    const inGame = state && state.phase !== 'lobby';
    $('#topbar').hidden = !state;
    if (!state) return;
    $('#tb-code').textContent = state.code;
    $('#tb-round').textContent = state.phase === 'end' ? 'Fim do jogo'
      : state.tiebreak ? `Desempate${state.tiebreak.number > 1 ? ` ${state.tiebreak.number}` : ''}`
      : inGame && state.round ? `Pergunta ${state.round} de ${state.totalRounds}`
      : 'Sala de espera';
  }

  function tick() {
    const t = $('#tb-timer');
    if (!deadline) { t.hidden = true; return; }
    const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    t.hidden = false;
    t.textContent = `${secs} s`;
    t.classList.toggle('urgent', secs <= 5);
  }
  setInterval(tick, 250);

  function renderHome() {
    const nameInput = $('#home-name');
    if (!nameInput.value) nameInput.value = load(NAME_KEY) || '';
    const fromLink = new URLSearchParams(location.search).get('sala');
    if (fromLink && !$('#home-code').value) $('#home-code').value = fromLink.toUpperCase().slice(0, 4);
  }

  function playerRow(p, extra) {
    const tags = [];
    if (p.id === state.hostId) tags.push('anfitrião');
    if (p.id === state.me) tags.push('tu');
    if (!p.connected) tags.push('desligado');
    return el('li', { class: p.connected ? '' : 'off' }, [
      el('span', { class: 'who' }, [avatar(p), p.name, tags.length ? el('span', { class: 'tag', text: tags.join(' · ') }) : null]),
      extra || null,
    ]);
  }

  function renderLobby() {
    const online = state.players.filter((p) => p.connected).length;
    $('#lobby-code').textContent = state.code;
    $('#lobby-count').textContent = `(${state.players.length}/${state.maxPlayers})`;
    const custom = state.settings.playerQuestions;
    $('#lobby-players').replaceChildren(...state.players.map((p) => playerRow(p, custom
      ? el('span', { class: 'state', text: state.customReady.includes(p.id) ? 'pergunta ✓' : 'a escrever…' })
      : null)));

    renderEmojiPicker();
    renderCharacterEditor();
    renderQr();

    const host = isHost();
    $('#set-custom').checked = custom;
    $('#set-custom').disabled = !host;
    renderCustomForm(custom);
    $('#set-rounds').min = state.minRounds;
    $('#set-rounds').max = state.maxRounds;
    for (const s of SETTINGS) {
      const input = $(s.input);
      input.disabled = !host;
      // Não mexe no regulador enquanto o anfitrião o está a arrastar.
      if (document.activeElement !== input) {
        // O número de perguntas nunca fica abaixo do mínimo (que sobe com as perguntas dos jogadores).
        const value = s.key === 'rounds' ? Math.max(state.settings.rounds, state.minRounds) : state.settings[s.key];
        input.value = value;
        $(s.out).textContent = s.format(value);
      }
    }
    const raised = state.settings.playerQuestions && state.customNeeded >= 3;
    $('#rounds-note').hidden = !raised;
    if (raised) {
      $('#rounds-note').textContent = `O jogo terá pelo menos ${state.customNeeded} perguntas para incluir as de todos.`;
    }
    $('#settings-hint').textContent = host
      ? 'Nos tempos, arrasta até ao início para jogar sem limite.'
      : 'Só o anfitrião pode mudar a configuração.';
    renderCategories(host);

    const missing = state.minPlayers - online;
    const noQuestion = custom
      ? state.players.filter((p) => p.connected && !state.customReady.includes(p.id)).map((p) => p.name)
      : [];
    $('#btn-start').hidden = !host;
    $('#btn-start').disabled = missing > 0 || noQuestion.length > 0;
    $('#btn-start').textContent = 'Começar jogo';
    $('#lobby-hint').textContent = missing > 0
      ? `${missing === 1 ? 'Falta 1 jogador' : `Faltam ${missing} jogadores`} para começar (mínimo ${state.minPlayers}).`
      : noQuestion.length ? `Falta a pergunta de: ${noQuestion.join(', ')}.`
      : host ? '' : 'À espera que o anfitrião comece o jogo…';
  }

  // Emojis: o meu fica marcado; os dos outros mostram o mini-avatar de quem o tem e ficam
  // indisponíveis. Ao trocar de emoji, o meu avatar faz um "pop".
  let lastMyEmoji = null;
  function renderEmojiPicker() {
    const me = player(state.me);
    const owners = new Map(state.players.filter((p) => p.id !== state.me).map((p) => [p.emoji, p]));
    $('#emoji-picker').style.setProperty('--c', me ? me.color : 'var(--accent)');
    $('#emoji-picker').replaceChildren(...(state.emojis || []).map((e) => {
      const owner = owners.get(e);
      return el('button', {
        type: 'button',
        class: [me && me.emoji === e ? 'on' : '', owner ? 'taken' : ''].join(' '),
        'aria-label': owner ? `${e} (de ${owner.name})` : `Escolher ${e}`,
        title: owner ? `De ${owner.name}` : '',
        ...(owner ? { disabled: '' } : {}),
        onclick: () => act('player:emoji', { emoji: e }),
      }, owner ? avatar(owner, 's') : el('span', { class: 'emoji', text: e }));
    }));
    if (me && lastMyEmoji && me.emoji !== lastMyEmoji && !reducedMotion()) {
      for (const node of $$(`#screen-lobby .avatar[data-player="${me.id}"], #emoji-picker button.on`)) {
        node.classList.remove('pop');
        void node.offsetWidth;
        node.classList.add('pop');
      }
    }
    lastMyEmoji = me ? me.emoji : null;
  }

  // --- Boneco (sala de espera) -------------------------------------------------------------
  // Roupa, chapéu/acessório e extra. A pré-visualização muda logo ao tocar (sem esperar pelo
  // servidor); as escolhas ficam no localStorage e são reaplicadas ao entrar numa sala.
  const { COLORS: CHAR_COLORS, HATS, EXTRAS, POSES: CHAR_POSES, POSE_LABELS, cleanCharacter, randomCharacter } = window.CharacterOptions;
  let pendingCharacter = null; // escolha enviada e ainda não confirmada pelo servidor
  let previewPose = 0;

  function setCharacter(change) {
    const me = player(state.me);
    if (!me) return;
    const next = cleanCharacter(change, pendingCharacter || me.character);
    if (!next) return;
    pendingCharacter = next;
    store(CHAR_KEY, next);
    renderCharacterEditor();
    act('player:character', next);
  }

  function renderCharacterEditor() {
    const me = player(state.me);
    if (!me) return;
    if (pendingCharacter && JSON.stringify(pendingCharacter) === JSON.stringify(me.character)) pendingCharacter = null;
    const ch = pendingCharacter || me.character;
    const pose = CHAR_POSES[previewPose % CHAR_POSES.length];
    $('#char-preview').replaceChildren(window.drawCharacter({ ...me, character: ch }, pose, { size: 150 }));
    $('#char-pose').textContent = `${POSE_LABELS[pose]} · toca para mudar`;

    // Roupa: a cor do jogador (por omissão) ou outra da paleta.
    const swatch = (value, color, label) => el('button', {
      type: 'button',
      class: `swatch ${(ch.outfit || null) === value ? 'on' : ''}`,
      style: `--c:${color}`,
      'aria-label': label,
      title: label,
      onclick: () => setCharacter({ outfit: value }),
    }, value === null ? el('span', { text: '★', 'aria-hidden': 'true' }) : null);
    $('#char-outfit').replaceChildren(
      swatch(null, me.color, 'A tua cor'),
      ...CHAR_COLORS.filter((c) => c !== me.color).map((c) => swatch(c, c, `Roupa ${c}`)),
    );
    const chips = (sel, list, key) => $(sel).replaceChildren(...list.map((o) => el('button', {
      type: 'button',
      class: ch[key] === o.id ? 'on' : '',
      text: o.label,
      onclick: () => setCharacter({ [key]: o.id }),
    })));
    chips('#char-hat', HATS, 'hat');
    chips('#char-extra', EXTRAS, 'extra');
  }

  $('#char-preview').addEventListener('click', () => {
    previewPose = (previewPose + 1) % CHAR_POSES.length;
    renderCharacterEditor();
  });
  $('#char-random').addEventListener('click', () => setCharacter(randomCharacter()));

  // QR code com o convite (gerado aqui, só quando muda o código da sala).
  const inviteUrl = () => `${location.origin}/?sala=${state.code}`;
  function renderQr() {
    const box = $('#lobby-qr');
    if (box.dataset.code === state.code || typeof window.qrcode !== 'function') return;
    const qr = window.qrcode(0, 'M');
    qr.addData(inviteUrl());
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    box.dataset.code = state.code;
  }

  // Formulário da pergunta de cada jogador. Só preenche os campos com o que está guardado
  // quando estão vazios, para não apagar o que o jogador está a escrever.
  function renderCustomForm(on) {
    $('#custom-form').hidden = !on;
    if (!on) return;
    const mine = state.myQuestion;
    if (mine && !$('#custom-text').value && !$('#custom-answer').value) {
      $('#custom-text').value = mine.text;
      $('#custom-answer').value = fmt(mine.answer);
      $('#custom-unit').value = mine.unit || '';
    }
    $('#custom-status').textContent = mine
      ? `Guardada: "${mine.text}" (${withUnit(mine.answer, mine.unit)}). Podes alterar até o jogo começar.`
      : 'Ainda não guardaste a tua pergunta.';
  }

  // Categorias: "Todas" ou uma seleção (lista vazia no servidor = todas).
  function renderCategories(host) {
    const chosen = state.settings.categories;
    const all = chosen.length === 0;
    const send = (categories) => act('settings:update', { categories });
    const toggle = (id) => {
      const current = all ? [] : chosen;
      const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
      send(next);
    };
    $('#set-cats').replaceChildren(
      el('button', { type: 'button', class: all ? 'on' : '', text: 'Todas', onclick: () => send([]) }),
      ...state.categories.map((c) => el('button', {
        type: 'button',
        class: !all && chosen.includes(c.id) ? 'on' : '',
        onclick: () => toggle(c.id),
      }, [c.label, ' ', el('small', { text: `(${c.count})` })])),
    );
    $$('#set-cats button').forEach((b) => { b.disabled = !host; });

    const short = state.plannedRounds < state.settings.rounds;
    $('#cats-warning').hidden = !short;
    if (short) {
      $('#cats-warning').textContent = `Estas categorias só têm ${state.plannedRounds} perguntas: o jogo vai ter ${state.plannedRounds} em vez de ${state.settings.rounds}.`;
    }
  }

  function progressList(sel, doneIds, onlyIds = null) {
    const rows = state.players
      .filter((p) => !onlyIds || onlyIds.includes(p.id))
      .filter((p) => p.connected || doneIds.includes(p.id))
      .map((p) => {
        const done = doneIds.includes(p.id);
        const row = playerRow(p, el('span', { class: 'state', text: done ? '✓' : '…' }));
        if (done) row.classList.add('done');
        return row;
      });
    $(sel).replaceChildren(...rows);
  }

  function renderAnswer() {
    $('#ans-question').textContent = state.question.text;
    const author = state.question.author;
    $('#ans-cat').textContent = author ? `Pergunta de ${nameOf(author)}` : state.question.category || '';
    const isMap = state.question.type === 'map';
    const tb = state.phase === 'tiebreak' ? state.tiebreak : null;
    const isAuthor = author === state.me;
    const playing = (!tb || tb.ids.includes(state.me)) && !isAuthor;
    $('#ans-author').hidden = !isAuthor;
    const answered = state.myAnswer !== null;
    $('#ans-unit').textContent = isMap
      ? (answered ? 'Palpite enviado. À espera dos outros…' : 'Toca no mapa onde achas que fica.')
      : state.question.unit ? `Resposta em ${state.question.unit}` : '';
    $('#ans-tiebreak').hidden = !tb;
    if (tb) $('#ans-tiebreak').textContent = `Desempate entre ${listNames(tb.ids)}. Só eles respondem, sem votação: quem ficar mais perto fica à frente.`;
    $('#ans-form').hidden = isMap || answered || !playing;
    $('#ans-done').hidden = isMap || !answered;
    $('#ans-watch').hidden = playing || isAuthor;
    $('#ans-map').hidden = !isMap;
    if (isMap) {
      setupMap($('#ans-map'));
      resetAnswerMap($('#ans-map'));
      const point = answered ? state.myAnswer : mapPick;
      $('#ans-map .pins').replaceChildren(...(point ? [pin(point, '', '', colorOf(state.me))] : []));
      $('#btn-map-answer').hidden = answered;
      $('#btn-map-answer').disabled = !mapPick;
      $('#btn-map-answer').textContent = mapPick ? 'Responder' : 'Toca no mapa para escolher';
    } else if (answered) {
      $('#ans-mine').textContent = withUnit(state.myAnswer, state.question.unit);
    }
    const answering = tb ? tb.ids : author ? state.players.map((p) => p.id).filter((id) => id !== author) : null;
    progressList('#ans-progress', state.answered, answering);
  }

  function missText(exact, dist, isMap) {
    if (isMap) return exact ? 'tocou dentro do país' : 'de distância do país';
    return exact ? 'acertou no número' : `falhou por ${fmt(dist)}`;
  }

  const listNames = (ids) => {
    const names = ids.map(nameOf);
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
  };

  function renderVote() {
    $('#vote-question').textContent = state.question.text;
    const candidates = state.candidates || [];
    const status = $('#vote-status');
    const canVote = !state.myVote && candidates.length > 0;

    if (state.myVote) status.textContent = `Votaste em ${nameOf(state.myVote)}. À espera dos outros…`;
    else if (!candidates.length) status.textContent = 'Não há ninguém em quem possas votar nesta ronda.';
    status.hidden = canVote;

    if (!candidates.includes(selectedVote)) selectedVote = null;
    $('#vote-options').hidden = !canVote;
    $('#btn-vote').hidden = !canVote;
    $('#btn-vote').disabled = !selectedVote;
    $('#vote-options').replaceChildren(...candidates.map((id) => el('button', {
      type: 'button',
      class: id === selectedVote ? 'selected' : '',
      onclick: () => { selectedVote = id; renderVote(); },
    }, who(id))));
    progressList('#vote-progress', state.voted);
  }

  // Grupos de jogadores do 1.º lugar para baixo. Depois do jogo vem do servidor
  // (já com os desempates); antes disso agrupa só pelos pontos.
  function standingGroups() {
    if (state.standings) return state.standings.map((ids) => ids.map(player).filter(Boolean));
    const sorted = [...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt'));
    const groups = [];
    for (const p of sorted) {
      const last = groups[groups.length - 1];
      if (last && last[0].score === p.score) last.push(p);
      else groups.push([p]);
    }
    return groups;
  }

  // Posição de cada jogador (empatados partilham a posição) para uns pontos dados.
  function positionsBy(scoreOf) {
    const sorted = [...state.players].sort((a, b) => scoreOf(b) - scoreOf(a) || a.name.localeCompare(b.name, 'pt'));
    const pos = {};
    sorted.forEach((p, i) => {
      pos[p.id] = i > 0 && scoreOf(p) === scoreOf(sorted[i - 1]) ? pos[sorted[i - 1].id] : i + 1;
    });
    return { pos, order: sorted.map((p) => p.id) };
  }

  // Classificação. Com `gained` (pontos desta ronda), mostra quantos lugares cada um subiu
  // ou desceu e, uma vez por `animKey`, faz os jogadores deslizarem da posição antiga.
  function renderScores(sel, { gained = null, animKey = null, size = 'm' } = {}) {
    const groups = standingGroups();
    const top = groups.length ? groups[0][0].score : 0;
    const rows = [];
    let count = 0;
    for (const [g, group] of groups.entries()) {
      const position = count + 1; // empatados partilham a posição
      count += group.length;
      for (const p of group) rows.push({ p, position, first: g === 0 && top > 0 });
    }
    // Sem setas quando antes da ronda estavam todos empatados (ex.: na 1.ª ronda):
    // "desceram" todos do 1.º lugar partilhado, o que não diz nada.
    const prevScores = gained ? state.players.map((p) => p.score - (gained[p.id] || 0)) : [];
    const before = gained && new Set(prevScores).size > 1 ? positionsBy((p) => p.score - (gained[p.id] || 0)) : null;
    const list = $(sel);
    list.replaceChildren(...rows.map(({ p, position, first }) => {
      const classes = [p.id === state.me ? 'me' : '', first ? 'first' : ''].join(' ');
      const moved = before ? before.pos[p.id] - position : 0;
      return el('li', { class: classes, 'data-id': p.id }, [
        el('span', { class: 'pos', text: `${position}.º` }),
        el('span', { class: 'name' }, [
          avatar(p, size),
          p.name,
          // Explica porque está à frente de quem tem os mesmos pontos.
          state.standings && p.id === state.tiebreakWinner ? el('span', { class: 'won-tb', text: '(venceu o desempate)' }) : null,
        ]),
        moved ? el('span', {
          class: `move ${moved > 0 ? 'up' : 'down'}`,
          text: `${moved > 0 ? '↑' : '↓'}${Math.abs(moved)}`,
          'aria-label': `${moved > 0 ? 'subiu' : 'desceu'} ${plural(Math.abs(moved), 'lugar', 'lugares')}`,
        }) : null,
        el('span', { class: 'pts', text: `${p.score} pt${p.score === 1 ? '' : 's'}` }),
      ]);
    }));

    // Deslize (técnica FLIP): cada linha começa onde estava antes desta ronda e vai para o sítio novo.
    if (!before || !animKey || list.dataset.anim === animKey || reducedMotion()) return;
    list.dataset.anim = animKey;
    const items = [...list.children];
    const step = items.length > 1 ? items[1].offsetTop - items[0].offsetTop : 0;
    if (!step) return;
    for (const [i, li] of items.entries()) {
      const from = before.order.indexOf(li.dataset.id);
      li.style.transition = 'none';
      li.style.transform = `translateY(${(from - i) * step}px)`;
    }
    void list.offsetHeight; // aplica a posição inicial antes de animar
    for (const li of items) {
      li.style.transition = 'transform .7s cubic-bezier(.2, .9, .3, 1)';
      li.style.transform = '';
    }
  }

  // --- Revelação em passos -------------------------------------------------
  // O servidor diz em que passo vamos (r.step de r.steps) e avança sozinho; com n palpites:
  // passos 1..n mostram os palpites do mais longe para o mais perto, n+1 a resposta certa e
  // n+2 os pontos, a classificação e os votos.

  // --- Revelação das perguntas de números: tema escolhido pelo servidor ----------------
  // O tema (public/reveal/<id>.js) só desenha; a ordem, o ritmo (passo do servidor), o
  // "Saltar", os sons, o confetti e a lista por baixo são do código comum
  // (public/reveal/index.js e este ficheiro).
  const revealCtl = window.RevealThemes.createController({
    stage: $('#rev-stage'),
    list: $('#rev-guess-list'),
    avatarOf: (id, size) => (player(id) ? avatar(player(id), size) : el('span', { class: `avatar ${size}`, text: '?' })),
  });

  function renderNumbers(r, order, shown, showCorrect) {
    revealCtl.update({
      key: `${state.code}|${state.round}|${state.question.text}`,
      theme: state.question.theme,
      order,
      players: Object.fromEntries(state.players.map((p) => [p.id, { id: p.id, name: p.name, color: p.color, emoji: p.emoji, character: p.character }])),
      answers: r.answers,
      distances: r.distances,
      correct: r.correct,
      unit: state.question.unit,
      shown,
      showCorrect,
      closest: r.closest,
      farthest: r.farthest,
      exact: r.exact,
    });
  }

  // Etiquetas dos pinos no mapa (deteção de colisões): cada etiqueta tenta, por ordem, ficar
  // por cima do pino, por baixo, e depois cada vez mais afastada (uma fila de cada vez), até
  // não tapar nenhuma das já postas nem sair do mapa. Quando fica afastada, uma linha fina
  // liga-a ao seu pino. A lista por baixo do mapa garante que nada fica ilegível.
  function layoutPinLabels(wrap) {
    // Limites: a parte do mapa que está À VISTA (com zoom, o mapa inteiro vai muito além do
    // ecrã e uma etiqueta "dentro do mapa" podia estar cortada pela borda do contentor).
    const inner = wrap.querySelector('.map-inner').getBoundingClientRect();
    const view = wrap.querySelector('.map-box').getBoundingClientRect();
    const bounds = {
      left: Math.max(inner.left, view.left) + 4, right: Math.min(inner.right, view.right) - 4,
      top: Math.max(inner.top, view.top) + 4, bottom: Math.min(inner.bottom, view.bottom) - 4,
    };
    const placed = [...wrap.querySelectorAll('.pins .pin')].map((p) => p.getBoundingClientRect());
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    // Quanto pior é uma posição: choques com etiquetas e pinos e, pior ainda, ficar cortada em
    // cima ou em baixo (perto de uma borda, a etiqueta vira-se para dentro do mapa).
    const badness = (a) => placed.filter((b) => overlaps(a, b)).length
      + (a.top < bounds.top || a.bottom > bounds.bottom ? 3 : 0);
    const ROW = 22; // um pouco mais do que a altura de uma etiqueta
    const options = [0, 1, 2, 3, 4].flatMap((row) => [['above', row], ['below', row]]);
    const apply = ([side, row], label) => {
      label.style.top = side === 'below' ? `${14 + row * ROW}px` : 'auto';
      label.style.bottom = side === 'above' ? `${14 + row * ROW}px` : 'auto';
      label.classList.toggle('lead', row > 0);
      label.classList.toggle('below', side === 'below');
      label.style.setProperty('--lead', `${row * ROW + 7}px`);
    };
    for (const label of wrap.querySelectorAll('.pins .pin-label')) {
      // Primeiro, na horizontal: perto da borda esquerda ou direita, a etiqueta desliza para
      // dentro (a linha até ao pino continua a apontar para ele).
      label.style.setProperty('--dx', '0px');
      const box = label.getBoundingClientRect();
      const dx = box.left < bounds.left ? bounds.left - box.left
        : box.right > bounds.right ? bounds.right - box.right : 0;
      label.style.setProperty('--dx', `${Math.round(dx)}px`);

      let best = null;
      for (const option of options) {
        apply(option, label);
        const score = badness(label.getBoundingClientRect());
        if (!best || score < best.score) best = { option, score };
        if (score === 0) break;
      }
      apply(best.option, label);
      placed.push(label.getBoundingClientRect());
    }
  }

  function renderMapReveal(r, order, shown, showCorrect) {
    const wrap = $('#rev-map');
    setupMap(wrap);
    $$('#rev-map path').forEach((p) => p.classList.toggle('target', p.dataset.c === r.country));
    const fresh = wrap.dataset.round !== String(state.round) || Number(wrap.dataset.shown || 0) > shown;
    const before = fresh ? 0 : Number(wrap.dataset.shown || 0);
    wrap.dataset.round = String(state.round);
    wrap.dataset.shown = String(shown);

    const ids = order.slice(0, shown);
    const clsOf = (id) => (showCorrect && r.closest.includes(id) ? 'near' : showCorrect && r.farthest.includes(id) ? 'far' : '');
    const center = r.center && toPercent(r.center);
    wrap.querySelector('.lines').replaceChildren(...(center ? ids.map((id) => {
      const p = toPercent(r.answers[id]);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      for (const [k, v] of Object.entries({ x1: p.x, y1: p.y, x2: center.x, y2: center.y })) line.setAttribute(k, v);
      line.setAttribute('class', clsOf(id));
      return line;
    }) : []));
    wrap.querySelector('.pins').replaceChildren(
      center ? pin(r.center, 'target') : null,
      // A etiqueta leva o emoji e uma borda na cor do jogador: lê-se a quem pertence mesmo
      // quando fica afastada do pino.
      ...ids.map((id, i) => pin(r.answers[id], `${clsOf(id)} ${i >= before ? 'appear' : ''}`,
        `${player(id) ? player(id).emoji : ''} ${nameOf(id)} · ${fmt(r.distances[id])} km`, colorOf(id))),
    );
    wrap.relayout = () => layoutPinLabels(wrap);

    // Enquadra uma vez por ronda, logo no início, com todos os palpites e o país certo
    // (depois o jogador pode mexer no zoom à vontade).
    if (wrap.dataset.framed !== String(state.round) && mapSvg) {
      const points = Object.values(r.answers).concat(r.center ? [r.center] : []);
      if (points.length && frameMap(wrap, points)) wrap.dataset.framed = String(state.round);
    }
    wrap.relayout();

    // Lista por baixo do mapa, do mais perto para o mais longe: lê-se sempre, mesmo com
    // pinos colados uns aos outros.
    const byDistance = [...ids].sort((a, b) => r.distances[a] - r.distances[b]);
    $('#rev-map-list').replaceChildren(...byDistance.map((id) => el('li', { class: clsOf(id) }, [
      ...who(id),
      el('span', { class: 'km', text: `— ${fmt(r.distances[id])} km` }),
    ])));
  }

  function renderVotes(r) {
    $('#rev-farthest').textContent = r.farthest.length
      ? `Quem ficou mais longe: ${listNames(r.farthest)}.`
      : '';
    const entries = Object.entries(r.votes);
    const hits = r.correctVoters.length;
    $('#rev-votes-summary').textContent = entries.length ? `(${plural(hits, 'acertou', 'acertaram')})` : '';
    $('#rev-votes').replaceChildren(...(entries.length ? entries.map(([voter, target], i) => {
      const hit = r.correctVoters.includes(voter);
      return el('li', { class: `reveal-in ${hit ? 'hit' : ''}`, style: `--i:${i}` }, [
        el('b', { class: 'who' }, who(voter)),
        el('span', { class: 'arrow', text: '→' }),
        el('span', { class: 'who' }, who(target)),
        el('span', { class: 'ok', text: hit ? '✓ acertou' : '' }),
      ]);
    }) : [el('li', { text: 'Ninguém votou nesta ronda.' })]));
  }

  // --- Efeitos: contador, confetti e sons ---------------------------------

  // A resposta certa "rola" do zero até ao valor final (~1 s): ver public/reveal/index.js.
  const countUp = (node, value, unit) => window.RevealThemes.kit.countUp(node, value, unit);

  // Confetti leve, desenhado num <canvas> por cima de tudo durante ~2 s.
  function confetti() {
    if (reducedMotion()) return;
    const canvas = el('canvas', { class: 'confetti', 'aria-hidden': 'true' });
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    const W = (canvas.width = window.innerWidth);
    const H = (canvas.height = window.innerHeight);
    const colors = ['#ffcb47', '#3ddc97', '#f4f1ff', '#4dabf7', '#f783ac', '#9775fa'];
    const parts = Array.from({ length: 90 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.35,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 9 - 4,
      size: 5 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    const start = performance.now();
    const frame = (now) => {
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.25;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (now - start < 2200) requestAnimationFrame(frame);
      else canvas.remove();
    };
    requestAnimationFrame(frame);
  }

  // Sons curtos gerados com a Web Audio API (sem ficheiros). Ligados por defeito; a
  // preferência fica no localStorage. O áudio só arranca depois de um toque no ecrã
  // (regra dos browsers).
  let soundOn = load(SOUND_KEY) !== false;
  let audioCtx = null;
  function audio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function tone(ctx, freq, at, dur, { type = 'sine', gain = 0.12, to = null } = {}) {
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  const SOUNDS = {
    tick: (c) => tone(c, 700, 0, 0.09, { type: 'triangle', gain: 0.07 }),
    reveal: (c) => { tone(c, 523, 0, 0.14); tone(c, 784, 0.12, 0.25); },
    exact: (c) => [523, 659, 784, 1047].forEach((f, i) => tone(c, f, i * 0.09, 0.22, { type: 'triangle', gain: 0.13 })),
    far: (c) => tone(c, 330, 0, 0.55, { type: 'sawtooth', gain: 0.05, to: 110 }),
  };
  function play(name) {
    if (!soundOn) return;
    const c = audio();
    if (!c) return;
    if (c.state === 'running') SOUNDS[name](c);
    else c.resume().then(() => { if (c.state === 'running') SOUNDS[name](c); }).catch(() => {});
  }
  // Desbloqueio do áudio: no telemóvel só contam como gesto do utilizador o fim do toque,
  // o clique e as teclas (não o pointerdown). Tenta em cada gesto até o áudio estar a correr.
  const UNLOCK_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'];
  function unlockAudio() {
    if (!soundOn) return;
    const c = audio();
    if (c && c.state === 'running') UNLOCK_EVENTS.forEach((ev) => document.removeEventListener(ev, unlockAudio, true));
  }
  UNLOCK_EVENTS.forEach((ev) => document.addEventListener(ev, unlockAudio, true));

  function renderSoundButton() {
    const btn = $('#tb-sound');
    btn.textContent = soundOn ? '🔊' : '🔇';
    btn.setAttribute('aria-pressed', String(soundOn));
    btn.setAttribute('aria-label', soundOn ? 'Som ligado' : 'Som desligado');
  }
  $('#tb-sound').addEventListener('click', () => {
    soundOn = !soundOn;
    store(SOUND_KEY, soundOn);
    renderSoundButton();
    if (soundOn) play('tick');
  });
  renderSoundButton();

  // Efeitos de cada passo da revelação: corre uma vez por passo (não a cada atualização).
  let lastEffect = null;
  function revealEffects(r, shown, showCorrect) {
    const key = `${state.round}|${shown}|${showCorrect}`;
    if (key === lastEffect) return;
    const fresh = !lastEffect || !lastEffect.startsWith(`${state.round}|`);
    lastEffect = key;
    if (fresh && shown > 1) return; // entrou a meio (ex.: recarregou a página): sem repetir efeitos
    if (!showCorrect) { if (shown > 0) play('tick'); return; }
    if ((r.exact || []).length) { play('exact'); confetti(); } else play('reveal');
    // Sem som triste quando todos empataram (ficaram todos ao mesmo tempo mais perto e mais longe).
    if (r.farthest.length && r.farthest.length < Object.keys(r.answers).length) setTimeout(() => play('far'), 700);
  }

  function renderReveal() {
    const r = state.result;
    const unit = state.question.unit;
    const isMap = state.question.type === 'map';
    $('#rev-question').textContent = state.question.text;

    // Ordem da revelação: do mais longe para o mais perto.
    const order = Object.keys(r.answers).sort((a, b) => r.distances[b] - r.distances[a]);
    // Passos: n palpites, a resposta certa, os votos (só se houve votação) e os pontos.
    // Sem respostas, o servidor já começa no último passo.
    const n = order.length;
    const shown = Math.min(r.step, n);
    const showCorrect = r.step > n;
    const showVotes = r.voting && r.step > n + 1;
    const showPoints = r.step >= r.steps;
    $('#rev-novote').hidden = r.voting || n === 0;

    $('#rev-numbers').hidden = isMap;
    $('#rev-map').hidden = !isMap;
    if (isMap) renderMapReveal(r, order, shown, showCorrect);
    else renderNumbers(r, order, shown, showCorrect);
    // Nas rondas de mapa as distâncias apareciam duas vezes: a lista por baixo do mapa
    // acompanha a revelação e dá lugar aos cartões "Esta ronda" no fim.
    $('#rev-map-list').hidden = showPoints;
    $('#rev-progress').textContent = n === 0 ? 'Ninguém respondeu a esta pergunta.'
      : shown < n ? `Palpite ${shown} de ${n} (do mais longe para o mais perto)` : '';

    // Nas perguntas de mapa o país já aparece pintado desde o início.
    const answerBox = $('#rev-answer');
    const answerWasHidden = answerBox.hidden || answerBox.dataset.round !== String(state.round);
    answerBox.hidden = !(showCorrect || isMap);
    if (!answerBox.hidden && answerWasHidden) {
      answerBox.dataset.round = String(state.round);
      if (isMap) $('#rev-correct').textContent = r.correct;
      else countUp($('#rev-correct'), r.correct, unit);
    }
    $('#rev-curiosity').hidden = !(showCorrect && r.curiosity);
    $('#rev-curiosity').textContent = r.curiosity ? `💡 ${r.curiosity}` : '';
    revealEffects(r, shown, showCorrect);

    $('#rev-votes-box').hidden = !showVotes;
    if (showVotes) renderVotes(r);
    else $('#rev-votes-box').open = false;
    $('#rev-points-box').hidden = !showPoints;

    // A revelação corre sozinha; o anfitrião pode saltar enquanto ainda há palpites por
    // mostrar. Depois só lhe resta "Próxima pergunta".
    const host = isHost();
    $('#btn-step').hidden = !host || showCorrect;
    // Espaço livre no fim da página com a altura do botão "Saltar" (que está fixo ao fundo).
    $('#screen-reveal').classList.toggle('has-skip', !$('#btn-step').hidden);
    if (!$('#btn-step').hidden) $('#screen-reveal').style.setProperty('--skip-h', `${$('#btn-step').offsetHeight}px`);
    $('#btn-next').hidden = !host || !showPoints;
    $('#rev-hint').textContent = host || showPoints ? '' : 'A revelar os palpites…';
    if (!showPoints) return;

    const myGain = r.points[state.me] || 0;
    $('#rev-mine').textContent = myGain ? `Ganhaste ${myGain} ponto${myGain === 1 ? '' : 's'} nesta ronda!` : 'Nenhum ponto para ti nesta ronda.';

    const votesFor = (id) => Object.values(r.votes).filter((t) => t === id).length;
    const answered = Object.keys(r.answers).sort((a, b) => r.distances[a] - r.distances[b]);
    const rows = answered.map((id) => {
      const near = r.closest.includes(id);
      const exact = (r.exact || []).includes(id);
      const far = r.farthest.includes(id);
      const votes = votesFor(id);
      const gain = r.points[id] || 0;
      return el('li', { class: near ? 'near' : far ? 'far shake' : '' }, [
        el('span', { class: 'name' }, [
          ...who(id),
          near ? el('span', { class: 'badge near', text: exact ? 'em cheio!' : 'mais perto' }) : null,
          far ? el('span', { class: 'badge far', text: 'mais longe' }) : null,
        ]),
        el('span', { class: 'value', text: isMap ? `${fmt(r.distances[id])} km` : fmt(r.answers[id]) }),
        el('span', { class: 'meta', text: missText(exact, r.distances[id], isMap) + (r.voting ? ` · ${votes} voto${votes === 1 ? '' : 's'}` : '') }),
        el('span', { class: 'gain', text: gain ? `+${gain}` : '' }),
      ]);
    });

    for (const p of state.players) {
      if (!(p.id in r.answers)) {
        const author = p.id === state.question.author;
        rows.push(el('li', {}, [
          el('span', { class: 'name' }, who(p.id)),
          el('span', { class: 'value', text: author ? '✍️' : '—' }),
          el('span', { class: 'meta', text: author ? 'autor da pergunta' : 'sem resposta' }),
          el('span', { class: 'gain', text: r.points[p.id] ? `+${r.points[p.id]}` : '' }),
        ]));
      }
    }
    // O cartão de quem ficou mais longe abana só quando a lista aparece.
    const list = $('#rev-list');
    const listKey = String(state.round);
    list.replaceChildren(...rows);
    if (list.dataset.round === listKey) list.querySelectorAll('.shake').forEach((li) => li.classList.remove('shake'));
    list.dataset.round = listKey;

    renderScores('#rev-scores', { gained: r.points, animKey: `${state.round}` });
    const last = state.round >= state.totalRounds;
    // Só há desempate para o 1.º lugar.
    const tied = standingGroups()[0].length > 1;
    $('#btn-next').textContent = !last ? 'Próxima pergunta' : tied ? 'Ir ao desempate' : 'Ver classificação final';
    $('#rev-hint').textContent = host ? '' : 'À espera do anfitrião…';
  }

  function renderTiebreakReveal() {
    const r = state.tiebreak.result;
    const unit = state.question.unit;
    $('#tbr-question').textContent = state.question.text;
    $('#tbr-correct').textContent = withUnit(r.correct, unit);
    $('#tbr-curiosity').hidden = !r.curiosity;
    $('#tbr-curiosity').textContent = r.curiosity ? `💡 ${r.curiosity}` : '';

    const answered = Object.keys(r.answers).sort((a, b) => r.distances[a] - r.distances[b]);
    const best = answered.length ? r.distances[answered[0]] : null;
    const rows = answered.map((id) => {
      const near = r.distances[id] === best;
      return el('li', { class: near ? 'near' : '' }, [
        el('span', { class: 'name' }, [...who(id), near ? el('span', { class: 'badge near', text: 'mais perto' }) : null]),
        el('span', { class: 'value', text: fmt(r.answers[id]) }),
        el('span', { class: 'meta', text: r.distances[id] === 0 ? 'acertou no número' : `falhou por ${fmt(r.distances[id])}` }),
        el('span', { class: 'gain', text: '' }),
      ]);
    });
    for (const id of r.unanswered) {
      rows.push(el('li', {}, [
        el('span', { class: 'name' }, who(id)),
        el('span', { class: 'value', text: '—' }),
        el('span', { class: 'meta', text: 'sem resposta' }),
        el('span', { class: 'gain', text: '' }),
      ]));
    }
    $('#tbr-list').replaceChildren(...rows);

    // Só o 1.º lugar vai a nova pergunta, se continuar empatado.
    $('#tbr-status').textContent = state.tiebreakPending
      ? `${listNames(state.standings[0])} continuam empatados no 1.º lugar: vai sair outra pergunta.`
      : state.tiebreakWinner ? `${nameOf(state.tiebreakWinner)} venceu o desempate.` : 'Desempate terminado.';

    renderScores('#tbr-scores');
    $('#btn-tb-next').hidden = !isHost();
    $('#btn-tb-next').textContent = state.tiebreakPending ?'Continuar desempate' : 'Ver classificação final';
    $('#tbr-hint').textContent = isHost() ? '' : 'À espera do anfitrião…';
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const AWARDS = {
    sharp: {
      icon: '🎯', title: 'Mais certeiro',
      why: (w) => (w.closest
        ? `${plural(w.closest, 'vez', 'vezes')} o mais perto${w.meanError != null ? ` · erro médio de ${fmt(Math.round(w.meanError * 100))}%` : ''}`
        : `Menor erro médio: ${fmt(Math.round(w.meanError * 100))}%`),
    },
    far: { icon: '🛸', title: 'Mais longe da realidade', why: (w) => `${plural(w.farthest, 'vez', 'vezes')} o mais longe` },
    reader: { icon: '🔮', title: 'Melhor a ler os outros', why: (w) => plural(w.correctVotes, 'voto certo', 'votos certos') },
  };

  // Os cartões só são recriados quando os prémios mudam, para a animação não repetir.
  function renderAwards() {
    const awards = state.awards || [];
    const key = JSON.stringify(awards);
    const box = $('#end-awards');
    $('#end-awards-title').hidden = !awards.length;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.replaceChildren(...awards.map((a, i) => {
      const meta = AWARDS[a.id];
      const ids = a.winners.map((w) => w.id);
      return el('div', { class: `award ${ids.includes(state.me) ? 'me' : ''}`, style: `--i:${i}` }, [
        el('span', { class: 'icon', text: meta.icon, 'aria-hidden': 'true' }),
        el('span', { class: 'title', text: meta.title }),
        el('span', { class: 'who' }, [...ids.map(player).filter(Boolean).map((p) => avatar(p, 's')), listNames(ids)]),
        el('span', { class: 'why', text: meta.why(a.winners[0]) }),
      ]);
    }));
  }

  function renderEnd() {
    renderScores('#end-scores', { size: 'l' });
    const winners = standingGroups()[0].map((p) => p.name);
    $('#end-winner').textContent = winners.length === 1
      ? `🏆 ${winners[0]} ganhou!`
      : `🏆 Empate entre ${winners.slice(0, -1).join(', ')} e ${winners[winners.length - 1]}!`;
    renderAwards();
    $('#btn-again').hidden = !isHost();
    $('#end-hint').textContent = isHost() ? '' : 'O anfitrião pode começar um novo jogo.';
  }

  render();
})();
