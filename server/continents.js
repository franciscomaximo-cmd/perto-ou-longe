'use strict';

// Continente de cada país das perguntas de mapa (código ISO numérico), para a pista da carta
// "Cábula". O npm run check-questions confirma que todos os países das perguntas de mapa estão
// aqui. Os países entre dois continentes dizem os dois.
const BY_CONTINENT = {
  'Europa': ['040', '056', '246', '250', '276', '300', '348', '352', '380', '470', '616', '642', '688', '724', '752', '804', '826', '196'],
  'Ásia': ['004', '050', '104', '116', '156', '268', '356', '360', '364', '368', '392', '398', '400', '410', '418', '458', '496', '512', '524', '586', '608', '634', '682', '704', '760', '764', '784', '887', '144', '158'],
  'África': ['012', '024', '072', '120', '132', '148', '231', '288', '404', '434', '450', '466', '504', '508', '516', '566', '624', '678', '686', '706', '710', '729', '834', '894'],
  'América do Norte': ['484', '840'],
  'América Central e Caraíbas': ['044', '192', '320', '388', '591'],
  'América do Sul': ['068', '076', '152', '170', '218', '600', '604', '740', '858', '862'],
  'Oceânia': ['036', '242', '554', '598'],
  'Europa e Ásia': ['643'],
  'Ásia e Europa': ['792'],
};

const CONTINENTS = new Map(Object.entries(BY_CONTINENT).flatMap(([name, codes]) => codes.map((c) => [c, name])));

const continentOf = (country) => CONTINENTS.get(country) || null;

module.exports = { continentOf, CONTINENTS };
