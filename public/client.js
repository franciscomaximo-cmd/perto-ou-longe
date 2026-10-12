'use strict';

(() => {
  const socket = io();
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const SESSION_KEY = 'pertoOuLonge.session';
  const NAME_KEY = 'pertoOuLonge.name';
  const numberFormat = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 3 });

  let state = null; // último estado recebido do servidor
  let session = load(SESSION_KEY); // { code, playerId, name } para voltar à sala
  let deadline = null;
  let lastRound = null;
  let selectedVote = null;

  // --- Utilitários --------------------------------------------------------

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function store(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch { /* modo privado: segue sem guardar */ }
  }
  function saveSession(value) {
    session = value;
    store(SESSION_KEY, value);
  }

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
  const isHost = () => state && state.hostId === state.me;

  // Envia uma ação e mostra o erro, se houver.
  function act(event, payload = {}, onOk) {
    socket.emit(event, payload, (res) => {
      if (!res || !res.ok) toast((res && res.error) || 'Sem resposta do servidor.');
      else if (onOk) onOk(res);
    });
  }

  // --- Entrar / sair ------------------------------------------------------

  function enterRoom(res) {
    saveSession({ code: res.code, playerId: res.playerId, name: res.name });
    store(NAME_KEY, res.name);
    history.replaceState(null, '', location.pathname);
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
    const url = `${location.origin}/?sala=${state.code}`;
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
  $$('.btn-force').forEach((btn) => btn.addEventListener('click', () => act('round:force')));
  $('#btn-next').addEventListener('click', () => act('round:next'));
  $('#btn-step').addEventListener('click', () => act('reveal:step'));
  $('#btn-tb-next').addEventListener('click', () => act('round:next'));
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

  function pin(point, cls = '', label = '') {
    const { x, y } = toPercent(point);
    return el('span', { class: `pin ${cls}`, style: `left:${x}%;top:${y}%` },
      label ? el('span', { class: 'pin-label', text: label }) : null);
  }

  // Põe o SVG no mapa (quando já chegou) e liga os botões de zoom uma vez.
  function setupMap(wrap) {
    const box = wrap.querySelector('.map-box');
    const inner = wrap.querySelector('.map-inner');
    // (O mapa da revelação também tem um <svg class="lines"> por cima, para as linhas.)
    if (mapSvg && !inner.querySelector('svg:not(.lines)')) inner.insertAdjacentHTML('afterbegin', mapSvg);
    if (wrap.dataset.ready) return;
    wrap.dataset.ready = '1';
    wrap.dataset.zoom = '0';
    wrap.querySelectorAll('[data-zoom]').forEach((btn) => btn.addEventListener('click', () => {
      const level = Math.min(ZOOMS.length - 1, Math.max(0, Number(wrap.dataset.zoom) + Number(btn.dataset.zoom)));
      // Mantém o centro da vista ao aproximar ou afastar.
      const cx = (box.scrollLeft + box.clientWidth / 2) / inner.offsetWidth;
      const cy = (box.scrollTop + box.clientHeight / 2) / inner.offsetHeight;
      wrap.dataset.zoom = String(level);
      inner.style.width = `${ZOOMS[level] * 100}%`;
      box.scrollLeft = cx * inner.offsetWidth - box.clientWidth / 2;
      box.scrollTop = cy * inner.offsetHeight - box.clientHeight / 2;
      if (wrap.relayout) wrap.relayout(); // com outro zoom, as etiquetas chocam de outra maneira
    }));
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

  socket.on('connect', rejoin); // também cobre reconexões depois de o telemóvel bloquear
  socket.on('disconnect', () => { if (session) toast('Ligação perdida. A tentar voltar…'); });
  socket.on('room:state', (s) => { state = s; render(); });

  // --- Desenho ------------------------------------------------------------

  const SCREENS = {
    home: '#screen-home', lobby: '#screen-lobby', answering: '#screen-answer',
    voting: '#screen-vote', reveal: '#screen-reveal', end: '#screen-end',
    tiebreak: '#screen-answer', 'tiebreak-reveal': '#screen-tiebreak',
  };

  let lastPhase = null;

  function render() {
    const phase = state ? state.phase : 'home';
    // De volta à sala de espera depois de um jogo: a pergunta antiga já foi usada.
    if (phase === 'lobby' && lastPhase && lastPhase !== 'lobby') {
      for (const sel of ['#custom-text', '#custom-answer', '#custom-unit']) $(sel).value = '';
      $('#custom-preview').textContent = '';
      $('#custom-error').textContent = '';
    }
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
    $('#tb-round').textContent = state.tiebreak ? 'Desempate' : inGame && state.round ? `Pergunta ${state.round} de ${state.totalRounds}` : 'Sala de espera';
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
      el('span', {}, [p.name, tags.length ? el('span', { class: 'tag', text: tags.join(' · ') }) : null]),
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
      const point = answered ? state.myAnswer : mapPick;
      $('#ans-map .pins').replaceChildren(...(point ? [pin(point)] : []));
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
      text: nameOf(id),
      onclick: () => { selectedVote = id; renderVote(); },
    })));
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

  function renderScores(sel) {
    const groups = standingGroups();
    const top = groups.length ? groups[0][0].score : 0;
    const rows = [];
    let count = 0;
    for (const [g, group] of groups.entries()) {
      const position = count + 1; // empatados partilham a posição
      count += group.length;
      for (const p of group) rows.push({ p, position, first: g === 0 && top > 0 });
    }
    $(sel).replaceChildren(...rows.map(({ p, position, first }) => {
      const classes = [p.id === state.me ? 'me' : '', first ? 'first' : ''].join(' ');
      return el('li', { class: classes }, [
        el('span', { class: 'pos', text: `${position}.º` }),
        el('span', { class: 'name' }, [
          p.name,
          // Explica porque está à frente de quem tem os mesmos pontos.
          state.standings && p.id === state.tiebreakWinner ? el('span', { class: 'won-tb', text: '(venceu o desempate)' }) : null,
        ]),
        el('span', { class: 'pts', text: `${p.score} pt${p.score === 1 ? '' : 's'}` }),
      ]);
    }));
  }

  // --- Revelação em passos -------------------------------------------------
  // O servidor diz em que passo vamos (r.step de r.steps); com n palpites:
  // passos 1..n mostram os palpites do mais longe para o mais perto,
  // n+1 a resposta certa, n+2 os votos e n+3 os pontos e a classificação.

  const median = (sorted) => {
    const m = sorted.length >> 1;
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  };

  // Escala da reta: segue os valores visíveis, mas corta os muito afastados (desenhados
  // na ponta, a tracejado, com uma seta). A resposta certa fica sempre dentro da escala.
  function lineScale(values, correct) {
    const sorted = [...values].sort((a, b) => a - b);
    let lo = sorted[0];
    let hi = sorted[sorted.length - 1];
    const med = median(sorted);
    const mad = median(sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b));
    if (mad > 0) {
      const inside = sorted.filter((v) => Math.abs(v - med) <= 8 * mad);
      lo = inside[0];
      hi = inside[inside.length - 1];
    }
    if (correct != null) { lo = Math.min(lo, correct); hi = Math.max(hi, correct); }
    if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
    return {
      lo, hi,
      pos: (v) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)),
      clipped: (v) => (v < lo ? 'lo' : v > hi ? 'hi' : ''),
    };
  }

  const LANE = 42; // altura de cada fila de etiquetas, em px

  // Atualiza (ou cria) a marca de um palpite, para que mude de sítio com transição.
  function upsertMark(container, key, cls, html) {
    let mark = container.querySelector(`[data-key="${key}"]`);
    if (!mark) {
      mark = el('div', { class: 'mark appear', 'data-key': key });
      container.append(mark);
    }
    mark.className = `mark ${cls} ${mark.classList.contains('appear') ? 'appear' : ''}`;
    mark.replaceChildren(...html);
    return mark;
  }

  // Põe a etiqueta dentro da caixa (o pé da marca fica no sítio certo) e devolve o centro
  // e a meia-largura da etiqueta, em % da largura da reta.
  function fitTag(tag, x, width) {
    const half = ((tag.offsetWidth / 2 + 3) / width) * 100;
    const center = Math.min(100 - half, Math.max(half, x));
    tag.style.setProperty('--dx', `${((center - x) / 100) * width}px`);
    return { center, half };
  }

  function renderNumberLine(r, order, shown, showCorrect) {
    const box = $('#rev-line');
    const marks = box.querySelector('.numline-marks');
    const correctBox = box.querySelector('.numline-correct');
    if (box.dataset.round !== String(state.round)) {
      marks.replaceChildren();
      correctBox.replaceChildren();
      box.dataset.round = String(state.round);
    }
    const ids = order.slice(0, shown);
    const values = ids.map((id) => r.answers[id]);
    if (showCorrect || !values.length) values.push(r.correct);
    const scale = lineScale(values, showCorrect ? r.correct : null);
    const unit = state.question.unit;

    // Os palpites fora da escala ficam numa zona própria na ponta, depois de um corte (≫),
    // para não parecerem perto da resposta certa.
    const cuts = ids.map((id) => scale.clipped(r.answers[id]));
    const hasLo = cuts.includes('lo');
    const hasHi = cuts.includes('hi');
    const left = hasLo ? 22 : 4;
    const right = hasHi ? 78 : 96;
    const xOf = (v) => {
      const cut = scale.clipped(v);
      if (cut === 'lo') return 5;
      if (cut === 'hi') return 95;
      return left + ((v - scale.lo) / (scale.hi - scale.lo)) * (right - left);
    };
    box.querySelector('.cut-lo').hidden = !hasLo;
    box.querySelector('.cut-hi').hidden = !hasHi;

    const keep = new Set();
    for (const id of ids) {
      const value = r.answers[id];
      const cut = scale.clipped(value);
      const cls = [
        showCorrect && r.closest.includes(id) ? 'near' : '',
        showCorrect && r.farthest.includes(id) ? 'far' : '',
        cut ? 'clipped' : '',
      ].join(' ');
      const valueText = `${cut === 'lo' ? '≪ ' : ''}${fmt(value)}${cut === 'hi' ? ' ≫' : ''}`;
      const mark = upsertMark(marks, id, cls, [
        el('span', { class: 'tag-box' }, [nameOf(id), el('b', { text: valueText })]),
        el('span', { class: 'stem' }),
      ]);
      mark.style.left = `${xOf(value)}%`;
      keep.add(id);
    }
    for (const m of marks.querySelectorAll('.mark')) if (!keep.has(m.dataset.key)) m.remove();

    // Filas: mede cada etiqueta e põe-na na primeira fila onde não choca com outra.
    const width = marks.clientWidth || 1;
    const items = ids.map((id) => {
      const mark = marks.querySelector(`[data-key="${id}"]`);
      return { mark, ...fitTag(mark.querySelector('.tag-box'), xOf(r.answers[id]), width) };
    }).sort((a, b) => a.center - b.center);
    const lanes = [];
    for (const it of items) {
      let lane = lanes.findIndex((edge) => it.center - it.half > edge + 1);
      if (lane === -1) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = it.center + it.half;
      it.lane = lane;
    }
    const height = Math.max(1, lanes.length) * LANE + 12;
    marks.style.height = `${height}px`;
    for (const it of items) {
      it.mark.style.top = `${it.lane * LANE}px`;
      it.mark.style.height = `${height - it.lane * LANE}px`;
    }

    correctBox.classList.toggle('shown', showCorrect);
    if (showCorrect) {
      const mark = upsertMark(correctBox, 'correct', 'correct', [
        el('span', { class: 'stem' }),
        el('span', { class: 'tag-box', text: withUnit(r.correct, unit) }),
      ]);
      mark.style.left = `${xOf(r.correct)}%`;
      fitTag(mark.querySelector('.tag-box'), xOf(r.correct), width);
    } else {
      correctBox.replaceChildren();
    }
  }

  // Etiquetas dos pinos no mapa: se chocarem com outra já posta, passam para baixo do pino
  // ou afastam-se uma fila de cada vez.
  function layoutPinLabels(wrap) {
    const inner = wrap.querySelector('.map-inner').getBoundingClientRect();
    const placed = [];
    // Quanto pior é uma posição: choques com outras etiquetas e, pior ainda, ficar fora do
    // mapa (a etiqueta deixava de se ver).
    const badness = (a) => placed.filter((b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top).length
      + (a.top < inner.top || a.bottom > inner.bottom ? 3 : 0);
    const ROW = 22; // um pouco mais do que a altura de uma etiqueta
    const options = [0, 1, 2, 3].flatMap((row) => [['above', row], ['below', row]]);
    const apply = ([side, row], label) => {
      label.style.top = side === 'below' ? `${14 + row * ROW}px` : 'auto';
      label.style.bottom = side === 'above' ? `${14 + row * ROW}px` : 'auto';
    };
    for (const label of wrap.querySelectorAll('.pins .pin-label')) {
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
      ...ids.map((id, i) => pin(r.answers[id], `${clsOf(id)} ${i >= before ? 'appear' : ''}`,
        `${nameOf(id)} · ${fmt(r.distances[id])} km`)),
    );
    wrap.relayout = () => layoutPinLabels(wrap);
    wrap.relayout();
  }

  function renderVotes(r) {
    $('#rev-farthest').textContent = r.farthest.length
      ? `Quem ficou mais longe: ${listNames(r.farthest)}.`
      : '';
    const entries = Object.entries(r.votes);
    $('#rev-votes').replaceChildren(...(entries.length ? entries.map(([voter, target], i) => {
      const hit = r.correctVoters.includes(voter);
      return el('li', { class: `reveal-in ${hit ? 'hit' : ''}`, style: `--i:${i}` }, [
        el('b', { text: nameOf(voter) }),
        el('span', { class: 'arrow', text: '→' }),
        el('span', { text: nameOf(target) }),
        el('span', { class: 'ok', text: hit ? '✓ acertou' : '' }),
      ]);
    }) : [el('li', { text: 'Ninguém votou nesta ronda.' })]));
  }

  function renderReveal() {
    const r = state.result;
    const unit = state.question.unit;
    const isMap = state.question.type === 'map';
    $('#rev-question').textContent = state.question.text;
    $('#rev-correct').textContent = isMap ? r.correct : withUnit(r.correct, unit);

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

    $('#rev-line').hidden = isMap;
    $('#rev-map').hidden = !isMap;
    if (isMap) renderMapReveal(r, order, shown, showCorrect);
    else renderNumberLine(r, order, shown, showCorrect);
    $('#rev-progress').textContent = n === 0 ? 'Ninguém respondeu a esta pergunta.'
      : shown < n ? `Palpite ${shown} de ${n} (do mais longe para o mais perto)` : '';

    // Nas perguntas de mapa o país já aparece pintado desde o início.
    $('#rev-answer').hidden = !(showCorrect || isMap);
    $('#rev-votes-box').hidden = !showVotes;
    if (showVotes) renderVotes(r);
    $('#rev-points-box').hidden = !showPoints;

    const host = isHost();
    $('#btn-step').hidden = !host || showPoints;
    $('#btn-step').textContent = shown < n ? 'Seguinte palpite' : 'Seguinte';
    $('#btn-next').hidden = !host || !showPoints;
    $('#rev-hint').textContent = host ? '' : 'O anfitrião vai mostrando a revelação…';
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
      return el('li', { class: near ? 'near' : far ? 'far' : '' }, [
        el('span', { class: 'name' }, [
          nameOf(id),
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
          el('span', { class: 'name', text: p.name }),
          el('span', { class: 'value', text: author ? '✍️' : '—' }),
          el('span', { class: 'meta', text: author ? 'autor da pergunta' : 'sem resposta' }),
          el('span', { class: 'gain', text: r.points[p.id] ? `+${r.points[p.id]}` : '' }),
        ]));
      }
    }
    $('#rev-list').replaceChildren(...rows);

    renderScores('#rev-scores');
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

    const answered = Object.keys(r.answers).sort((a, b) => r.distances[a] - r.distances[b]);
    const best = answered.length ? r.distances[answered[0]] : null;
    const rows = answered.map((id) => {
      const near = r.distances[id] === best;
      return el('li', { class: near ? 'near' : '' }, [
        el('span', { class: 'name' }, [nameOf(id), near ? el('span', { class: 'badge near', text: 'mais perto' }) : null]),
        el('span', { class: 'value', text: fmt(r.answers[id]) }),
        el('span', { class: 'meta', text: r.distances[id] === 0 ? 'acertou no número' : `falhou por ${fmt(r.distances[id])}` }),
        el('span', { class: 'gain', text: '' }),
      ]);
    });
    for (const id of r.unanswered) {
      rows.push(el('li', {}, [
        el('span', { class: 'name', text: nameOf(id) }),
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
        el('span', { class: 'who', text: listNames(ids) }),
        el('span', { class: 'why', text: meta.why(a.winners[0]) }),
      ]);
    }));
  }

  function renderEnd() {
    renderScores('#end-scores');
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
