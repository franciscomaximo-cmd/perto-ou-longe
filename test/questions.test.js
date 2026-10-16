'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkQuestions } = require('../scripts/check-questions');

test('verificação das perguntas: o banco atual não tem problemas', () => {
  assert.deepEqual(checkQuestions(require('../server/questions.json')), []);
});

test('verificação das perguntas: apanha os erros mais comuns', () => {
  const ok = { text: 'Quantas patas tem uma aranha?', answer: 8, category: 'animais' };
  const cases = [
    [{ ...ok, category: 'inventada' }, /categoria desconhecida/],
    [{ ...ok, answer: 'oito' }, /resposta não numérica/],
    [{ ...ok, text: 'Quantas patas tem uma aranha' }, /acabar em "\?"/],
    [{ text: 'Qual a altura do Cristo Rei?', answer: 110, category: 'cultura' }, /medida sem unidade/],
    [{ text: 'Qual a área da cidade?', answer: 100, category: 'geografia' }, /medida sem unidade/],
    [{ text: 'Em que ano abriu o museu?', answer: 1969, unit: 'anos', category: 'cultura' }, /não leva unidade/],
    [{ text: 'Quanto custava um café em Portugal?', answer: 0.8, unit: 'euros', category: 'precos' }, /indicar o ano/],
    [{ text: 'Quanto custava um café em 2024?', answer: 0.8, unit: 'euros', category: 'precos' }, /indicar o país/],
    [{ type: 'map', country: '999', label: 'Atlântida', article: 'a', category: 'geografia' }, /país inexistente/],
    [{ type: 'map', country: '620', label: 'Portugal', article: 'um', category: 'geografia' }, /artigo inválido/],
  ];
  for (const [question, error] of cases) {
    const problems = checkQuestions([question]);
    assert.equal(problems.length >= 1, true, `devia falhar: ${JSON.stringify(question)}`);
    assert.match(problems.join('\n'), error);
  }
  assert.deepEqual(checkQuestions([ok]), []);
});

test('verificação das perguntas: apanha repetidas e quase iguais', () => {
  const a = { text: 'Em que ano foi lançado o Game Boy?', answer: 1989, category: 'tecnologia' };
  assert.match(checkQuestions([a, { ...a, text: 'Em que ano foi lançado o Game Boy ?' }]).join(), /repetida/);
  assert.match(checkQuestions([a, { ...a, text: 'Em que ano foi lançado o primeiro Game Boy?' }]).join(), /muito parecida/);
  // Perguntas diferentes que só partilham palavras comuns não contam.
  assert.deepEqual(checkQuestions([a, { ...a, text: 'Em que ano foi lançado o Nokia 3310?', answer: 2000 }]), []);
});
