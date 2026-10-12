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

  // --- Ligação ------------------------------------------------------------

  socket.on('connect', rejoin); // também cobre reconexões depois de o telemóvel bloquear
  socket.on('disconnect', () => { if (session) toast('Ligação perdida. A tentar voltar…'); });
  socket.on('room:state', (s) => { state = s; render(); });

  // --- Desenho ------------------------------------------------------------

  const SCREENS = {
    home: '#screen-home', lobby: '#screen-lobby', answering: '#screen-answer',
    voting: '#screen-vote', reveal: '#screen-reveal', end: '#screen-end',
  };

  function render() {
    const phase = state ? state.phase : 'home';
    for (const [key, sel] of Object.entries(SCREENS)) $(sel).hidden = key !== phase;

    deadline = state && state.remainingMs != null ? Date.now() + state.remainingMs : null;
    renderTopbar();
    tick();

    if (state && state.round !== lastRound) {
      lastRound = state.round;
      $('#ans-input').value = '';
      $('#ans-preview').textContent = '';
      selectedVote = null;
    }

    if (phase === 'home') renderHome();
    if (phase === 'lobby') renderLobby();
    if (phase === 'answering') renderAnswer();
    if (phase === 'voting') renderVote();
    if (phase === 'reveal') renderReveal();
    if (phase === 'end') renderEnd();

    $$('.btn-force').forEach((b) => { b.hidden = !isHost(); });
  }

  function renderTopbar() {
    const inGame = state && state.phase !== 'lobby';
    $('#topbar').hidden = !state;
    if (!state) return;
    $('#tb-code').textContent = state.code;
    $('#tb-round').textContent = inGame && state.round ? `Pergunta ${state.round} de ${state.totalRounds}` : 'Sala de espera';
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

  function progressList(sel, doneIds) {
    const rows = state.players
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
    $('#ans-unit').textContent = state.question.unit ? `Resposta em ${state.question.unit}` : '';
    const answered = state.myAnswer !== null;
    $('#ans-form').hidden = answered;
    $('#ans-done').hidden = !answered;
    if (answered) $('#ans-mine').textContent = withUnit(state.myAnswer, state.question.unit);
    progressList('#ans-progress', state.answered);
  }

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

  function renderScores(sel) {
    const sorted = [...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt'));
    const top = sorted.length ? sorted[0].score : 0;
    let position = 0;
    $(sel).replaceChildren(...sorted.map((p, i) => {
      if (i === 0 || p.score !== sorted[i - 1].score) position = i + 1; // empatados partilham a posição
      const classes = [p.id === state.me ? 'me' : '', p.score === top && top > 0 ? 'first' : ''].join(' ');
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
    $('#rev-question').textContent = state.question.text;
    $('#rev-correct').textContent = withUnit(r.correct, unit);

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
        el('span', { class: 'value', text: fmt(r.answers[id]) }),
        el('span', { class: 'meta', text: `${exact ? 'acertou no número' : `falhou por ${fmt(r.distances[id])}`} · ${votes} voto${votes === 1 ? '' : 's'}` }),
        el('span', { class: 'gain', text: gain ? `+${gain}` : '' }),
      ]);
    });
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
    $('#btn-next').hidden = !isHost();
    $('#btn-next').textContent = last ? 'Ver classificação final' : 'Próxima pergunta';
    $('#rev-hint').textContent = isHost() ? '' : 'À espera do anfitrião…';
  }

  function renderEnd() {
    renderScores('#end-scores');
    const top = Math.max(...state.players.map((p) => p.score));
    const winners = state.players.filter((p) => p.score === top).map((p) => p.name);
    $('#end-winner').textContent = winners.length === 1
      ? `🏆 ${winners[0]} ganhou!`
      : `🏆 Empate entre ${winners.slice(0, -1).join(', ')} e ${winners[winners.length - 1]}!`;
    $('#btn-again').hidden = !isHost();
    $('#end-hint').textContent = isHost() ? '' : 'O anfitrião pode começar um novo jogo.';
  }

  render();
})();
