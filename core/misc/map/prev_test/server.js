import { readdirSync, readFileSync } from 'fs';
import { createServer } from 'http';
import { extname, basename, join } from 'path';
import { URL } from 'url';

// 👇 Paths
const MAP_FOLDER = './shapes/';
const GEOJSON_FOLDER = './';

// --- Shapefile parsing functions (unchanged from your original code) ---

function parseShp(buffer) {
  const features = [];
  const fileLength = buffer.readInt32BE(24) * 2;
  let offset = 100;

  while (offset < fileLength) {
    offset += 8; // skip record header
    const shapeType = buffer.readInt32LE(offset);
    if (shapeType !== 3) break;

    const numParts = buffer.readInt32LE(offset + 36);
    const numPoints = buffer.readInt32LE(offset + 40);

    const parts = [];
    for (let i = 0; i < numParts; i++) {
      parts.push(buffer.readInt32LE(offset + 44 + i * 4));
    }

    const points = [];
    const pointsOffset = offset + 44 + numParts * 4;
    for (let i = 0; i < numPoints; i++) {
      const x = buffer.readDoubleLE(pointsOffset + i * 16);
      const y = buffer.readDoubleLE(pointsOffset + i * 16 + 8);
      points.push([x, y]);
    }

    const coords = [];
    for (let i = 0; i < parts.length; i++) {
      const start = parts[i];
      const end = i + 1 < parts.length ? parts[i + 1] : points.length;
      coords.push(points.slice(start, end));
    }

    features.push({
      type: 'Feature',
      geometry: coords.length > 1
        ? { type: 'MultiLineString', coordinates: coords }
        : { type: 'LineString', coordinates: coords[0] },
      properties: {}
    });

    offset = pointsOffset + numPoints * 16;
  }

  return features;
}

function parseDbf(buffer) {
  const records = [];
  const numRecords = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);

  let fields = [];
  let pos = 32;
  while (buffer[pos] !== 0x0d) {
    const name = buffer.toString('ascii', pos, pos + 11).replace(/\0/g, '').trim();
    const type = String.fromCharCode(buffer[pos + 11]);
    const length = buffer[pos + 16];
    fields.push({ name, type, length });
    pos += 32;
  }

  for (let i = 0; i < numRecords; i++) {
    const offset = headerLength + i * recordLength;
    if (buffer[offset] === 0x2a) continue; // deleted record
    const record = {};
    let fieldPos = offset + 1;
    for (const f of fields) {
      const raw = buffer.toString('ascii', fieldPos, fieldPos + f.length).trim();
      let val = raw;
      if (f.type === 'N' || f.type === 'F') val = Number(raw) || 0;
      record[f.name] = val;
      fieldPos += f.length;
    }
    records.push(record);
  }

  return records;
}

function findLayers() {
  const files = readdirSync(MAP_FOLDER);
  return files
    .filter(f => f.endsWith('.shp'))
    .map(f => basename(f, '.shp'));
}

function joinFeaturesAttributes(features, records) {
  return features.map((f, i) => ({
    ...f,
    properties: records[i] || {}
  }));
}

function loadAllLayers() {
  const layers = {};
  for (const base of findLayers()) {
    try {
      const shpBuf = readFileSync(join(MAP_FOLDER, base + '.shp'));
      const dbfBuf = readFileSync(join(MAP_FOLDER, base + '.dbf'));
      const features = parseShp(shpBuf);
      const records = parseDbf(dbfBuf);
      layers[base] = {
        type: 'FeatureCollection',
        features: joinFeaturesAttributes(features, records),
      };
      console.log(`✔ Loaded shapefile layer: ${base} (${features.length} features)`);
    } catch (e) {
      console.error(`✘ Failed to load shapefile layer ${base}:`, e.message);
    }
  }
  return layers;
}

// --- Load GeoJSON layers (converted from OSM PBF) ---
function findGeojsonLayers() {
  const files = readdirSync(GEOJSON_FOLDER);
  return files
    .filter(f => f.endsWith('.geojson'))
    .map(f => basename(f, '.geojson'));
}

function loadGeojsonLayers() {
  const layers = {};
  for (const base of findGeojsonLayers()) {
    try {
      const geojsonStr = readFileSync(join(GEOJSON_FOLDER, base + '.geojson'), 'utf8');
      const geojson = JSON.parse(geojsonStr);
      layers[base] = geojson;
      console.log(`✔ Loaded geojson layer: ${base} (${geojson.features.length} features)`);
    } catch (e) {
      console.error(`✘ Failed to load geojson layer ${base}:`, e.message);
    }
  }
  return layers;
}

// --- Load all layers ---
const layers = {
  ...loadAllLayers(),
  ...loadGeojsonLayers()
};

// --- HTTP Server ---
createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Vanilla Map Viewer</title>
  <style>
    html, body, canvas { margin:0; padding:0; width:100%; height:100%; overflow:hidden; }
    #layer-select { position: absolute; top: 10px; left: 10px; z-index: 10; background: white; padding: 4px; }
  </style>
</head>
<body>
  <select id="layer-select"></select>
  <canvas id="map"></canvas>
  <script>
    const canvas = document.getElementById('map');
    const ctx = canvas.getContext('2d');
    let width = canvas.width = innerWidth;
    let height = canvas.height = innerHeight;

    let features = [];
    let scale = 1, offsetX = 0, offsetY = 0;
    let dragging = false, startX, startY;
    let bbox = null;

    const project = ([x, y]) => [
      (x + offsetX) * scale,
      height - (y + offsetY) * scale
    ];

    function fitToView() {
      if (!bbox) return;
      const [minX, minY, maxX, maxY] = bbox;
      const dx = maxX - minX;
      const dy = maxY - minY;

      scale = Math.min(width / dx, height / dy) * 0.95;
      offsetX = -minX + (width / scale - dx) / 2;
      offsetY = -minY + (height / scale - dy) / 2;
    }

    function getBoundingBox() {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const f of features) {
        const geom = f.geometry;
        if (!geom) continue;
        let coordsList = [];
        if (geom.type === 'LineString' || geom.type === 'MultiPoint' || geom.type === 'MultiLineString') {
          coordsList = geom.type === 'MultiLineString' ? geom.coordinates.flat() : geom.coordinates;
        } else if (geom.type === 'Point') {
          coordsList = [geom.coordinates];
        } else if (geom.type === 'MultiPolygon' || geom.type === 'Polygon') {
          coordsList = geom.type === 'Polygon' ? geom.coordinates.flat() : geom.coordinates.flat(2);
        }
        for (const [x, y] of coordsList) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
      return [minX, minY, maxX, maxY];
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = '#0077cc';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#0077cc';

      for (const f of features) {
        const geom = f.geometry;
        if (!geom) continue;

        if (geom.type === 'LineString') {
          ctx.beginPath();
          geom.coordinates.map(project).forEach(([x, y], i) => {
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          });
          ctx.stroke();
        } else if (geom.type === 'MultiLineString') {
          geom.coordinates.forEach(line => {
            ctx.beginPath();
            line.map(project).forEach(([x, y], i) => {
              i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.stroke();
          });
        } else if (geom.type === 'Point') {
          const [x, y] = project(geom.coordinates);
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, 2 * Math.PI);
          ctx.fill();
        } else if (geom.type === 'MultiPoint') {
          geom.coordinates.forEach(coord => {
            const [x, y] = project(coord);
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
          });
        } else if (geom.type === 'Polygon') {
          geom.coordinates.forEach(ring => {
            ctx.beginPath();
            ring.map(project).forEach(([x, y], i) => {
              i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.closePath();
            ctx.stroke();
          });
        } else if (geom.type === 'MultiPolygon') {
          geom.coordinates.forEach(polygon => {
            polygon.forEach(ring => {
              ctx.beginPath();
              ring.map(project).forEach(([x, y], i) => {
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
              });
              ctx.closePath();
              ctx.stroke();
            });
          });
        }
      }
    }

    canvas.onmousedown = e => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
    };
    canvas.onmouseup = () => dragging = false;
    canvas.onmousemove = e => {
      if (!dragging) return;
      offsetX += (e.clientX - startX) / scale;
      offsetY -= (e.clientY - startY) / scale;
      startX = e.clientX;
      startY = e.clientY;
      draw();
    };
    canvas.onwheel = e => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      scale *= delta;
      draw();
    };

    async function loadLayer(name) {
      const res = await fetch('/data?layer=' + name);
      const geo = await res.json();
      features = geo.features;
      bbox = getBoundingBox();
      fitToView();
      draw();
    }

    async function loadLayers() {
      const res = await fetch('/layers.json');
      const layerNames = await res.json();
      const sel = document.getElementById('layer-select');
      sel.innerHTML = layerNames.map(name => \`<option>\${name}</option>\`).join('');
      sel.onchange = e => loadLayer(e.target.value);
      loadLayer(layerNames[0]);
    }

    loadLayers();
  </script>
</body>
</html>
    `);
  } else if (url.pathname === '/layers.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.keys(layers)));
  } else if (url.pathname === '/data') {
    const name = url.searchParams.get('layer');
    if (!name || !layers[name]) {
      res.writeHead(404);
      res.end('Layer not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(layers[name]));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(3000, () => {
  console.log('🌐 Server running at http://localhost:3000');
});

