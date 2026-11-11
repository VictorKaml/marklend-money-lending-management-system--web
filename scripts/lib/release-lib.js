/* Pure helpers shared by scripts/bump.js, scripts/release.js and scripts/package-zip.js.
 * No side effects at import time, so tests/release.test.js can exercise them directly. */
'use strict';
const fs = require('fs');
const path = require('path');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function parseSemver(v) {
  const m = SEMVER.exec(String(v || '').trim());
  if (!m) throw new Error(`"${v}" is not a plain MAJOR.MINOR.PATCH version`);
  return m.slice(1).map(Number);
}

/** type: 'patch' | 'minor' | 'major' | an explicit "x.y.z" (must be greater than current). */
function bumpSemver(current, type) {
  const [ma, mi, pa] = parseSemver(current);
  if (type === 'major') return `${ma + 1}.0.0`;
  if (type === 'minor') return `${ma}.${mi + 1}.0`;
  if (type === 'patch') return `${ma}.${mi}.${pa + 1}`;
  const next = parseSemver(type);
  const cur = [ma, mi, pa];
  for (let i = 0; i < 3; i++) {
    if (next[i] > cur[i]) return next.join('.');
    if (next[i] < cur[i]) break;
  }
  throw new Error(`Version ${type} is not greater than the current ${current}`);
}

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n');

/** Writes the version into package.json and, when present, the two version fields of package-lock.json. */
function setVersion(root, version) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = readJson(pkgPath);
  const old = pkg.version;
  pkg.version = version;
  writeJson(pkgPath, pkg);
  const lockPath = path.join(root, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = readJson(lockPath);
    lock.version = version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = version;
    writeJson(lockPath, lock);
  }
  return old;
}

/* ---------- CHANGELOG ----------
 * Convention: new work is described under "## Unreleased". A release renames that heading to
 * "## X.Y.Z — YYYY-MM-DD" and opens a fresh empty "## Unreleased" above it. The released
 * section becomes the GitHub release notes. */
const UNRELEASED = /^##\s+Unreleased\s*$/im;
const PLACEHOLDER = /^\s*[-*]\s*\(?nothing yet\)?\s*$/i;

function unreleasedBody(md) {
  const m = UNRELEASED.exec(md);
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(/^##\s/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}
function hasUnreleasedNotes(md) {
  const body = unreleasedBody(md);
  if (!body) return false;
  return body.split('\n').some(l => l.trim() && !PLACEHOLDER.test(l) && !/^<!--.*-->$/.test(l.trim()));
}
function rollChangelog(md, version, date) {
  const m = UNRELEASED.exec(md);
  if (!m) throw new Error('CHANGELOG.md has no "## Unreleased" section');
  const heading = `## Unreleased\n\n- (nothing yet)\n\n## ${version} — ${date}`;
  const tail = md.slice(m.index + m[0].length).replace(/^\r?\n+/, '');
  return md.slice(0, m.index) + heading + '\n\n' + tail;
}
function sectionFor(md, version) {
  const re = new RegExp(`^##\\s+\\[?${version.replace(/\./g, '\\.')}\\]?(?:\\s.*)?$`, 'm');
  const m = re.exec(md);
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(/^##\s/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/* ---------- secrets ---------- */
const TOKEN_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,        // GitHub classic / OAuth / app tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,      // GitHub fine-grained tokens
  /^\s*GH_TOKEN\s*=\s*\S+/m,               // any GH_TOKEN assignment
  /^\s*GITHUB_TOKEN\s*=\s*\S+/m
];
/** Returns a description of the first secret found in text, or null. Never returns the secret itself. */
function findSecret(text) {
  for (const re of TOKEN_PATTERNS) if (re.test(text)) return 'a GitHub token (GH_TOKEN / ghp_… / github_pat_…)';
  if (/^\s*(DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*\S+/m.test(text)) return 'a database URL or service-role key';
  return null;
}

/* ---------- source zip ---------- */
const ZIP_EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'build-resources', 'release-zips', 'drizzle', '.claude']);
const ZIP_EXCLUDE_FILES = [/^\.env\.release$/, /^\.env\.drizzle$/, /\.zip$/i, /^npm-debug\.log/, /^\.DS_Store$/];
function zipExcluded(rel) {
  const parts = rel.split(/[\\/]/);
  if (parts.some(p => ZIP_EXCLUDE_DIRS.has(p))) return true;
  const base = parts[parts.length - 1];
  return ZIP_EXCLUDE_FILES.some(re => re.test(base));
}

module.exports = { parseSemver, bumpSemver, setVersion, readJson, writeJson, unreleasedBody, hasUnreleasedNotes,
  rollChangelog, sectionFor, findSecret, zipExcluded, ZIP_EXCLUDE_DIRS };
