'use strict';

// Temas de revelação das perguntas de NÚMEROS. Quem escolhe o tema é sempre o servidor, no
// início de cada ronda, e envia-o no room:state: todos veem o mesmo, mesmo quem recarrega a
// página ou entra a meio.
//
// Cada id tem de ter o seu ficheiro em public/reveal/<id>.js (registado em
// public/reveal/index.js); há um teste que confirma isso.
// (O tema "alvo" saiu do baralho: continua em public/reveal/alvo.js, na página de
// pré-visualização e como reserva se chegar um tema desconhecido.)
const REVEAL_THEMES = ['arco', 'bowling', 'karts', 'penalti', 'dardos', 'golfe', 'malha', 'basquete'];

// "Baralho" de temas: baralha, tira um por ronda e só volta a baralhar quando todos tiverem
// saído. Cada sala tem o seu (criado com a sala). Cada vez que acaba, é baralhado de novo com
// Math.random (sem semente fixa), e:
//   - o primeiro tema do baralho novo nunca é igual ao último usado (com 2 ou mais temas);
//   - a ordem nova nunca é igual à do baralho anterior (com 3 ou mais temas; com 2, a regra
//     de cima obriga a alternar e a ordem repete-se forçosamente).
class ThemeDeck {
  constructor(themes = REVEAL_THEMES, random = Math.random) {
    if (!themes.length) throw new Error('É preciso pelo menos um tema de revelação.');
    this.themes = [...themes];
    this.random = random;
    this.pile = [];
    this.last = null;
    this.lastOrder = null; // ordem de saída do baralho anterior
  }

  shuffle() {
    const order = () => {
      const a = [...this.themes];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const ok = (a) => (a.length < 2 || a[0] !== this.last)
      && (a.length < 3 || !this.lastOrder || a.join() !== this.lastOrder.join());
    let a = order();
    for (let tries = 0; tries < 50 && !ok(a); tries++) a = order();
    // Garantia (se o gerador insistir): roda a ordem até o primeiro não ser o último usado.
    if (a.length > 1 && a[0] === this.last) a.push(a.shift());
    this.lastOrder = a;
    // A pilha tira do fim: guarda-se ao contrário para sair pela ordem `a`.
    this.pile = [...a].reverse();
  }

  next() {
    if (!this.pile.length) this.shuffle();
    this.last = this.pile.pop();
    return this.last;
  }
}

module.exports = { REVEAL_THEMES, ThemeDeck };
