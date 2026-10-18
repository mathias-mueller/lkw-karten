#!/usr/bin/env node

/**
 * Script: download-bayern.mjs
 * 
 * Lädt die OpenStreetMap-Daten für Bayern herunter:
 * 1. Standardmodus: Fragt alle LKW-Beschränkungen (maxheight, maxwidth, maxweight, maxaxleload)
 *    über die Overpass API ab, speichert sie als GeoJSON & JSON und baut daraus (falls
 *    Tippecanoe installiert ist) automatisch die PMTiles-Datei für Leaflet.
 * 2. Mit Flag --pbf: Lädt den kompletten Geofabrik OSM-PBF-Dump für Bayern herunter (ca. 780 MB)
 *    für die lokale Weiterverarbeitung mit Planetiler oder Osmium-Tool.
 *
 * Aufruf:
 *   node scripts/download-bayern.mjs
 *   node scripts/download-bayern.mjs --pbf
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
const PUBLIC_DIR = path.resolve(PROJECT_ROOT, 'public');

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const GEOFABRIK_BAYERN_PBF_URL = 'https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf';

function parseOsmValue(valStr) {
  if (!valStr) return undefined;
  const s = valStr.trim().toLowerCase();
  if (['none', 'default', 'unsigned', 'no', 'yes'].includes(s)) return undefined;

  // Feet and inches (z. B. 13'6")
  const feetInchesMatch = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/);
  if (feetInchesMatch) {
    const feet = parseFloat(feetInchesMatch[1]);
    const inches = feetInchesMatch[2] ? parseFloat(feetInchesMatch[2]) : 0;
    return Math.round((feet * 0.3048 + inches * 0.0254) * 100) / 100;
  }

  const normalized = s.replace(',', '.');
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (match) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && num > 0) {
      if (normalized.includes('lbs') || normalized.includes('pound')) {
        return Math.round((num * 0.000453592) * 100) / 100;
      }
      return num;
    }
  }
  return undefined;
}

/**
 * Baut PMTiles aus dem GeoJSON via Tippecanoe
 */
function buildPmTiles(geoJsonPath) {
  try {
    execSync('tippecanoe --version', { stdio: 'ignore' });
  } catch {
    console.log('\nℹ️ Tippecanoe ist nicht installiert. Überspringe automatische PMTiles-Generierung.');
    console.log('   Installation unter macOS: brew install tippecanoe');
    return;
  }

  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }

  const publicPmTilesPath = path.join(PUBLIC_DIR, 'bayern.pmtiles');
  const dataPmTilesPath = path.join(DATA_DIR, 'bayern.pmtiles');

  console.log('\n🔨 Generiere PMTiles mit Tippecanoe...');
  const cmd = `tippecanoe -o "${publicPmTilesPath}" -z16 -Z0 --drop-densest-as-needed -l restrictions --force "${geoJsonPath}"`;
  execSync(cmd, { stdio: 'inherit' });

  // Kopie nach data/ für Konsistenz
  try {
    fs.copyFileSync(publicPmTilesPath, dataPmTilesPath);
  } catch {
    // Ignore copy error
  }

  const stats = fs.statSync(publicPmTilesPath);
  console.log(`\n🎉 PMTiles erfolgreich erstellt: ${publicPmTilesPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
}

/**
 * Lädt die LKW-Beschränkungen für Bayern über Overpass API herunter und konvertiert sie zu GeoJSON
 */
async function downloadRestrictionsOverpass() {
  console.log('====================================================');
  console.log(' Bayern LKW-Beschränkungsdaten herunterladen (OSM)');
  console.log('====================================================\n');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const query = `
[out:json][timeout:180];
area["ISO3166-2"="DE-BY"]["admin_level"="4"]->.bayern;
(
  node["maxheight"](area.bayern);
  way["maxheight"](area.bayern);
  node["maxwidth"](area.bayern);
  way["maxwidth"](area.bayern);
  node["maxweight"](area.bayern);
  way["maxweight"](area.bayern);
  node["maxaxleload"](area.bayern);
  way["maxaxleload"](area.bayern);
);
out center tags qt;
  `.trim();

  console.log('📡 Sende Overpass-Abfrage für ganz Bayern (Fläche DE-BY)...');
  console.log('   Filter: maxheight, maxwidth, maxweight, maxaxleload (nodes + ways)\n');

  const startTime = Date.now();
  let rawJson = null;
  let usedEndpoint = '';

  for (const endpoint of OVERPASS_ENDPOINTS) {
    console.log(`Versuche Server: ${endpoint}...`);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'LkwKarten-DataPipeline/1.0 (https://github.com/mathiasmuller/lkw-karten)',
        },
        body: 'data=' + encodeURIComponent(query),
      });

      if (!response.ok) {
        console.warn(`⚠️ HTTP ${response.status} von ${endpoint}`);
        continue;
      }

      rawJson = await response.json();
      usedEndpoint = endpoint;
      break;
    } catch (err) {
      console.warn(`⚠️ Fehler bei ${endpoint}:`, err.message);
    }
  }

  if (!rawJson || !Array.isArray(rawJson.elements)) {
    throw new Error('Fehler: Konnte keine Daten von den Overpass-Endpunkten abrufen.');
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Abfrage erfolgreich via ${usedEndpoint} in ${durationSec}s!`);
  console.log(`   Empfangene Roh-Elemente: ${rawJson.elements.length}`);

  // 1. JSON speichern
  const jsonPath = path.join(DATA_DIR, 'bayern-restrictions.json');
  fs.writeFileSync(jsonPath, JSON.stringify(rawJson, null, 2), 'utf8');
  const jsonStats = fs.statSync(jsonPath);
  console.log(`💾 JSON gespeichert: ${jsonPath} (${(jsonStats.size / 1024 / 1024).toFixed(2)} MB)`);

  // 2. Zu GeoJSON FeatureCollection konvertieren (Standard für Tippecanoe / PMTiles)
  console.log('\n🔄 Konvertiere in GeoJSON FeatureCollection für PMTiles/Tippecanoe...');
  
  const features = [];
  let stats = {
    height: 0,
    width: 0,
    weight: 0,
    axleLoad: 0,
    nodes: 0,
    ways: 0,
  };

  for (const el of rawJson.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;

    const tags = el.tags || {};
    const maxHeightVal = parseOsmValue(tags['maxheight']);
    const maxWidthVal = parseOsmValue(tags['maxwidth']);
    const maxWeightVal = parseOsmValue(tags['maxweight']);
    const maxAxleLoadVal = parseOsmValue(tags['maxaxleload']);

    if (maxHeightVal === undefined && maxWidthVal === undefined && maxWeightVal === undefined && maxAxleLoadVal === undefined) {
      continue;
    }

    if (el.type === 'node') stats.nodes++;
    if (el.type === 'way') stats.ways++;
    if (maxHeightVal !== undefined) stats.height++;
    if (maxWidthVal !== undefined) stats.width++;
    if (maxWeightVal !== undefined) stats.weight++;
    if (maxAxleLoadVal !== undefined) stats.axleLoad++;

    features.push({
      type: 'Feature',
      id: `${el.type}/${el.id}`,
      geometry: {
        type: 'Point',
        coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))],
      },
      properties: {
        osmId: el.id,
        osmType: el.type,
        name: tags.name || tags.bridge_name || tags.description || tags.ref || null,
        maxheight: tags.maxheight || null,
        maxheight_val: maxHeightVal ?? null,
        maxwidth: tags.maxwidth || null,
        maxwidth_val: maxWidthVal ?? null,
        maxweight: tags.maxweight || null,
        maxweight_val: maxWeightVal ?? null,
        maxaxleload: tags.maxaxleload || null,
        maxaxleload_val: maxAxleLoadVal ?? null,
        highway: tags.highway || null,
        surface: tags.surface || null,
        layer: tags.layer ? parseInt(tags.layer, 10) : 0,
      },
    });
  }

  const geoJson = {
    type: 'FeatureCollection',
    name: 'bayern_lkw_restrictions',
    crs: {
      type: 'name',
      properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' },
    },
    features,
  };

  const geoJsonPath = path.join(DATA_DIR, 'bayern-restrictions.geojson');
  fs.writeFileSync(geoJsonPath, JSON.stringify(geoJson), 'utf8');
  const geoJsonStats = fs.statSync(geoJsonPath);

  console.log(`💾 GeoJSON gespeichert: ${geoJsonPath} (${(geoJsonStats.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`\n📊 Statistik für Bayern:`);
  console.log(`   - Gültige Beschränkungspunkte: ${features.length}`);
  console.log(`   - Punkte von Nodes:            ${stats.nodes}`);
  console.log(`   - Punkte von Ways/Brücken:     ${stats.ways}`);
  console.log(`   - Höhenbeschränkungen:        ${stats.height}`);
  console.log(`   - Breitenbeschränkungen:      ${stats.width}`);
  console.log(`   - Gewichtsbeschränkungen:     ${stats.weight}`);
  console.log(`   - Achslastbeschränkungen:     ${stats.axleLoad}`);

  // 3. Automatische PMTiles-Generierung, falls Tippecanoe installiert ist
  buildPmTiles(geoJsonPath);
}

/**
 * Lädt den kompletten Geofabrik PBF Dump für Bayern herunter
 */
function downloadBayernPbf() {
  console.log('====================================================');
  console.log(' Geofabrik Bayern PBF Dump herunterladen');
  console.log(' URL: ' + GEOFABRIK_BAYERN_PBF_URL);
  console.log('====================================================\n');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const destPath = path.join(DATA_DIR, 'bayern-latest.osm.pbf');
  const file = fs.createWriteStream(destPath);

  https.get(GEOFABRIK_BAYERN_PBF_URL, (res) => {
    if (res.statusCode !== 200) {
      console.error(`Fehler: Server antwortete mit Status ${res.statusCode}`);
      return;
    }

    const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
    let downloadedBytes = 0;
    let lastLogTime = 0;

    console.log(`Dateigröße: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
    console.log(`Speichere nach: ${destPath}\n`);

    res.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      file.write(chunk);

      const now = Date.now();
      if (now - lastLogTime > 1000) {
        lastLogTime = now;
        const percent = totalBytes > 0 ? ((downloadedBytes / totalBytes) * 100).toFixed(1) : '?';
        const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
        process.stdout.write(`\rFortschritt: ${percent}% (${mb} MB)...`);
      }
    });

    res.on('end', () => {
      file.end();
      console.log(`\n\n✅ Download abgeschlossen! Gespeichert in: ${destPath}`);
      console.log('Du kannst diese Datei nun mit Osmium filtern oder mit Planetiler in Kacheln umwandeln:');
      console.log(`osmium tags-filter ${destPath} nwr/maxheight nwr/maxwidth nwr/maxweight nwr/maxaxleload -o data/bayern-filtered.osm.pbf`);
    });
  }).on('error', (err) => {
    fs.unlink(destPath, () => {});
    console.error('Download-Fehler:', err.message);
  });
}

// CLI Parameter auswerten
const args = process.argv.slice(2);
if (args.includes('--pbf')) {
  downloadBayernPbf();
} else {
  downloadRestrictionsOverpass().catch((err) => {
    console.error('Fehler bei der Ausführung:', err);
    process.exit(1);
  });
}
