'use strict';

/*
 * Temas de revelação das perguntas de NÚMEROS — registo central e código comum.
 * (As perguntas de mapa têm a sua própria revelação, em client.js.)
 *
 * Em cada ronda o SERVIDOR escolhe um tema (server/themes.js) e envia-o no room:state; este
 * ficheiro cria esse tema e vai-lhe pedindo, passo a passo, o que mostrar.
 *
 * Interface de cada tema (um ficheiro por tema em public/reveal/<id>.js, registado com
 * RevealThemes.register(id, () => ({ ... }))):
 *   mount(container, { players, answer, unit, kit, result, seed })
 *       Desenha o cenário vazio. `players` vem já na ordem da revelação (do mais longe para o
 *       mais perto), cada um com { id, name, color, emoji, character, value, precision,
 *       closest, avatar(size) }, para o tema poder planear o espaço de todos desde o início.
 *       `result` = { closest, farthest, exact } (listas de ids) é o que o SERVIDOR calculou:
 *       os temas usam-no tal como vem (ex.: quem marca golo), nunca o recalculam.
 *       `show` = { level, winner, exact, farthest, miss } é a POSIÇÃO DE APRESENTAÇÃO do
 *       jogador (public/reveal/presentation.js), relativa à ronda: os temas desenham o
 *       resultado a partir dela, não da precisão absoluta. O vencedor tem sempre o melhor
 *       resultado (e nunca falha); o "mais longe" sempre o pior; o "em cheio" um destaque extra.
 *       `seed` identifica a ronda: para variar a animação, os temas usam
 *       RevealSeeded.seeded(`${seed}|${id}`) (public/reveal/seeded.js), nunca Math.random(),
 *       para todos os telemóveis (e quem recarrega) verem exatamente o mesmo.
 *       O boneco de cada jogador desenha-se SEMPRE com kit.drawCharacter(player, pose, opções)
 *       (public/reveal/character.js); os temas só escolhem a pose. Para um som, o tema pede-o
 *       ao código comum com kit.sound(nome) (ex.: 'golo').
 *   revealPlayer(player, precision, info)
 *       Anima a vez de UM jogador. info = { value, distance, exact, show, index, total, instant }.
 *       Com instant = true mostra o resultado final sem animação.
 *   revealAnswer(answer, info)
 *       Mostra a resposta certa. info = { closest, farthest, exact, instant } (listas de ids).
 *   skipToEnd()
 *       Mostra tudo de imediato (termina as animações a meio).
 *   destroy()
 *       Limpa animações, temporizadores e eventos.
 *
 * O código COMUM (não cada tema) controla: a ordem (do mais longe para o mais perto), o ritmo
 * (~1,5 s por palpite, dado pelo servidor), o botão "Saltar", os sons, o confetti, o cálculo
 * da precisão (precision.js) e a lista ordenada por baixo da animação.
 *
 * REGRAS que todos os temas têm de cumprir:
 *   1. Tamanho fixo desde o início, sem saltos de layout. No telemóvel ocupa a largura e no
 *      máximo ~45% da altura do ecrã (com mais de 6 jogadores pode ser mais alto, para os
 *      bonecos e os nomes continuarem legíveis).
 *   2. A resposta certa e os "em cheio" nunca ficam tapados; palpites iguais não se sobrepõem.
 *   3. Funciona com 3 a 12 jogadores.
 *   4. Com prefers-reduced-motion mostra logo o resultado final (o código comum passa
 *      instant = true em todas as chamadas).
 *   5. Só SVG, CSS ou canvas desenhados no código, sem imagens externas pesadas; bom
 *      desempenho no iPhone (animar transform/opacity, nada de animações a correr para sempre).
 *   6. O resultado visual é RELATIVO à ronda (player.show): quem ganhou o ponto de "mais
 *      perto" tem sempre o melhor resultado do tema e nunca falha; o "em cheio" tem um destaque
 *      extra; o "mais longe" tem sempre o pior; palpites iguais, o mesmo resultado.
 */
(function (root) {
  const { precisionOf } = root.RevealPrecision;
  const numberFormat = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 3 });
  const reducedMotion = () => root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Peças partilhadas (jogo, temas e página de pré-visualização) -----------------------

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

  const fmt = (n) => numberFormat.format(n);
  const withUnit = (n, unit) => (unit ? `${fmt(n)} ${unit}` : fmt(n));

  // Avatar de um jogador (o mesmo componente em todo o lado): emoji num círculo com gradiente
  // da sua cor. Tamanhos 's' | 'm' | 'l'; flags { me, host, off } dão o anel, a coroa e o cinzento.
  function avatar(p, size = 'm', flags = {}) {
    const cls = ['avatar', size, flags.me ? 'me' : '', flags.host ? 'host' : '', flags.off ? 'off' : '']
      .filter(Boolean).join(' ');
    return el('span', { class: cls, style: `--c:${p.color}`, 'data-player': p.id, 'aria-hidden': 'true' },
      el('span', { class: 'emoji', text: p.emoji || '' }));
  }

  // Número que "rola" do zero até ao valor final (~1 s), com as mesmas casas decimais.
  function countUp(node, value, unit = '') {
    cancelAnimationFrame(node.counting);
    if (reducedMotion() || !Number.isFinite(value)) { node.textContent = withUnit(value, unit); return; }
    const decimals = (String(value).split('.')[1] || '').length;
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / 1000);
      const eased = 1 - (1 - t) ** 3;
      node.textContent = withUnit(t < 1 ? Number((value * eased).toFixed(decimals)) : value, unit);
      if (t < 1) node.counting = requestAnimationFrame(frame);
    };
    node.counting = requestAnimationFrame(frame);
  }
  const stopCount = (node) => cancelAnimationFrame(node.counting);

  // Tamanho da cena SVG (vw × vh): ocupa a largura e, no máximo, `maxVh`% da altura do ecrã.
  // 45% por omissão; com mais de 6 jogadores os temas pedem mais (cena mais alta), para os
  // bonecos e os nomes continuarem legíveis num iPhone. (svh onde existir; senão, vh.)
  function sizeScene(svg, vw, vh, maxVh = 45) {
    svg.style.aspectRatio = `${vw} / ${vh}`;
    svg.style.width = `min(100%, calc(${maxVh}vh * ${vw} / ${vh}))`;
    svg.style.width = `min(100%, calc(${maxVh}svh * ${vw} / ${vh}))`;
  }

  // drawCharacter(player, pose, opções) vem de character.js: os temas só escolhem a pose.
  const kit = { el, fmt, withUnit, avatar, countUp, stopCount, reducedMotion, precisionOf, sizeScene, drawCharacter: root.drawCharacter };

  // --- Registo de temas -------------------------------------------------------------------

  const factories = new Map();
  const DEFAULT_THEME = 'alvo';

  function register(id, factory) { factories.set(id, factory); }
  function create(id) {
    const factory = factories.get(id) || factories.get(DEFAULT_THEME);
    return factory();
  }

  // --- Controlador comum ------------------------------------------------------------------
  // Recebe o estado da revelação (o passo vem do servidor) e traduz em chamadas ao tema. Também
  // desenha a lista ordenada por baixo da animação. `avatarOf(id, size)` desenha o avatar
  // (no jogo, com o anel do "tu" e a coroa do anfitrião).
  function createController({ stage, list, avatarOf, sound = null }) {
    // Sons pedidos pelos temas (tocados pelo código comum, se houver; na pré-visualização, não).
    const themeKit = { ...kit, sound: (name) => { if (sound) sound(name); } };
    let theme = null;
    let key = null;
    let revealed = 0;
    let answerShown = false;
    let shows = {}; // posição de apresentação de cada jogador nesta ronda

    function destroy() {
      if (theme) theme.destroy();
      theme = null;
      key = null;
      stage.replaceChildren();
      list.replaceChildren();
    }

    /**
     * r = { key, seed, theme, order, players: { id: {id, name, color, emoji} }, answers,
     *       distances, correct, unit, shown, showCorrect, closest, farthest, exact }
     * `seed` (igual em todos os telemóveis; por omissão, a key) alimenta a variação dos temas.
     * `order` vem do mais longe para o mais perto; `shown` = quantos palpites já se veem.
     */
    function update(r) {
      const fresh = r.key !== key;
      if (fresh) {
        destroy();
        key = r.key;
        revealed = 0;
        answerShown = false;
        theme = create(r.theme);
        const result = { closest: [...r.closest], farthest: [...r.farthest], exact: [...(r.exact || [])] };
        // Posição de apresentação (relativa à ronda), calculada só aqui para todos os temas.
        shows = root.RevealPresentation.presentationOf(
          r.order.map((id) => ({ id, precision: precisionOf(r.answers[id], r.correct) })),
          result,
        );
        const players = r.order.map((id) => ({
          ...r.players[id],
          id,
          value: r.answers[id],
          precision: precisionOf(r.answers[id], r.correct),
          closest: r.closest.includes(id),
          show: shows[id],
          avatar: (size) => avatarOf(id, size),
        }));
        theme.mount(stage, {
          players,
          answer: r.correct,
          unit: r.unit,
          kit: themeKit,
          result,
          seed: String(r.seed ?? r.key),
        });
        // Lista com uma linha por palpite desde o início (escondida), para não empurrar a página.
        const byDistance = [...r.order].sort((a, b) => r.distances[a] - r.distances[b]);
        list.replaceChildren(...byDistance.map((id) => el('li', { 'data-id': id }, [
          avatarOf(id, 'm'),
          el('span', { class: 'nm', text: r.players[id] ? r.players[id].name : '?' }),
          el('span', { class: 'guess', text: `— ${withUnit(r.answers[id], r.unit)}` }),
          el('span', { class: 'miss', text: ' ' }),
        ])));
      }

      // Entrou a meio (ex.: recarregou a página) ou o anfitrião saltou: mostra sem animar.
      const jumped = !fresh && r.shown - revealed > 1;
      const instant = reducedMotion() || (fresh && r.shown > 1) || jumped;
      for (let i = revealed; i < r.shown; i++) {
        const id = r.order[i];
        const p = { ...r.players[id], id, value: r.answers[id], show: shows[id], avatar: (size) => avatarOf(id, size) };
        theme.revealPlayer(p, precisionOf(r.answers[id], r.correct), {
          value: r.answers[id],
          distance: r.distances[id],
          exact: r.distances[id] === 0,
          show: shows[id],
          index: i,
          total: r.order.length,
          instant,
        });
      }
      revealed = Math.max(revealed, r.shown);
      if (jumped || (fresh && instant && r.shown > 0)) theme.skipToEnd();
      if (r.showCorrect && !answerShown) {
        answerShown = true;
        theme.revealAnswer(r.correct, { closest: r.closest, farthest: r.farthest, exact: r.exact || [], instant });
      }

      // Lista por baixo, em sincronia: cada linha aparece quando o palpite é revelado; "falhou
      // por" só depois da resposta certa (antes disso dava para adivinhá-la).
      const visible = new Set(r.order.slice(0, r.shown));
      for (const li of list.children) {
        const id = li.dataset.id;
        const tied = r.closest.includes(id);
        li.classList.toggle('shown', visible.has(id));
        li.classList.toggle('near', r.showCorrect && tied);
        li.classList.toggle('far', r.showCorrect && r.farthest.includes(id) && !tied);
        li.querySelector('.miss').textContent = r.showCorrect
          ? (r.distances[id] === 0 ? 'em cheio!' : `falhou por ${fmt(r.distances[id])}`)
          : ' ';
      }
    }

    return { update, destroy };
  }

  root.RevealThemes = { register, create, ids: () => [...factories.keys()], createController, kit };
})(window);
