'use strict';

// Geografia das perguntas de mapa: contornos dos países do Natural Earth
// (pacote world-atlas, escala 1:110m), os mesmos usados para desenhar public/mapa.svg.

const { feature } = require('topojson-client');
const world = require('world-atlas/countries-110m.json');
const world50 = require('world-atlas/countries-50m.json');

// Países pequenos que não existem à escala 1:110m mas podem ser resposta de uma pergunta de
// mapa: vêm da escala 1:50m (mais detalhada). Malta, Cabo Verde e São Tomé e Príncipe.
const EXTRA_COUNTRIES = ['470', '132', '678'];

// Todos os países do mapa (GeoJSON), na escala 1:110m mais os de EXTRA_COUNTRIES. Também usado
// por scripts/gerar-mapa.js, para o desenho bater certo com as contas.
function countryFeatures() {
  const base = feature(world, world.objects.countries).features;
  const extra = feature(world50, world50.objects.countries).features.filter((f) => EXTRA_COUNTRIES.includes(f.id));
  return base.filter((f) => !EXTRA_COUNTRIES.includes(f.id)).concat(extra);
}

const EARTH_RADIUS_KM = 6371;
const rad = (deg) => (deg * Math.PI) / 180;
const wrapLon = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

function polygonsOf(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

// Países que atravessam a longitude de 180° (Rússia, Fiji…): no mapa, o contorno salta de
// 180 para -180 a meio. "Desdobra-se" cada anel para as longitudes ficarem seguidas (podem
// passar de 180, ex.: a Chukotka da Rússia fica perto de 190), senão o centro, o "dentro do
// país" e as distâncias davam a volta ao mundo.
function unwrapRing(ring) {
  const out = [];
  for (const [lon, lat] of ring) {
    let l = lon;
    if (out.length) {
      const prev = out[out.length - 1][0];
      while (l - prev > 180) l -= 360;
      while (l - prev < -180) l += 360;
    }
    out.push([l, lat]);
  }
  return out;
}

// id ISO numérico (ex.: "586") -> lista de polígonos, cada um com [contorno, ...buracos],
// com os anéis já desdobrados.
const COUNTRIES = new Map(
  countryFeatures()
    .filter((f) => f.id)
    .map((f) => [f.id, polygonsOf(f.geometry).map((rings) => rings.map(unwrapRing))]),
);

function haversine(lat1, lon1, lat2, lon2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function insideRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Um anel desdobrado pode ir além de ±180: experimenta o ponto também com a longitude mais ou
// menos uma volta (ex.: um toque em -179,9° na parte de Fiji que ficou do outro lado).
function insideCountry(polygons, lon, lat) {
  return [lon, lon + 360, lon - 360].some((l) => polygons.some(([outer, ...holes]) => insideRing(l, lat, outer)
    && !holes.some((h) => insideRing(l, lat, h))));
}

// Ponto do segmento mais perto do palpite, numa projeção plana local centrada no palpite
// (os segmentos do mapa são curtos, o erro é pequeno); a distância final é medida na esfera.
function distanceToSegment(lat, lon, [lon1, lat1], [lon2, lat2]) {
  const k = Math.max(Math.cos(rad(lat)), 1e-6);
  const ax = wrapLon(lon1 - lon) * k;
  const ay = lat1 - lat;
  const dx = wrapLon(lon2 - lon1) * k;
  const dy = lat2 - lat1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return haversine(lat, lon, lat + ay + t * dy, lon + (ax + t * dx) / k);
}

function hasCountry(id) {
  return COUNTRIES.has(id);
}

/**
 * Distância, em km, de um palpite { lat, lon } ao país: 0 se o palpite estiver dentro dele,
 * senão a distância até à fronteira mais próxima.
 */
function distanceToCountry(id, { lat, lon }) {
  const polygons = COUNTRIES.get(id);
  if (!polygons) throw new Error(`País desconhecido no mapa: ${id}`);
  if (insideCountry(polygons, lon, lat)) return 0;
  let best = Infinity;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) best = Math.min(best, distanceToSegment(lat, lon, ring[i - 1], ring[i]));
    }
  }
  return Math.round(best);
}

// Centro do maior pedaço do país (centróide do polígono), para assinalar países pequenos no mapa.
function centerOf(id) {
  let best = null;
  for (const [outer] of COUNTRIES.get(id) || []) {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const [x0, y0] = outer[j];
      const [x1, y1] = outer[i];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    if (area && (!best || Math.abs(area) > best.area)) {
      best = { area: Math.abs(area), lon: cx / (3 * area), lat: cy / (3 * area) };
    }
  }
  // (O anel desdobrado pode dar um centro além de ±180: volta a pô-lo dentro do mapa.)
  return best && { lat: Math.round(best.lat * 100) / 100, lon: Math.round(wrapLon(best.lon) * 100) / 100 };
}

module.exports = { distanceToCountry, hasCountry, centerOf, haversine, countryFeatures };
