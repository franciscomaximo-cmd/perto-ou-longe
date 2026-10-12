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

  // Aceita "1 000", "1.000.000", "12,5" e "12.5".
  function parseNumber(raw) {
    let s = String(raw).trim().replace(/[\s ]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

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

  $('#btn-start').addEventListener('click', () => act('game:start'));
  $$('.btn-force').forEach((btn) => btn.addEventListener('click', () => act('round:force')));
  $('#btn-next').addEventListener('click', () => act('round:next'));
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
    if (mapSvg && !inner.querySelector('svg')) inner.insertAdjacentHTML('afterbegin', mapSvg);
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

  function render() {
    const phase = state ? state.phase : 'home';
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
    $('#lobby-players').replaceChildren(...state.players.map((p) => playerRow(p)));

    const host = isHost();
    $('#set-rounds').min = state.minRounds;
    $('#set-rounds').max = state.maxRounds;
    for (const s of SETTINGS) {
      const input = $(s.input);
      input.disabled = !host;
      // Não mexe no regulador enquanto o anfitrião o está a arrastar.
      if (document.activeElement !== input) {
        input.value = state.settings[s.key];
        $(s.out).textContent = s.format(state.settings[s.key]);
      }
    }
    $('#settings-hint').textContent = host
      ? 'Nos tempos, arrasta até ao início para jogar sem limite.'
      : 'Só o anfitrião pode mudar a configuração.';

    const missing = state.minPlayers - online;
    $('#btn-start').hidden = !host;
    $('#btn-start').disabled = missing > 0;
    $('#btn-start').textContent = 'Começar jogo';
    $('#lobby-hint').textContent = missing > 0
      ? `${missing === 1 ? 'Falta 1 jogador' : `Faltam ${missing} jogadores`} para começar (mínimo ${state.minPlayers}).`
      : host ? '' : 'À espera que o anfitrião comece o jogo…';
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
    const isMap = state.question.type === 'map';
    const tb = state.phase === 'tiebreak' ? state.tiebreak : null;
    const playing = !tb || tb.ids.includes(state.me);
    const answered = state.myAnswer !== null;
    $('#ans-unit').textContent = isMap
      ? (answered ? 'Palpite enviado. À espera dos outros…' : 'Toca no mapa onde achas que fica.')
      : state.question.unit ? `Resposta em ${state.question.unit}` : '';
    $('#ans-tiebreak').hidden = !tb;
    if (tb) $('#ans-tiebreak').textContent = `Desempate entre ${listNames(tb.ids)}. Só eles respondem, sem votação: quem ficar mais perto fica à frente.`;
    $('#ans-form').hidden = isMap || answered || !playing;
    $('#ans-done').hidden = isMap || !answered;
    $('#ans-watch').hidden = playing;
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
    progressList('#ans-progress', state.answered, tb ? tb.ids : null);
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
        el('span', { class: 'name', text: p.name }),
        el('span', { class: 'pts', text: `${p.score} pt${p.score === 1 ? '' : 's'}` }),
      ]);
    }));
  }

  function renderReveal() {
    const r = state.result;
    const unit = state.question.unit;
    const isMap = state.question.type === 'map';
    $('#rev-question').textContent = state.question.text;
    $('#rev-correct').textContent = isMap ? r.correct : withUnit(r.correct, unit);

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
        el('span', { class: 'meta', text: `${missText(exact, r.distances[id], isMap)} · ${votes} voto${votes === 1 ? '' : 's'}` }),
        el('span', { class: 'gain', text: gain ? `+${gain}` : '' }),
      ]);
    });

    $('#rev-map').hidden = !isMap;
    if (isMap) {
      setupMap($('#rev-map'));
      $$('#rev-map path').forEach((p) => p.classList.toggle('target', p.dataset.c === r.country));
      $('#rev-map .pins').replaceChildren(
        r.center ? pin(r.center, 'target') : null,
        ...answered.map((id) => {
          const cls = r.closest.includes(id) ? 'near' : r.farthest.includes(id) ? 'far' : '';
          return pin(r.answers[id], cls, nameOf(id));
        }),
      );
    }
    for (const p of state.players) {
      if (!(p.id in r.answers)) {
        rows.push(el('li', {}, [
          el('span', { class: 'name', text: p.name }),
          el('span', { class: 'value', text: '—' }),
          el('span', { class: 'meta', text: 'sem resposta' }),
          el('span', { class: 'gain', text: r.points[p.id] ? `+${r.points[p.id]}` : '' }),
        ]));
      }
    }
    $('#rev-list').replaceChildren(...rows);

    $('#rev-voters').textContent = r.correctVoters.length
      ? `Acertaram no mais longe: ${r.correctVoters.map(nameOf).join(', ')}.`
      : Object.keys(r.votes).length ? 'Ninguém acertou no mais longe.' : '';

    renderScores('#rev-scores');
    const last = state.round >= state.totalRounds;
    const tied = standingGroups().some((g) => g.length > 1);
    $('#btn-next').hidden = !isHost();
    $('#btn-next').textContent = !last ? 'Próxima pergunta' : tied ? 'Ir ao desempate' : 'Ver classificação final';
    $('#rev-hint').textContent = isHost() ? '' : 'À espera do anfitrião…';
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

    // Quem ficou outra vez empatado (com resposta) vai a nova pergunta.
    const stillTied = answered.filter((id) => answered.some((o) => o !== id && r.distances[o] === r.distances[id]));
    $('#tbr-status').textContent = stillTied.length
      ? `${listNames(stillTied)} voltaram a empatar: vai sair outra pergunta.`
      : 'Desempate resolvido.';

    renderScores('#tbr-scores');
    $('#btn-tb-next').hidden = !isHost();
    $('#btn-tb-next').textContent = state.tiebreakPending ?'Continuar desempate' : 'Ver classificação final';
    $('#tbr-hint').textContent = isHost() ? '' : 'À espera do anfitrião…';
  }

  function renderEnd() {
    renderScores('#end-scores');
    const winners = standingGroups()[0].map((p) => p.name);
    $('#end-winner').textContent = winners.length === 1
      ? `🏆 ${winners[0]} ganhou!`
      : `🏆 Empate entre ${winners.slice(0, -1).join(', ')} e ${winners[winners.length - 1]}!`;
    $('#btn-again').hidden = !isHost();
    $('#end-hint').textContent = isHost() ? '' : 'O anfitrião pode começar um novo jogo.';
  }

  render();
})();
