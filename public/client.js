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

  // --- Textos do estilo "escola" (sala de aula) --------------------------------------------
  // Todos os textos novos num só sítio, para se poderem mudar facilmente. No HTML, um elemento
  // com data-t="chave" recebe o texto TEXTOS[chave] ao abrir a página (o HTML já traz o mesmo
  // texto, para o caso de o script demorar). Os textos com valores (ex.: o número de jogadores)
  // são funções.
  const TEXTOS = {
    nome: 'Mais Coisa, Menos Coisa',
    slogan: 'Adivinha números e descobre quem falhou por mais.',
    // Ecrã inicial
    oTeuNome: 'O teu nome',
    criarTurma: 'Criar turma',
    ouEntra: 'ou entra numa turma que já existe',
    codigoTurma: 'Código da turma',
    entrarTurma: 'Entrar na turma',
    comoSeJoga: 'Como se joga',
    // Sala de espera
    salaDeAula: 'Sala de aula',
    qrDica: 'Aponta a câmara do telemóvel para entrares.',
    chamarColegas: 'Chamar colegas',
    chamada: 'Chamada',
    presente: 'Presente!',
    aArrumar: 'A arrumar a mochila…',
    estouPresente: 'Estou presente',
    naoPresente: 'Afinal ainda não estou presente',
    comecarAula: 'Começar a aula!',
    regrasAula: 'Regras da aula',
    sairSala: 'Sair da sala',
    convite: (code) => `Entra na turma no Mais Coisa, Menos Coisa! Código da turma: ${code}`,
    ligacaoCopiada: 'Ligação copiada.',
    soAnfitriao: 'Só o anfitrião pode mudar as regras da aula.',
    faltaPronto: (name) => `Falta 1 aluno dizer que está presente: ${name}.`,
    faltamProntos: (n, names) => `Faltam ${n} alunos dizerem que estão presentes: ${names}.`,
    carregaPresente: 'Carrega em «Estou presente» quando estiveres preparado.',
    todosPresentes: 'Estão todos presentes. Podes começar a aula!',
    esperaAnfitriao: 'Estás presente. À espera que o anfitrião comece a aula…',
    regrasMudaram: 'O anfitrião mudou as regras da aula. Vê-as e diz outra vez que estás presente.',
    perguntaPrimeiro: 'Escreve primeiro a tua pergunta para ficares presente.',
    // Pergunta e resposta
    perguntaTeste: 'Pergunta do teste',
    aTuaResposta: 'A tua resposta',
    entregar: 'Entregar',
    tocaNoMapa: 'Toca no mapa para escolher',
    quemJaEntregou: 'Quem já entregou',
    // Votação
    votarTitulo: 'Quem é que disse a maior asneira?',
    votarDica: 'Vota em quem achas que ficou mais longe. Os palpites só se veem no fim.',
    votar: 'Votar',
    // Revelação
    jaChega: 'Já chega!',
    venhaProxima: 'Venha a próxima!',
    respostaCerta: 'Resposta certa:',
    // Pauta e fim do jogo
    pauta: 'Pauta',
    mediaTurma: 'Média da turma',
    pontos: (n) => `${fmt(n)} ${n === 1 ? 'ponto' : 'pontos'}`,
    toqueSaida: 'Toque de saída!',
    ganhou: (name) => `🏆 ${name} é o melhor aluno da turma!`,
    empate: (names, last) => `🏆 ${names} e ${last} são os melhores alunos da turma!`,
    quadroHonra: 'Quadro de honra',
    maisUmaAula: 'Mais uma aula!',
  };
  for (const node of document.querySelectorAll('[data-t]')) {
    const value = TEXTOS[node.dataset.t];
    if (typeof value === 'string') node.textContent = value;
  }

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
  // Avatar de um jogador (o mesmo em todo o lado): o retrato do boneco (cabeça e ombros) num
  // círculo com gradiente da sua cor, borda branca fina e sombra. "Tu" tem um anel brilhante,
  // o anfitrião uma coroa e quem está desligado fica a cinzento. Tamanhos: 'xs' (~18 px,
  // etiquetas do mapa), 's' (~26 px, dentro de etiquetas), 'm' (~40 px, listas) e 'l'
  // (~56 px, alvo e ecrã final).
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
    $('#home-notice').hidden = true;
    saveSession({ code: res.code, playerId: res.playerId, name: res.name });
    store(NAME_KEY, res.name);
    history.replaceState(null, '', location.pathname);
    // Volta a vestir o boneco guardado. A meio de um jogo o servidor recusa (só na sala de
    // espera se muda o boneco): aí ignora-se a resposta, sem aviso. Um boneco guardado por
    // uma versão antiga (cabeça = emoji) recebe uma cara gerada a partir dessas escolhas, que
    // fica guardada. Sem nada guardado, fica a cara ao calhas que o servidor deu.
    const stored = load(CHAR_KEY);
    const saved = window.CharacterOptions.upgradeCharacter(stored);
    if (saved) {
      if (JSON.stringify(saved) !== JSON.stringify(stored)) store(CHAR_KEY, saved);
      socket.emit('player:character', saved, () => {});
    }
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
        // A sala já não existe (o servidor reiniciou, ex.: num deploy, ou a sala fechou por
        // inatividade): explica no ecrã inicial em vez de voltar ao início em silêncio.
        if (res && res.reason === 'no-room') homeNotice('O jogo foi reiniciado. Cria uma sala nova para continuar.');
        else if (res && res.reason === 'kicked') homeNotice(res.error);
        else if (res && res.error) toast('Já não foi possível voltar à sala.');
      }
    });
  }

  // Aviso no ecrã inicial (sala que desapareceu, expulso pelo anfitrião).
  function homeNotice(text) {
    $('#home-notice').textContent = text;
    $('#home-notice').hidden = false;
  }

  // Expulso pelo anfitrião: volta ao ecrã inicial e esquece a sessão (não volta a entrar
  // sozinho; pode entrar outra vez com o código).
  socket.on('room:kicked', () => {
    saveSession(null);
    state = null;
    render();
    homeNotice('Foste removido da sala pelo anfitrião.');
  });

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
    const text = TEXTOS.convite(state.code);
    try {
      if (navigator.share) await navigator.share({ title: TEXTOS.nome, text, url });
      else { await navigator.clipboard.writeText(url); toast(TEXTOS.ligacaoCopiada); }
    } catch { /* partilha cancelada */ }
  });

  // --- Configuração da sala (só o anfitrião mexe) --------------------------

  // Tempos: o regulador anda de 5 em 5 segundos (10, 15, 20… até 180). A primeira posição (5)
  // quer dizer "Sem limite" (0 no servidor), para se poder desligar o tempo arrastando até ao início.
  const TIME_OFF = 5;
  const timeFromSlider = (n) => (n <= TIME_OFF ? 0 : n);
  const timeToSlider = (s) => (s > 0 ? s : TIME_OFF);
  const SETTINGS = [
    { input: '#set-rounds', out: '#out-rounds', key: 'rounds', format: (n) => String(n) },
    { input: '#set-answer', out: '#out-answer', key: 'answerTime', format: formatTime, fromSlider: timeFromSlider, toSlider: timeToSlider },
    { input: '#set-vote', out: '#out-vote', key: 'voteTime', format: formatTime, fromSlider: timeFromSlider, toSlider: timeToSlider },
  ];
  const sliderValue = (s) => (s.fromSlider ? s.fromSlider(Number($(s.input).value)) : Number($(s.input).value));

  for (const s of SETTINGS) {
    const input = $(s.input);
    input.addEventListener('input', () => { $(s.out).textContent = s.format(sliderValue(s)); });
    input.addEventListener('change', () => {
      act('settings:update', Object.fromEntries(SETTINGS.map((x) => [x.key, sliderValue(x)])));
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
  // O desenho do mapa, o zoom, o enquadramento e a revelação estão em public/map.js (MapView),
  // partilhado com a página de pré-visualização (dev/reveal.html). Aqui fica só o que é do jogo.
  let mapPick = null; // ponto escolhido e ainda não enviado

  window.MapView.load('mapa.svg')
    .then(() => render())
    .catch(() => toast('Não foi possível carregar o mapa.'));

  const { pin, setZoom, minZoom } = window.MapView;
  const setupMap = window.MapView.setup;

  // Cada pergunta de mapa começa no zoom mínimo (2× no telemóvel), centrada no meio do mapa;
  // o jogador arrasta para os lados para procurar.
  function resetAnswerMap(wrap) {
    if (wrap.dataset.round === lastRound) return;
    const inner = wrap.querySelector('.map-inner');
    if (!inner.querySelector('svg:not(.lines)') || !inner.offsetWidth) return; // ainda sem mapa ou escondido
    wrap.dataset.round = lastRound;
    setZoom(wrap, minZoom(), 0.5, 0.45);
  }

  $('#ans-map .map-inner').addEventListener('click', (e) => {
    if (!state || state.myAnswer !== null) return;
    mapPick = window.MapView.pointAt(e, e.currentTarget);
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

  // --- Reações durante a revelação ------------------------------------------
  // Barra fixa no fundo, com 6 emojis (os mesmos de REACTIONS em server/rooms.js). O servidor
  // reenvia cada reação a toda a sala; aqui sobe a flutuar ~2 s, com o mini-retrato de quem a
  // mandou. Só animações de transform/opacity (não pesam nas animações dos temas), no máximo
  // MAX_REACTIONS ao mesmo tempo, e o retrato é uma cópia de um modelo guardado por jogador.
  const REACTIONS = ['😂', '😱', '👏', '🤦', '🔥', '🤯'];
  const REACTION_LABELS = ['A rir', 'Espantado', 'Palmas', 'Que vergonha', 'Fogo', 'Cabeça a explodir'];
  const REACTION_GAP_MS = 700; // igual ao limite do servidor (não vale a pena mandar antes)
  const MAX_REACTIONS = 15;
  const REACTION_MS = 2000;
  const reactingPhase = (phase) => phase === 'reveal' || phase === 'tiebreak-reveal';
  let lastReactionSent = 0;
  const reactionFaces = new Map(); // id -> { key, node } (modelo do mini-retrato)

  $('#reactions-bar').append(...REACTIONS.map((emoji, i) => el('button', {
    type: 'button', class: 'reaction-btn', text: emoji, 'aria-label': REACTION_LABELS[i],
    // O botão não fica com o foco (não faz a página saltar no Safari do iPhone).
    onmousedown: (e) => e.preventDefault(),
    onclick: () => sendReaction(emoji),
  })));

  function sendReaction(emoji) {
    if (!state || !reactingPhase(state.phase)) return;
    const now = Date.now();
    if (now - lastReactionSent < REACTION_GAP_MS) return;
    lastReactionSent = now;
    socket.emit('reaction:send', { emoji }, () => {}); // sem avisos: uma reação perdida não faz mal
  }

  function reactionFace(id) {
    const p = player(id);
    if (!p) return null;
    const key = JSON.stringify([p.character, p.color, p.connected, state.hostId === id]);
    let face = reactionFaces.get(id);
    if (!face || face.key !== key) {
      face = { key, node: avatar(p, 's') };
      reactionFaces.set(id, face);
    }
    return face.node.cloneNode(true);
  }

  socket.on('room:reaction', ({ id, emoji } = {}) => {
    if (!state || !reactingPhase(state.phase) || !REACTIONS.includes(emoji) || document.hidden) return;
    const layer = $('#reactions-layer');
    while (layer.childElementCount >= MAX_REACTIONS) layer.firstElementChild.remove(); // as mais antigas saem
    const still = reducedMotion();
    // Sítio ao calhas, na largura do ecrã (sem cortar nas bordas), com um ligeiro desvio na subida.
    const x = 12 + Math.random() * 76;
    const node = el('div', {
      class: `reaction${still ? ' still' : ''}${id === state.me ? ' mine' : ''}`,
      style: `left:${x.toFixed(1)}%;--dx:${Math.round((Math.random() - 0.5) * 50)}px;--c:${colorOf(id)}${still ? `;--y:${Math.round(Math.random() * 20)}vh` : ''}`,
    }, [reactionFace(id), el('span', { class: 'reaction-emoji', text: emoji })]);
    node.addEventListener('animationend', () => node.remove());
    setTimeout(() => node.remove(), REACTION_MS + 300); // (sem animação, ou se não chegar a acabar)
    layer.append(node);
  });

  // --- Chat da turma (sala de espera e fim do jogo) ----------------------------
  // As mensagens chegam no room:state, só nestas fases (durante o jogo o chat não existe).
  // O texto é SEMPRE posto com textContent: nunca é lido como HTML. O contador do botão conta
  // as mensagens novas dos outros desde a última vez que o chat esteve aberto (as que já lá
  // estavam quando se entrou na sala não contam como novas).
  let chatSeen = null; // id da última mensagem já vista
  let chatRoom = null;
  let chatSignature = '';
  const chatIsOpen = () => !$('#chat').hidden;

  function openChat() {
    $('#chat').hidden = false;
    renderChat(true);
    // Só com teclado físico: no telemóvel, o teclado a abrir logo tapava os bilhetes.
    if (window.matchMedia('(hover: hover)').matches) $('#chat-input').focus();
  }
  function closeChat() {
    if (!chatIsOpen()) return;
    $('#chat').hidden = true;
  }
  $('#tb-chat').addEventListener('click', openChat);
  $('#chat-close').addEventListener('click', closeChat);
  $('#chat').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeChat(); });
  $('#chat').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeChat(); });

  // Por baixo da caixa: quantos caracteres faltam (perto do limite) ou o erro do último envio
  // (fica no painel: o aviso normal ficava por baixo dele).
  function updateChatLeft(error = '') {
    const left = (state && state.chat ? state.chat.maxLength : 200) - [...$('#chat-input').value].length;
    const note = $('#chat-left');
    note.classList.toggle('error', Boolean(error));
    note.textContent = error || (left <= 40 ? `Faltam ${Math.max(0, left)} caracteres` : '');
  }
  $('#chat-input').addEventListener('input', () => updateChatLeft());
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#chat-input').value.trim();
    if (!text) return;
    if (!socket.connected) return updateChatLeft('Sem ligação ao servidor.');
    socket.timeout(10000).emit('chat:send', { text }, (err, res) => {
      if (err) return updateChatLeft('O servidor não respondeu. Tenta outra vez.');
      if (!res || !res.ok) return updateChatLeft((res && res.error) || 'Não foi possível enviar.');
      $('#chat-input').value = '';
      updateChatLeft();
    });
  });

  // Botão do anfitrião para silenciar (ou voltar a deixar escrever) um jogador no chat.
  function muteButton(id, name, cls = '') {
    const muted = state.chat.muted.includes(id);
    return el('button', {
      type: 'button', class: `chat-mute ${cls}${muted ? ' on' : ''}`, text: muted ? '🔇' : '🔈',
      'aria-pressed': String(muted),
      'aria-label': muted ? `Deixar ${name} escrever no chat` : `Silenciar ${name} no chat`,
      title: muted ? `Deixar ${name} escrever no chat` : `Silenciar ${name} no chat`,
      onclick: () => act('chat:mute', { playerId: id, muted: !muted }),
    });
  }

  function chatItem(m) {
    if (m.kind === 'info') return el('li', { class: 'chat-info', text: m.text });
    // Quem escreveu pode já ter saído: o retrato e o nome vêm com a mensagem.
    const p = player(m.from) || { id: m.from, name: m.name, color: m.color, character: m.character, connected: true };
    const mine = m.from === state.me;
    const muted = state.chat.muted.includes(m.from);
    return el('li', { class: `chat-note${mine ? ' mine' : ''}`, style: `--c:${m.color}` }, [
      el('div', { class: 'chat-who' }, [
        window.RevealThemes.kit.avatar(p, 's', { me: mine, host: m.from === state.hostId }),
        el('span', { class: 'chat-name', text: m.name }),
        muted ? el('span', { class: 'chat-tag', text: 'silenciado' }) : null,
        isHost() && !mine && player(m.from) ? muteButton(m.from, m.name) : null,
      ]),
      el('p', { class: 'chat-text', text: m.text }),
    ]);
  }

  function renderChat(scrollToEnd = false) {
    const chat = state && state.chat;
    $('#tb-chat').hidden = !chat;
    if (!chat) {
      closeChat();
      return;
    }
    const msgs = chat.messages;
    const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    if (chatRoom !== state.code) {
      chatRoom = state.code;
      chatSeen = lastId; // ao entrar: as recentes veem-se, mas não contam como novas
      chatSignature = '';
    }
    if (chatIsOpen()) chatSeen = lastId;
    const unread = msgs.filter((m) => m.id > chatSeen && m.kind === 'msg' && m.from !== state.me).length;
    const count = $('#tb-chat-count');
    count.hidden = !unread;
    count.textContent = unread > 9 ? '9+' : String(unread);
    $('#tb-chat').setAttribute('aria-label', unread ? `Abrir o chat (${unread} ${unread === 1 ? 'mensagem nova' : 'mensagens novas'})` : 'Abrir o chat');

    const mutedMe = chat.muted.includes(state.me);
    $('#chat-muted').hidden = !mutedMe;
    $('#chat-input').disabled = mutedMe;
    $('#chat-send').disabled = mutedMe;

    // Só volta a desenhar os bilhetes quando alguma coisa mudou.
    const signature = JSON.stringify([state.code, lastId, msgs.length, msgs.length && msgs[msgs.length - 1].at, chat.muted, state.hostId, state.me]);
    if (signature === chatSignature && !scrollToEnd) return;
    chatSignature = signature;
    const list = $('#chat-list');
    const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    list.replaceChildren(...(msgs.length ? msgs.map(chatItem) : [el('li', { class: 'chat-info', text: 'Ainda não há bilhetes. Escreve o primeiro!' })]));
    if (atEnd || scrollToEnd) list.scrollTop = list.scrollHeight;
  }

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
    // O confetti não passa para o ecrã seguinte.
    if (phase !== lastPhase) stopConfetti();
    // Fora da sala de espera (o jogo começou, ou saiu), fecham o editor do boneco (sem
    // guardar) e a confirmação.
    if (phase !== 'lobby') {
      if (draft) closeEditor();
      closeConfirm(false);
    }
    // A barra fixa do fundo só existe na sala de espera (o aviso sobe para não a tapar).
    document.body.classList.toggle('has-actions', phase === 'lobby');
    // A barra das reações só existe na revelação e nos resultados; fora delas, as que ainda
    // estavam a subir desaparecem.
    const reacting = reactingPhase(phase);
    $('#reactions-bar').hidden = !reacting;
    document.body.classList.toggle('has-reactions', reacting);
    if (!reacting) $('#reactions-layer').replaceChildren();
    lastPhase = phase;
    trackProgress(); // feitos para os desbloqueáveis do boneco
    for (const sel of new Set(Object.values(SCREENS))) $(sel).hidden = sel !== SCREENS[phase];

    deadline = state && state.remainingMs != null ? Date.now() + state.remainingMs : null;
    renderTopbar();
    renderChat();
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
    // No fim e na sala de espera, o título está na própria página ("Toque de saída!", "Sala de aula").
    $('#tb-round').textContent = state.phase === 'end' ? ''
      : state.tiebreak ? `Desempate${state.tiebreak.number > 1 ? ` ${state.tiebreak.number}` : ''}`
      : inGame && state.round ? `Pergunta ${state.round} de ${state.totalRounds}`
      : '';
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

  // Linha de um jogador na sala de espera: estado ("Presente!" / "A arrumar a mochila…"),
  // a pergunta (no modo "Perguntas dos jogadores") e, para o anfitrião, os botões discretos de
  // silenciar no chat e de expulsar.
  function lobbyRow(p, custom) {
    const extras = el('span', { class: 'lobby-extras' }, [
      custom ? el('span', { class: 'state', text: state.customReady.includes(p.id) ? 'pergunta ✓' : 'a escrever…' }) : null,
      p.connected ? el('span', { class: `ready-badge ${p.ready ? 'on' : ''}`, text: p.ready ? TEXTOS.presente : TEXTOS.aArrumar }) : null,
      isHost() && p.id !== state.me && state.chat ? muteButton(p.id, p.name, 'kick') : null,
      isHost() && p.id !== state.me ? el('button', {
        type: 'button', class: 'kick', 'aria-label': `Expulsar ${p.name}`, title: `Expulsar ${p.name}`, text: '✕',
        onclick: () => askConfirm(`Expulsar ${p.name}?`, 'Expulsar').then((ok) => { if (ok) act('player:kick', { playerId: p.id }); }),
      }) : null,
    ]);
    return playerRow(p, extras);
  }

  // Confirmação no estilo do jogo (em vez do confirm() do browser): devolve uma promessa com
  // true (o botão principal) ou false (Cancelar, tocar fora da caixa ou Esc).
  let confirmResolve = null;
  function askConfirm(text, okLabel) {
    closeConfirm(false);
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = okLabel;
    $('#confirm').hidden = false;
    $('#confirm-cancel').focus();
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  function closeConfirm(ok) {
    if (!confirmResolve) return;
    const resolve = confirmResolve;
    confirmResolve = null;
    $('#confirm').hidden = true;
    resolve(ok);
  }
  $('#confirm-ok').addEventListener('click', () => closeConfirm(true));
  $('#confirm-cancel').addEventListener('click', () => closeConfirm(false));
  $('#confirm').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeConfirm(false); });
  $('#confirm').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeConfirm(false); });

  // Aviso curto quando o anfitrião muda as regras (todos voltam a "não pronto").
  let seenRules = null; // [código da sala, versão das regras]
  function noticeRules() {
    const key = state.code;
    if (!seenRules || seenRules[0] !== key) { seenRules = [key, state.rulesVersion]; return; }
    if (state.rulesVersion > seenRules[1]) {
      seenRules[1] = state.rulesVersion;
      if (!isHost() && state.phase === 'lobby') toast(TEXTOS.regrasMudaram);
    }
  }

  function renderLobby() {
    const online = state.players.filter((p) => p.connected).length;
    $('#lobby-code').textContent = state.code;
    $('#lobby-count').textContent = `(${state.players.length}/${state.maxPlayers})`;
    const custom = state.settings.playerQuestions;
    $('#lobby-players').replaceChildren(...state.players.map((p) => lobbyRow(p, custom)));
    noticeRules();

    renderCharacterCard();
    renderCharacterEditor(); // só se o editor estiver aberto
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
        input.value = s.toSlider ? s.toSlider(value) : value;
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
      : TEXTOS.soAnfitriao;
    renderCategories(host);

    const missing = state.minPlayers - online;
    const noQuestion = custom
      ? state.players.filter((p) => p.connected && !state.customReady.includes(p.id)).map((p) => p.name)
      : [];
    // Jogadores ligados ainda não prontos (os desligados não contam; o anfitrião está sempre).
    const waiting = state.players.filter((p) => p.connected && !p.ready).map((p) => p.name);
    $('#btn-start').hidden = !host;
    $('#btn-start').disabled = missing > 0 || noQuestion.length > 0 || waiting.length > 0;
    $('#btn-start').textContent = TEXTOS.comecarAula;

    // "Estou pronto" (todos menos o anfitrião). No modo das perguntas dos jogadores, só depois
    // de escrever a pergunta.
    const me = player(state.me);
    const meReady = Boolean(me && me.ready);
    const needsQuestion = custom && !state.customReady.includes(state.me);
    $('#btn-ready').hidden = host || !me;
    $('#btn-ready').disabled = !meReady && needsQuestion;
    $('#btn-ready').classList.toggle('is-ready', meReady);
    $('#btn-ready').textContent = meReady ? TEXTOS.naoPresente : TEXTOS.estouPresente;

    const waitingText = waiting.length === 1
      ? TEXTOS.faltaPronto(waiting[0])
      : TEXTOS.faltamProntos(waiting.length, waiting.join(', '));
    $('#lobby-hint').textContent = missing > 0
      ? `${missing === 1 ? 'Falta 1 jogador' : `Faltam ${missing} jogadores`} para começar (mínimo ${state.minPlayers}).`
      : noQuestion.length ? `Falta a pergunta de: ${noQuestion.join(', ')}.`
      : waiting.length ? (host || meReady ? waitingText : TEXTOS.carregaPresente)
      : host ? TEXTOS.todosPresentes : TEXTOS.esperaAnfitriao;
    if (!host && needsQuestion && !meReady) $('#lobby-hint').textContent = TEXTOS.perguntaPrimeiro;
  }
  $('#btn-ready').addEventListener('click', () => {
    const me = player(state.me);
    act('player:ready', { ready: !(me && me.ready) });
  });

  // --- Progresso e desbloqueáveis (só neste dispositivo, sem contas) ------------------------
  // Feitos guardados no localStorage: "em cheio", jogos ganhos (e com 6 ou mais jogadores) e
  // jogos jogados até ao fim. Cada feito conta uma vez por ronda/jogo (as chaves já contadas
  // ficam no sessionStorage, para recarregar a página não contar outra vez).
  const PROGRESS_KEY = 'pertoOuLonge.progress';
  const COUNTED_KEY = 'pertoOuLonge.counted';
  const progress = () => ({ ...window.CharacterOptions.EMPTY_PROGRESS, ...(load(PROGRESS_KEY) || {}) });
  function countOnce(key, stats) {
    const counted = load(COUNTED_KEY, sessionStorage) || [];
    if (counted.includes(key)) return;
    store(COUNTED_KEY, [...counted, key].slice(-200), sessionStorage);
    const before = progress();
    const after = { ...before };
    for (const s of stats) after[s] = (after[s] || 0) + 1;
    store(PROGRESS_KEY, after);
    // Peças que acabaram de desbloquear: avisa.
    const fresh = window.CharacterOptions.UNLOCKS.filter((u) => before[u.stat] < u.need && after[u.stat] >= u.need);
    if (fresh.length) setTimeout(() => toast(`🔓 Desbloqueaste: ${fresh.map(unlockLabel).join(', ')}! Vê no teu boneco.`), 1800);
  }
  function trackProgress() {
    if (!state || !state.me || state.phase === 'lobby') return;
    const game = `${state.code}|${state.gameNumber}`; // o servidor numera os jogos de cada sala
    const r = state.result;
    if (state.phase === 'reveal' && r && (r.exact || []).includes(state.me) && r.step > Object.keys(r.answers).length) {
      countOnce(`${game}|exact|${state.round}`, ['exact']);
    }
    if (state.phase === 'end') {
      const won = standingGroups()[0].some((p) => p.id === state.me);
      const stats = ['games'];
      if (won) stats.push('wins');
      if (won && state.players.length >= 6) stats.push('bigWins');
      countOnce(`${game}|end`, stats);
    }
  }

  // --- Boneco (sala de espera) -------------------------------------------------------------
  // Na sala de espera há só um cartão com o boneco e "Editar boneco". O editor abre num painel
  // próprio (ecrã inteiro no telemóvel), com os separadores Cara / Cabelo / Roupa /
  // Acessórios / Festejo (uma secção de cada vez). As mudanças ficam num rascunho e a
  // pré-visualização (fixa no topo do painel) muda logo ao tocar, com um pequeno salto; só
  // "Guardar" as envia ao servidor e as guarda no localStorage (reaplicadas ao entrar numa
  // sala). "Cancelar" deixa o boneco como estava.
  const CO = window.CharacterOptions;
  const { POSES: CHAR_POSES, POSE_LABELS, cleanCharacter, randomCharacter, isUnlocked, unlockOf } = CO;
  let pendingCharacter = null; // boneco guardado e ainda não confirmado pelo servidor
  let draft = null; // rascunho do editor (null = editor fechado)
  let popNext = false; // a próxima pré-visualização dá o salto ("pop")
  let cardKey = null;
  let previewPose = 0;
  let previewAction = null; // 'festejar' | 'triste' durante o "Ver em ação"
  let actionTimers = [];
  let previewKey = null;
  let charTab = 'cara';

  const LIST_OF = {
    face: CO.FACE_SHAPES, eyes: CO.EYES, brows: CO.BROWS, mouth: CO.MOUTHS, faceExtra: CO.FACE_EXTRAS,
    hair: CO.HAIRS, facial: CO.FACIAL, hat: CO.HATS,
    pattern: CO.PATTERNS, extra: CO.EXTRAS, hand: CO.HAND_ITEMS, pet: CO.PETS, aura: CO.AURAS, win: CO.WINS, lose: CO.LOSES,
  };
  const TAB_KEYS = {
    cara: ['face', 'eyes', 'brows', 'mouth', 'faceExtra'], cabelo: ['hair', 'facial', 'hat'],
    roupa: ['pattern', 'extra'], acessorios: ['hand', 'pet', 'aura'], festejo: ['win', 'lose'],
  };
  function unlockLabel(u) {
    const o = LIST_OF[u.key].find((x) => x.id === u.id);
    return o ? o.label : u.id;
  }

  // O boneco que os outros veem (o guardado; o enviado e ainda não confirmado conta já).
  function savedCharacter(me) {
    if (pendingCharacter && JSON.stringify(pendingCharacter) === JSON.stringify(me.character)) pendingCharacter = null;
    return cleanCharacter(pendingCharacter || me.character || {}) || CO.DEFAULT_CHARACTER;
  }

  // Uma peça mudou no editor: só o rascunho (e a pré-visualização dá o salto).
  function setCharacter(change) {
    if (!draft) return;
    const next = cleanCharacter(change, draft);
    if (!next) return;
    if (JSON.stringify(next) !== JSON.stringify(draft)) popNext = true;
    draft = next;
    renderCharacterEditor();
  }

  // Cartão da sala de espera: o boneco guardado (só se redesenha quando muda).
  function renderCharacterCard() {
    const me = player(state.me);
    if (!me) return;
    const ch = savedCharacter(me);
    const key = JSON.stringify([ch, me.color]);
    if (key === cardKey) return;
    cardKey = key;
    $('#char-card-preview').replaceChildren(window.drawCharacter({ ...me, character: ch }, 'parado', { size: 112, withPet: true }));
  }

  // Abrir / guardar / cancelar o editor.
  function openEditor() {
    const me = player(state.me);
    if (!me || state.phase !== 'lobby') return;
    draft = savedCharacter(me);
    previewKey = null;
    popNext = false;
    $('#char-editor').hidden = false;
    document.body.classList.add('sheet-open');
    $('#char-editor-body').scrollTop = 0;
    $('#char-editor-body').classList.remove('compact');
    keepCompact = false;
    renderCharacterEditor();
    $('#char-save').focus();
  }
  function closeEditor() {
    stopAction();
    draft = null;
    $('#char-editor').hidden = true;
    document.body.classList.remove('sheet-open');
    $('#btn-edit-char').focus();
  }
  function saveEditor() {
    if (!draft) return;
    const next = draft;
    pendingCharacter = next;
    store(CHAR_KEY, next);
    act('player:character', next);
    closeEditor();
    renderCharacterCard();
  }
  $('#btn-edit-char').addEventListener('click', openEditor);
  $('#char-card-preview').addEventListener('click', openEditor);
  $('#char-save').addEventListener('click', saveEditor);
  $('#char-cancel').addEventListener('click', closeEditor);
  $('#char-editor').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEditor(); });
  // No telemóvel, a zona fixa no topo (boneco e separadores) encolhe quando se faz scroll e
  // só volta ao tamanho normal lá em cima (com folga, para não ficar a piscar). Depois de mudar
  // de separador já encolhida (`keepCompact`), fica encolhida até se voltar a descer.
  let keepCompact = false;
  $('#char-editor-body').addEventListener('scroll', () => {
    const body = $('#char-editor-body');
    if (body.scrollTop > 24) { body.classList.add('compact'); keepCompact = false; }
    else if (body.scrollTop < 4 && !keepCompact) body.classList.remove('compact');
  }, { passive: true });

  function renderPreview(me, ch) {
    const pose = previewAction || CHAR_POSES[previewPose % CHAR_POSES.length];
    // Nos separadores da cabeça, a cara em grande (em vez da dica da pose).
    const bigFace = (charTab === 'cara' || charTab === 'cabelo') && !previewAction;
    $('#char-face-big').hidden = !bigFace;
    $('#char-pose').hidden = bigFace;
    // Só se redesenha quando algo muda (senão cada atualização do servidor recomeçava a
    // animação).
    const key = JSON.stringify([ch, me.color, pose, bigFace]);
    if (key === previewKey) return;
    previewKey = key;
    if (bigFace) $('#char-face-big').replaceChildren(window.drawFace({ ...me, character: ch }, 'neutro', { size: 92 }));
    $('#char-preview').replaceChildren(window.drawCharacter({ ...me, character: ch }, pose, { size: 150, withPet: true }));
    // Mudou uma peça: o boneco (e a cara em grande) dão um pequeno salto.
    if (popNext) {
      popNext = false;
      for (const node of [$('#char-preview'), $('#char-face-big')]) {
        node.classList.remove('pop');
        void node.offsetWidth;
        node.classList.add('pop');
      }
    }
    $('#char-pose').textContent = previewAction
      ? (previewAction === 'festejar' ? `A festejar: ${CO.WINS.find((w) => w.id === ch.win).label}` : `Reação: ${CO.LOSES.find((l) => l.id === ch.lose).label}`)
      : `${POSE_LABELS[pose]} · toca no boneco para mudar a pose`;
  }

  function renderCharacterEditor() {
    const me = player(state.me);
    if (!me || !draft) return;
    const ch = draft;
    const prog = progress();
    renderPreview(me, ch);

    // Separadores.
    for (const b of $$('.char-tabs [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === charTab));
    for (const p of $$('.char-panel')) p.hidden = p.dataset.panel !== charTab;

    // Círculos de cor (grandes, fáceis de tocar).
    const swatches = (sel, colors, current, onPick, labelOf) => $(sel).replaceChildren(...colors.map(([value, color]) => el('button', {
      type: 'button',
      class: `swatch ${current === value ? 'on' : ''}`,
      style: `--c:${color}`,
      'aria-label': labelOf(value),
      title: labelOf(value),
      onclick: () => onPick(value),
    }, value === null ? el('span', { text: '★', 'aria-hidden': 'true' }) : null)));
    // Cara: tom de pele e cor do cabelo.
    swatches('#char-skin', CO.SKINS.map((c) => [c, c]), ch.skin, (v) => setCharacter({ skin: v }), (v) => `Pele ${v}`);
    swatches('#char-hairColor', CO.HAIR_COLORS.map((c) => [c, c]), ch.hairColor, (v) => setCharacter({ hairColor: v }), (v) => `Cabelo ${v}`);
    // Camisola: a cor do jogador (por omissão) ou outra da paleta.
    swatches('#char-outfit', [[null, me.color], ...CO.COLORS.filter((c) => c !== me.color).map((c) => [c, c])],
      ch.outfit || null, (v) => setCharacter({ outfit: v }), (v) => (v === null ? 'A tua cor' : `Roupa ${v}`));
    swatches('#char-pants', CO.PANTS_COLORS.map((c) => [c, c]), ch.pants, (v) => setCharacter({ pants: v }), (v) => `Calças ${v}`);
    swatches('#char-shoes', CO.SHOE_COLORS.map((c) => [c, c]), ch.shoes, (v) => setCharacter({ shoes: v }), (v) => `Sapatilhas ${v}`);
    [0, 1].forEach((i) => swatches(`#char-scarf${i}`, CO.SCARF_COLORS.map((c) => [c, c]), ch.scarf[i],
      (v) => setCharacter({ scarf: i === 0 ? [v, ch.scarf[1]] : [ch.scarf[0], v] }), (v) => `Cachecol, cor ${i + 1}: ${v}`));

    // Escolhas em botões; as bloqueadas com cadeado (tocar explica como desbloquear).
    const chips = (key) => $(`#char-${key}`).replaceChildren(...LIST_OF[key].map((o) => {
      const open = isUnlocked(key, o.id, prog);
      const u = unlockOf(key, o.id);
      return el('button', {
        type: 'button',
        class: `${ch[key] === o.id ? 'on' : ''} ${open ? '' : 'locked'}`.trim(),
        text: open ? o.label : `🔒 ${o.label}`,
        'aria-disabled': open ? null : 'true',
        title: open ? o.label : `${o.label}: ${u.how}`,
        onclick: () => (open ? setCharacter({ [key]: o.id }) : toast(`🔒 ${o.label}: ${u.how} (${Math.min(prog[u.stat], u.need)}/${u.need}).`)),
      });
    }));
    Object.keys(LIST_OF).forEach(chips);
    $('#char-phrase').replaceChildren(...CO.PHRASES.map((text, i) => el('button', {
      type: 'button', class: ch.phrase === i ? 'on' : '', text: `“${text}”`, onclick: () => setCharacter({ phrase: i }),
    })));

    // Número da camisola (só na de futebol) e cores do cachecol (só com o cachecol na mão).
    $('#char-number-row').hidden = ch.pattern !== 'futebol';
    $('#char-number').textContent = ch.number;
    $('#char-scarf-row').hidden = ch.hand !== 'cachecol';

    // Como desbloquear as peças com cadeado desta secção (com o progresso).
    const locks = CO.UNLOCKS.filter((u) => TAB_KEYS[charTab].includes(u.key) && !isUnlocked(u.key, u.id, prog));
    $('#char-locks').replaceChildren(...locks.map((u) => el('li', {
      text: `🔒 ${unlockLabel(u)} — ${u.how} (${Math.min(prog[u.stat], u.need)}/${u.need})`,
    })));
  }

  for (const b of $$('.char-tabs [data-tab]')) {
    b.addEventListener('click', () => {
      charTab = b.dataset.tab;
      renderCharacterEditor();
      // Os separadores estão na zona fixa: se já se tinha descido, o separador novo começa do
      // início, logo por baixo dela, e a zona continua encolhida.
      const body = $('#char-editor-body');
      if (!body.classList.contains('compact')) return;
      keepCompact = true;
      body.scrollTop = 0;
    });
  }
  for (const b of $$('#char-number-row [data-step]')) {
    b.addEventListener('click', () => {
      if (!draft) return;
      const n = ((draft.number - 1 + Number(b.dataset.step) + 99) % 99) + 1; // 1..99, dá a volta
      setCharacter({ number: n });
    });
  }
  function stopAction() {
    actionTimers.forEach(clearTimeout);
    actionTimers = [];
    previewAction = null;
  }
  $('#char-preview').addEventListener('click', () => {
    stopAction();
    previewPose = (previewPose + 1) % CHAR_POSES.length;
    renderCharacterEditor();
  });
  // "Ver em ação": o festejo e, a seguir, a reação de derrota escolhidos; depois volta ao normal.
  $('#char-action').addEventListener('click', () => {
    stopAction();
    previewPose = 0;
    previewKey = null;
    previewAction = 'festejar';
    renderCharacterEditor();
    actionTimers.push(setTimeout(() => { previewKey = null; previewAction = 'triste'; renderCharacterEditor(); }, 2600));
    actionTimers.push(setTimeout(() => { previewKey = null; previewAction = null; renderCharacterEditor(); }, 5200));
  });
  // Aleatório: todas as peças desbloqueadas.
  $('#char-random').addEventListener('click', () => { stopAction(); setCharacter(randomCharacter(Math.random, progress())); });

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
      $('#btn-map-answer').textContent = mapPick ? TEXTOS.entregar : TEXTOS.tocaNoMapa;
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
    // Em baixo da pauta: a média de pontos da turma (com uma casa decimal).
    const avg = list.closest('.grades') && list.closest('.grades').querySelector('.grades-avg b');
    if (avg && state.players.length) {
      avg.textContent = TEXTOS.pontos(Math.round((state.players.reduce((sum, p) => sum + p.score, 0) / state.players.length) * 10) / 10);
    }
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
  // passos 1..n mostram os palpites pela ordem do servidor (r.order), n+1 a resposta certa e
  // n+2 os pontos, a classificação e os votos.

  // --- Revelação das perguntas de números: tema escolhido pelo servidor ----------------
  // O tema (public/reveal/<id>.js) só desenha; a ordem, o ritmo (passo do servidor), o
  // "Saltar", os sons, o confetti e a lista por baixo são do código comum
  // (public/reveal/index.js e este ficheiro).
  const revealCtl = window.RevealThemes.createController({
    stage: $('#rev-stage'),
    list: $('#rev-guess-list'),
    avatarOf: (id, size) => (player(id) ? avatar(player(id), size) : el('span', { class: `avatar ${size}`, text: '?' })),
    sound: (name) => play(name), // os temas pedem sons (ex.: 'golo'); quem os toca é o código comum
  });

  function renderNumbers(r, order, shown, showCorrect) {
    revealCtl.update({
      key: `${state.code}|${state.round}|${state.question.text}`,
      // Semente da ronda (igual em todos os telemóveis): os temas juntam-lhe o id do jogador.
      seed: `${state.code}|${state.round}`,
      theme: state.question.theme,
      order,
      players: Object.fromEntries(state.players.map((p) => [p.id, { id: p.id, name: p.name, color: p.color, character: p.character }])),
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

  // Revelação das perguntas de mapa: o mapa (pinos, linhas e etiquetas) é desenhado por
  // public/map.js; aqui ficam os nomes, os retratos e a lista por baixo do mapa.
  function renderMapReveal(r, order, shown, showCorrect) {
    const ids = order.slice(0, shown);
    const clsOf = (id) => (showCorrect && r.closest.includes(id) ? 'near' : showCorrect && r.farthest.includes(id) ? 'far' : '');
    window.MapView.drawReveal($('#rev-map'), {
      key: state.round,
      ids,
      answers: r.answers,
      center: r.center,
      country: r.country,
      classOf: clsOf,
      labelOf: (id) => `${nameOf(id)} · ${fmt(r.distances[id])} km`,
      colorOf,
      // (Sem o anel de "tu" nem a coroa: na etiqueta pequena só atrapalhavam.)
      faceOf: (id) => (player(id) ? window.RevealThemes.kit.avatar(player(id), 'xs') : null),
    });

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

  // Confetti leve, desenhado num <canvas> por cima de tudo durante ~2 s. Para não pesar no
  // telemóvel: poucas partículas (menos ainda em ecrãs pequenos), um só de cada vez, e para
  // logo que as partículas saem do ecrã, quando a página fica escondida ou quando o ecrã do
  // jogo muda (stopConfetti). Com movimento reduzido, não há confetti.
  let confettiRun = null; // { frame, canvas }
  function stopConfetti() {
    if (!confettiRun) return;
    cancelAnimationFrame(confettiRun.frame);
    confettiRun.canvas.remove();
    confettiRun = null;
  }
  function confetti() {
    if (reducedMotion() || document.hidden || confettiRun) return;
    const canvas = el('canvas', { class: 'confetti', 'aria-hidden': 'true' });
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    const W = (canvas.width = window.innerWidth);
    const H = (canvas.height = window.innerHeight);
    const colors = ['#f2c230', '#f4f2ea', '#ffe97a', '#4dabf7', '#ff6b5e', '#a6f0bf']; // giz, lápis, post-it, caneta, correção
    const count = W < 500 ? 40 : 60;
    const parts = Array.from({ length: count }, () => ({
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
      let visible = 0;
      for (const p of parts) {
        p.vy += 0.25;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        if (p.y - p.size > H || p.x < -p.size || p.x > W + p.size) continue; // já saiu do ecrã
        visible += 1;
        ctx.setTransform(Math.cos(p.rot), Math.sin(p.rot), -Math.sin(p.rot), Math.cos(p.rot), p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (visible && now - start < 2200 && !document.hidden) confettiRun.frame = requestAnimationFrame(frame);
      else stopConfetti();
    };
    confettiRun = { canvas, frame: requestAnimationFrame(frame) };
  }

  // Animações fora do ecrã (ou em ecrãs escondidos) ficam em pausa: o boneco que "respira" na
  // sala de espera e no editor, os festejos e os brindes do fim e o cenário da revelação.
  // (CSS: .offscreen.) Voltam a andar quando aparecem.
  if ('IntersectionObserver' in window) {
    const visibility = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle('offscreen', !entry.isIntersecting);
    });
    for (const sel of ['#char-card-preview', '#char-preview', '#end-stage', '#end-awards', '#rev-stage']) visibility.observe($(sel));
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
    // Golo (tema "penálti"): fanfarra curta de festejo.
    golo: (c) => [392, 523, 659, 784, 659, 784].forEach((f, i) => tone(c, f, i * 0.07, i === 5 ? 0.4 : 0.12, { type: 'square', gain: 0.06 })),
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

    // Ordem da revelação: a do servidor (aleatória nas perguntas de números, igual para todos;
    // do mais longe para o mais perto nas de mapa).
    const order = r.order || Object.keys(r.answers).sort((a, b) => r.distances[b] - r.distances[a]);
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
      : shown < n ? `Palpite ${shown} de ${n}${isMap ? ' (do mais longe para o mais perto)' : ''}` : '';

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
    // mostrar. Depois só lhe resta "Venha a próxima!".
    const host = isHost();
    // "Saltar" fica logo a seguir ao cenário (no fluxo da página: nunca tapa a lista).
    const stepBtn = $('#btn-step');
    const stepAfter = isMap ? $('#rev-map .map-zoom') : $('#rev-stage');
    if (stepBtn.previousElementSibling !== stepAfter) stepAfter.after(stepBtn);
    stepBtn.hidden = !host || showCorrect;
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
    $('#btn-next').textContent = !last ? TEXTOS.venhaProxima : tied ? 'Ir ao desempate' : 'Ver classificação final';
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
    // A classificação final só se redesenha se mudar alguma coisa (no fim chegam atualizações
    // por outros motivos, ex.: alguém sai ou volta a ligar-se).
    const scoresKey = JSON.stringify([state.me, state.hostId, state.standings, state.tiebreakWinner,
      state.players.map((p) => [p.id, p.name, p.score, p.connected, p.color, p.character])]);
    const scoresBox = $('#end-scores');
    if (scoresBox.dataset.key !== scoresKey) {
      scoresBox.dataset.key = scoresKey;
      renderScores('#end-scores', { size: 'l' });
    }
    // Quem ganhou a festejar, com o seu festejo e o animal (só se redesenha se mudar, para a
    // animação não recomeçar a cada atualização).
    const top = standingGroups()[0].slice(0, 3);
    const stage = $('#end-stage');
    const stageKey = JSON.stringify(top.map((p) => [p.id, p.character]));
    if (stage.dataset.key !== stageKey) {
      stage.dataset.key = stageKey;
      const size = top.length > 2 ? 104 : 132;
      stage.replaceChildren(...top.map((p) => window.drawCharacter(p, 'festejar', { size, withPet: true })));
    }
    const winners = standingGroups()[0].map((p) => p.name);
    $('#end-winner').textContent = winners.length === 1
      ? TEXTOS.ganhou(winners[0])
      : TEXTOS.empate(winners.slice(0, -1).join(', '), winners[winners.length - 1]);
    renderAwards();
    $('#btn-again').hidden = !isHost();
    $('#end-hint').textContent = isHost() ? '' : 'O anfitrião pode começar um novo jogo.';
  }

  render();
})();
