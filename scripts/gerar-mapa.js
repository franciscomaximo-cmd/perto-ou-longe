'use strict';

// Gera public/mapa.svg, o mapa-mundo em branco das perguntas de mapa.
// Projeção equirretangular (longitude e latitude em linha reta), cortada entre
// as latitudes do cliente (MAP_TOP e MAP_BOTTOM em public/client.js), sem a Antártida.
// Correr de novo só se mudarem os dados ou o recorte: node scripts/gerar-mapa.js

const fs = require('fs');
const path = require('path');
const { feature } = require('topojson-client');
const world = require('world-atlas/countries-110m.json');

const TOP = 84;
const BOTTOM = -58;
const SCALE = 4; // píxeis por grau
const width = 360 * SCALE;
const height = (TOP - BOTTOM) * SCALE;

const x = (lon) => ((lon + 180) * SCALE).toFixed(1);
const y = (lat) => ((TOP - lat) * SCALE).toFixed(1);
const ringPath = (ring) => `M${ring.map(([lon, lat]) => `${x(lon)},${y(lat)}`).join('L')}Z`;

// Contornos que cruzam a linha das 180° (Rússia, Fiji…) dariam riscos de lado a lado do mapa.
// Torna as longitudes contínuas e, se o contorno sair do mapa, desenha-o também do outro lado.
function ringPaths(ring) {
  const unwrapped = [];
  for (const [lon, lat] of ring) {
    let l = lon;
    const prev = unwrapped.length ? unwrapped[unwrapped.length - 1][0] : l;
    while (l - prev > 180) l -= 360;
    while (l - prev < -180) l += 360;
    unwrapped.push([l, lat]);
  }
  const lons = unwrapped.map(([l]) => l);
  const parts = [ringPath(unwrapped)];
  if (Math.max(...lons) > 180) parts.push(ringPath(unwrapped.map(([l, lat]) => [l - 360, lat])));
  if (Math.min(...lons) < -180) parts.push(ringPath(unwrapped.map(([l, lat]) => [l + 360, lat])));
  return parts.join('');
}

const paths = feature(world, world.objects.countries).features
  .filter((f) => f.id !== '010') // Antártida
  .map((f) => {
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const d = polygons.flat().map(ringPaths).join('');
    return `<path${f.id ? ` data-c="${f.id}"` : ''} d="${d}"/>`;
  });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${paths.join('')}</svg>\n`;
const out = path.join(__dirname, '..', 'public', 'mapa.svg');
fs.writeFileSync(out, svg);
console.log(`Mapa gerado: ${out} (${(svg.length / 1024).toFixed(0)} KB)`);
