/* Stand-in for the GitHub releases API, used by tests/release.test.js (runs as a separate process so spawnSync tests don't block it).
 *   STUB_LOG=<file> STUB_TAG=v1.7.3 node tests/gh-stub.js   -> prints the port, logs every request as a JSON line. */
'use strict';
const http = require('http'), fs = require('fs');
const tag = process.env.STUB_TAG || 'v1.7.3', log = process.env.STUB_LOG, noRelease = process.env.STUB_NO_RELEASE === '1';
const srv = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    fs.appendFileSync(log, JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], bytes: body.length, head: body.slice(0, 2).toString('latin1') }) + '\n');
    const port = srv.address().port, send = (c, j) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(j === undefined ? '' : JSON.stringify(j)); };
    if (req.method === 'GET' && /^\/repos\/[^/]+\/[^/]+\/releases/.test(req.url))
      return send(200, noRelease ? [] : [{ tag_name: tag, id: 7, upload_url: `http://127.0.0.1:${port}/upload/7/assets{?name,label}`, assets: [{ id: 99, name: `marklend-desktop-${tag.slice(1)}.zip` }, { id: 5, name: 'latest.yml' }] }]);
    if (req.method === 'DELETE' && /\/releases\/assets\/\d+$/.test(req.url)) return send(204);
    if (req.method === 'POST' && /^\/upload\/7\/assets\?name=/.test(req.url)) return send(201, { id: 100 });
    send(404, { message: 'Not Found' });
  });
});
srv.listen(0, '127.0.0.1', () => console.log(srv.address().port));
