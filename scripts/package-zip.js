#!/usr/bin/env node
/* Packages the project source as marklend-desktop-<version>.zip in release-zips/.
 *   node scripts/package-zip.js            -> uses the version in package.json
 * Excludes node_modules, build output, git data, the release token file and any *.zip.
 * Refuses to build a zip if a secret (GitHub token, database URL) is found in a file that would be included. */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const path = require('path');
const AdmZip = require('adm-zip');
const { readJson, findSecret, zipExcluded } = require('./lib/release-lib');

function walk(dir, root, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name), rel = path.relative(root, full);
    if (zipExcluded(rel)) continue;
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(full, root, out); else out.push(rel);
  }
  return out;
}

/* Evidence of what went into the zip: version, git commit, whether the tree was clean, and a hash of every file.
 * Lets anyone confirm the package really is the current source (compare "tree" with `npm run package:zip` on another copy). */
function buildInfo(root, pkg, files) {
  const g = (...a) => { const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
  const h = crypto.createHash('sha256');
  for (const rel of files) { h.update(rel + '\0'); h.update(fs.readFileSync(path.join(root, rel))); h.update('\0'); }
  const tagCommit = g('rev-list', '-n1', `v${pkg.version}`);
  const head = g('rev-parse', 'HEAD');
  return {
    name: pkg.name, version: pkg.version, builtAt: new Date().toISOString(), files: files.length, tree: h.digest('hex'),
    commit: head, tag: tagCommit ? `v${pkg.version}` : null, atTag: !!(head && tagCommit === head),
    uncommitted: g('rev-parse', '--is-inside-work-tree') === 'true' ? (g('status', '--porcelain') || '').split('\n').filter(Boolean).length : null
  };
}

function packageZip(root, outDir) {
  const pkg = readJson(path.join(root, 'package.json'));
  const base = `${pkg.name}-${pkg.version}`;
  const files = walk(root, root).sort();
  for (const rel of files) {                                   // secret scan of small text files
    const full = path.join(root, rel);
    if (fs.statSync(full).size > 1.5e6 || /\.(png|ico|woff2?|jpg|jpeg|gif|zip)$/i.test(rel)) continue;
    const hit = findSecret(fs.readFileSync(full, 'utf8'));
    if (hit && !/(^|[\\/])(\.env\.release\.example|\.env\.drizzle\.example|release-lib\.js|release\.test\.js|README\.md|CHANGELOG\.md)$/i.test(rel))
      throw new Error(`Refusing to package: ${rel} contains ${hit}. Remove it first.`);
  }
  const zip = new AdmZip();
  const info = buildInfo(root, pkg, files);
  zip.addFile(path.posix.join(base, 'BUILD-INFO.json'), Buffer.from(JSON.stringify(info, null, 2) + '\n'));
  for (const rel of files) {
    const dir = path.dirname(rel);
    zip.addLocalFile(path.join(root, rel), path.join(base, dir === '.' ? '' : dir));
  }
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, base + '.zip');
  fs.rmSync(out, { force: true });                              // never reuse an older zip of the same version
  zip.writeZip(out);
  return { path: out, files: files.length, bytes: fs.statSync(out).size, name: base + '.zip', info };
}

/* Re-opens a finished zip and proves it IS the current source: every file in the zip is byte-identical to the file on disk,
 * nothing on disk is missing from it, and its package.json carries the expected version. Throws with the first problem. */
function verifyZip(root, zipPath, expectedVersion) {
  const pkg = readJson(path.join(root, 'package.json'));
  const base = `${pkg.name}-${expectedVersion || pkg.version}`;
  const zip = new AdmZip(zipPath);
  const inZip = new Map(zip.getEntries().filter(e => !e.isDirectory).map(e => [e.entryName, e]));
  const zpkg = inZip.get(`${base}/package.json`);
  if (!zpkg) throw new Error(`${path.basename(zipPath)} has no ${base}/package.json`);
  const zv = JSON.parse(zpkg.getData().toString('utf8')).version;
  if (zv !== (expectedVersion || pkg.version)) throw new Error(`zip package.json says ${zv}, expected ${expectedVersion || pkg.version}`);
  for (const rel of walk(root, root)) {
    const e = inZip.get(path.posix.join(base, rel.split(path.sep).join('/')));
    if (!e) throw new Error(`zip is missing ${rel}`);
    if (!e.getData().equals(fs.readFileSync(path.join(root, rel)))) throw new Error(`zip holds an older ${rel} than the one on disk`);
  }
  return true;
}

module.exports = { packageZip, verifyZip };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const r = packageZip(root, path.join(root, 'release-zips'));
  console.log(`Packaged ${r.files} files -> ${path.relative(root, r.path)} (${(r.bytes / 1024).toFixed(0)} KB)`);
}
