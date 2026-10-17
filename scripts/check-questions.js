'use strict';

// Verificação das perguntas (server/questions.json): npm run check-questions
// Confirma, em todas as perguntas:
//   - campos obrigatórios preenchidos e categoria existente;
//   - números: texto que acaba em "?", resposta numérica válida, unidade quando a pergunta é
//     sobre uma medida (altura, peso, velocidade…), anos sem unidade e inteiros;
//   - mapas: país que existe no mapa, nome do país e artigo válido, e nenhum país-ilha pequeno;
//   - "Adivinha o Preço": em euros, com o ano e o país (Portugal) no texto;
//   - nenhuma pede contas de cabeça;
//   - sem duplicados: texto igual ou muito parecido.
// Sai com código 1 se encontrar problemas. (test/questions.test.js usa checkQuestions.)

const { CATEGORIES } = require('../server/rooms');
const { hasCountry, distanceToCountry } = require('../server/geo');

// Palavra inteira, também com acentos (o \b do JavaScript não conhece letras acentuadas).
const wordsRegex = (list) => new RegExp(`(?<!\\p{L})(${list.join('|')})(?!\\p{L})`, 'iu');
// Perguntas sobre uma medida têm de dizer a unidade.
const MEASURE = wordsRegex(['altura', 'altitude', 'comprimento', 'largura', 'distância', 'profundidade', 'diâmetro',
  'envergadura', 'peso', 'pesa', 'pesava', 'velocidade', 'temperatura', 'área', 'dura', 'durou', 'demora', 'tempo',
  'idade', 'custa', 'custava', 'calorias', 'percentagem', 'teor', 'pressão', 'frequência', 'cresce', 'mede']);
// Contas de cabeça (iguais às do teste "nenhuma pergunta pede contas").
const ARITHMETIC = /×|elevado|\bsoma\b|Quanto é|segundos tem|horas tem/;
// Nos preços, o país tem de estar claro.
const PORTUGAL = /Portugal|portugu[eê]s|Lisboa|Porto|nacional/i;

// Países insulares (países-ilha e arquipélagos) mais pequenos do que o Chipre (~9 000 km²):
// quase não se veem no mapa e é impossível acertar dentro deles, por isso não podem ser a
// resposta de uma pergunta de mapa (nem sobre um sítio concreto lá dentro). Código ISO
// numérico → [nome, área aproximada em km²]. Ficam de fora desta lista, de propósito, Cabo
// Verde (132) e São Tomé e Príncipe (678), por serem lusófonos. Os países insulares maiores
// (Chipre, Jamaica, Bahamas, Vanuatu, Fiji…) e os que partilham uma ilha com outro país
// (Brunei, Timor-Leste) podem continuar a sair.
const SMALL_ISLANDS = {
  '028': ['Antígua e Barbuda', 440], '048': ['Barém', 780], '052': ['Barbados', 430],
  '174': ['Comores', 1900], '184': ['Ilhas Cook', 240], '212': ['Dominica', 750], '296': ['Kiribati', 810],
  '308': ['Granada', 340], '462': ['Maldivas', 300], '470': ['Malta', 320], '480': ['Maurícia', 2000],
  '520': ['Nauru', 21], '570': ['Niue', 260], '583': ['Micronésia', 700], '584': ['Ilhas Marshall', 180],
  '585': ['Palau', 460], '659': ['São Cristóvão e Neves', 260], '662': ['Santa Lúcia', 620],
  '670': ['São Vicente e Granadinas', 390], '690': ['Seicheles', 460], '702': ['Singapura', 730],
  '776': ['Tonga', 750], '780': ['Trindade e Tobago', 5100], '798': ['Tuvalu', 26], '882': ['Samoa', 2840],
};

// Duplicados: o mesmo texto (sem maiúsculas, acentos nem pontuação) ou quase o mesmo: as
// mesmas palavras com significado, ou 75% delas em comum e a mesma resposta (o mesmo país,
// nas de mapa).
const STOP = new Set('a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para com sem que qual quais quanto quanta quantos quantas e ou se foi era é tem tinha ao à aos às mais'.split(' '));
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const meaningful = (s) => new Set(norm(s).split(' ').filter((w) => w && !STOP.has(w)));

function checkQuestions(questions) {
  const categoryIds = new Set(CATEGORIES.map((c) => c.id));
  const problems = [];
  const where = (q, i) => `#${i + 1} [${q.category}] ${q.text || `mapa: ${q.label}`}`;
  const fail = (q, i, msg) => problems.push(`${where(q, i)}\n    → ${msg}`);

  questions.forEach((q, i) => {
    if (!categoryIds.has(q.category)) fail(q, i, `categoria desconhecida: ${q.category}`);
    if (q.curiosity !== undefined && (typeof q.curiosity !== 'string' || !q.curiosity.trim())) fail(q, i, 'curiosidade vazia');
    if (q.type === 'map') {
      const island = SMALL_ISLANDS[q.country];
      if (island) fail(q, i, `país-ilha demasiado pequeno para o mapa: ${island[0]} (~${island[1]} km², menos do que o Chipre)`);
      else if (!hasCountry(q.country)) fail(q, i, `país inexistente no mapa: ${q.country}`);
      // Ponto de referência de um sítio concreto: coordenadas válidas e no país certo (até 25 km
      // de folga, porque os contornos do mapa são simplificados junto à costa).
      if (q.point !== undefined) {
        const { lat, lon } = q.point || {};
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) fail(q, i, 'ponto de referência inválido');
        else if (hasCountry(q.country) && distanceToCountry(q.country, q.point) > 25) fail(q, i, `o ponto de referência fica a ${distanceToCountry(q.country, q.point)} km do país`);
      }
      if (!q.label || !q.label.trim()) fail(q, i, 'falta o nome do país (label)');
      if (!['', 'o', 'a', 'os', 'as'].includes(q.article)) fail(q, i, `artigo inválido: ${JSON.stringify(q.article)}`);
      if (q.text !== undefined && !/\?$/.test(q.text)) fail(q, i, 'o texto tem de acabar em "?"');
      return;
    }
    if (q.type !== undefined && q.type !== 'number') fail(q, i, `tipo desconhecido: ${q.type}`);
    if (typeof q.text !== 'string' || !q.text.trim()) { fail(q, i, 'falta o texto'); return; }
    if (!/\?$/.test(q.text)) fail(q, i, 'o texto tem de acabar em "?"');
    if (typeof q.answer !== 'number' || !Number.isFinite(q.answer)) fail(q, i, `resposta não numérica: ${JSON.stringify(q.answer)}`);
    if (q.unit !== undefined && (typeof q.unit !== 'string' || !q.unit.trim())) fail(q, i, 'unidade vazia');
    if (ARITHMETIC.test(q.text)) fail(q, i, 'pede contas de cabeça');
    if (/^Em que ano\b/.test(q.text)) {
      if (!Number.isInteger(q.answer)) fail(q, i, 'um ano tem de ser um número inteiro');
      if (q.unit && q.unit !== 'a.C.') fail(q, i, `um ano não leva unidade (tem "${q.unit}")`);
    } else if (MEASURE.test(q.text) && !q.unit) {
      fail(q, i, 'pergunta sobre uma medida sem unidade');
    }
    if (q.category === 'precos') {
      if (q.unit !== 'euros') fail(q, i, 'os preços são em euros');
      if (!/\b(19|20)\d\d\b/.test(q.text)) fail(q, i, 'o preço tem de indicar o ano');
      if (!PORTUGAL.test(q.text)) fail(q, i, 'o preço tem de indicar o país (Portugal)');
    }
  });

  const items = questions.map((q, i) => ({
    q, i,
    words: meaningful(q.text || `onde fica ${q.label}`),
    key: q.text ? norm(q.text) : `mapa ${q.country} ${q.note || ''}`,
    answer: q.type === 'map' ? q.country : q.answer,
  }));
  for (let a = 0; a < items.length; a++) {
    const A = items[a];
    for (let b = a + 1; b < items.length; b++) {
      const B = items[b];
      if (A.key === B.key) { fail(B.q, B.i, `repetida (igual a ${where(A.q, A.i)})`); continue; }
      if ((A.q.type === 'map') !== (B.q.type === 'map')) continue;
      const common = [...A.words].filter((w) => B.words.has(w)).length;
      const similarity = common / Math.max(1, new Set([...A.words, ...B.words]).size);
      if (similarity >= 0.75 && A.answer === B.answer) {
        fail(B.q, B.i, `muito parecida com ${where(A.q, A.i)} (e com a mesma resposta)`);
      } else if (A.words.size >= 3 && similarity === 1) {
        fail(B.q, B.i, `muito parecida com ${where(A.q, A.i)}`);
      }
    }
  }
  return problems;
}

module.exports = { checkQuestions };

if (require.main === module) {
  const questions = require('../server/questions.json');
  const problems = checkQuestions(questions);
  console.log(`${questions.length} perguntas:`);
  for (const c of CATEGORIES) {
    const all = questions.filter((q) => q.category === c.id);
    const maps = all.filter((q) => q.type === 'map').length;
    console.log(`  ${c.label.padEnd(28)} ${String(all.length).padStart(4)}${maps ? `  (${maps} de mapa)` : ''}`);
  }
  if (problems.length) {
    console.log(`\n${problems.length} problema(s):\n${problems.join('\n')}`);
    process.exit(1);
  }
  console.log('\nTudo certo.');
}
