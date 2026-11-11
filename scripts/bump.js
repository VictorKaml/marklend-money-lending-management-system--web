#!/usr/bin/env node
/* Bumps the version only (no git, no build).   node scripts/bump.js [patch|minor|major|x.y.z]
 * npm run release does this for you; use bump on its own when you just want to renumber. */
'use strict';
const path = require('path');
const { readJson, bumpSemver, setVersion } = require('./lib/release-lib');

const root = path.join(__dirname, '..');
const type = process.argv[2] || 'patch';
try {
  const cur = readJson(path.join(root, 'package.json')).version;
  const next = bumpSemver(cur, type);
  setVersion(root, next);
  console.log(`Bumped package.json: ${cur} -> ${next}`);
} catch (e) { console.error('bump failed: ' + e.message); process.exit(1); }
