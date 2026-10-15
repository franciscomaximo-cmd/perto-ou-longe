'use strict';

// Temas de revelação das perguntas de NÚMEROS. Quem escolhe o tema é sempre o servidor, no
// início de cada ronda, e envia-o no room:state: todos veem o mesmo, mesmo quem recarrega a
// página ou entra a meio.
//
// Cada id tem de ter o seu ficheiro em public/reveal/<id>.js (registado em
// public/reveal/index.js); há um teste que confirma isso.
const REVEAL_THEMES = ['alvo', 'arco', 'bowling'];

// "Baralho" de temas: baralha, tira um por ronda e só volta a baralhar quando todos tiverem
// saído. O primeiro tema de um baralho novo nunca é igual ao último usado (com 2 ou mais temas).
class ThemeDeck {
  constructor(themes = REVEAL_THEMES, random = Math.random) {
    if (!themes.length) throw new Error('É preciso pelo menos um tema de revelação.');
    this.themes = [...themes];
    this.random = random;
    this.pile = [];
    this.last = null;
  }

  shuffle() {
    const a = [...this.themes];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    // O próximo a sair é o do fim da pilha: não pode ser igual ao último que saiu.
    if (a.length > 1 && a[a.length - 1] === this.last) [a[0], a[a.length - 1]] = [a[a.length - 1], a[0]];
    this.pile = a;
  }

  next() {
    if (!this.pile.length) this.shuffle();
    this.last = this.pile.pop();
    return this.last;
  }
}

module.exports = { REVEAL_THEMES, ThemeDeck };
