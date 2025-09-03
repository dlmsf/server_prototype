import http from 'http'
import fs from 'fs'
import path from 'path'

const PORT = 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    // Serve index.html
    fs.readFile('./index.html', 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading index.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/map.geojson') {
    // Serve the geojson file
    fs.readFile('./map.geojson', 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('GeoJSON not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
