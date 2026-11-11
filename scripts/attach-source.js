#!/usr/bin/env node
/* Attaches the source zip to the GitHub release of a version, replacing any older asset of the same name.
 *   GH_TOKEN=... node scripts/attach-source.js <owner> <repo> <tag> <zipPath>
 * ML_GH_API overrides https://api.github.com (tests). Exit 0 on success, 1 on failure (message on stderr). */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const [owner, repo, tag, zipPath] = process.argv.slice(2);
const token = process.env.GH_TOKEN || '';
const API = (process.env.ML_GH_API || 'https://api.github.com').replace(/\/$/, '');
if (!owner || !repo || !tag || !zipPath || !token) { console.error('usage: GH_TOKEN=... attach-source.js <owner> <repo> <tag> <zip>'); process.exit(1); }

function call(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method, headers: { 'User-Agent': 'marklend-release', Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, ...(body ? { 'Content-Length': body.length } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { /* not json */ }
        if (res.statusCode >= 300) reject(new Error(`${method} ${u.pathname} -> ${res.statusCode} ${(j && j.message) || t.slice(0, 120)}`)); else resolve(j); });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

(async () => {
  const name = path.basename(zipPath), data = fs.readFileSync(zipPath);
  const list = await call('GET', `${API}/repos/${owner}/${repo}/releases?per_page=50`);   // includes drafts
  const rel = (list || []).find(r => r.tag_name === tag);
  if (!rel) throw new Error(`No GitHub release for ${tag} yet. Publish the installer first (npm run release:publish).`);
  for (const a of rel.assets || []) if (a.name === name) await call('DELETE', `${API}/repos/${owner}/${repo}/releases/assets/${a.id}`);
  const upload = String(rel.upload_url || '').replace(/\{.*$/, '');
  await call('POST', `${upload}?name=${encodeURIComponent(name)}`, data, { 'Content-Type': 'application/zip' });
  console.log(`    attached ${name} (${(data.length / 1024).toFixed(0)} KB) to release ${tag}`);
})().catch(e => { console.error(e.message); process.exit(1); });
