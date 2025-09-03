const fs = require('fs')
const path = require('path');

// Simple XML parser for OSM (not a full parser, assumes well-formed OSM XML)
function parseOSM(xml) {
  const nodes = new Map(); // id -> {lat, lon}
  const ways = [];

  // Extract all nodes
  const nodeRegex = /<node ([^>]+)\/>/g;
  let match;
  while ((match = nodeRegex.exec(xml)) !== null) {
    const attrString = match[1];
    const id = attrString.match(/id="(\d+)"/)[1];
    const lat = parseFloat(attrString.match(/lat="([^"]+)"/)[1]);
    const lon = parseFloat(attrString.match(/lon="([^"]+)"/)[1]);
    nodes.set(id, { lat, lon });
  }

  // Extract ways
  const wayRegex = /<way[^>]*>([\s\S]*?)<\/way>/g;
  while ((match = wayRegex.exec(xml)) !== null) {
    const wayXml = match[1];

    // Extract nd refs
    const ndRefs = [];
    const ndRegex = /<nd ref="(\d+)"\/>/g;
    let ndMatch;
    while ((ndMatch = ndRegex.exec(wayXml)) !== null) {
      ndRefs.push(ndMatch[1]);
    }

    // Extract tags
    const tags = {};
    const tagRegex = /<tag k="([^"]+)" v="([^"]+)"\/>/g;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(wayXml)) !== null) {
      tags[tagMatch[1]] = tagMatch[2];
    }

    ways.push({ ndRefs, tags });
  }

  return { nodes, ways };
}

function osmToGeoJSON(osm) {
  const { nodes, ways } = osm;

  // GeoJSON FeatureCollection
  const features = [];

  // Convert ways to LineString or Polygon if closed
  ways.forEach(way => {
    const coords = way.ndRefs.map(ref => {
      const node = nodes.get(ref);
      if (!node) throw new Error(`Node ${ref} not found`);
      return [node.lon, node.lat];
    });

    let geometry;
    // If first and last coords are same, treat as Polygon
    if (coords.length > 3 && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]) {
      geometry = {
        type: 'Polygon',
        coordinates: [coords],
      };
    } else {
      geometry = {
        type: 'LineString',
        coordinates: coords,
      };
    }

    features.push({
      type: 'Feature',
      geometry,
      properties: way.tags,
    });
  });

  // Convert standalone nodes (not part of any way) to Point features
  // To find nodes not used in ways:
  const usedNodes = new Set();
  ways.forEach(way => way.ndRefs.forEach(ref => usedNodes.add(ref)));

  nodes.forEach((node, id) => {
    if (!usedNodes.has(id)) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [node.lon, node.lat],
        },
        properties: {},
      });
    }
  });

  return {
    type: 'FeatureCollection',
    features,
  };
}

// Main function
function convertOSMtoGeoJSON(inputFile, outputFile) {
  const osmXml = fs.readFileSync(inputFile, 'utf8');
  const osm = parseOSM(osmXml);
  const geojson = osmToGeoJSON(osm);
  fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
  console.log(`Converted ${inputFile} to ${outputFile}`);
}

// Example usage:
const inputPath = './nor.osm';   // Your input OSM XML file
const outputPath = './map.geojson';

convertOSMtoGeoJSON(inputPath, outputPath);

