#!/usr/bin/env node
/* One command per release.
 *
 *   npm run release:patch   (fixes)        1.7.2 -> 1.7.3
 *   npm run release:minor   (new features) 1.7.2 -> 1.8.0
 *   npm run release:major   (breaking)     1.7.2 -> 2.0.0
 *   npm run release:dry     show the plan, change nothing
 *   npm run release:publish only (re)publish the installer for the version already in package.json
 *
 * Sequence (each step stops the release if it fails):
 *   1  preflight      git repo, tag free, no secrets in the bundled .env, CHANGELOG notes, GitHub target
 *   2  bump           package.json + lockfile, CHANGELOG "Unreleased" -> "X.Y.Z - date", build/release-notes.md
 *   3  test           node tests/e2e.js (skip with --skip-tests)
 *   4  commit + tag   "chore(release): vX.Y.Z" and an annotated tag vX.Y.Z
 *   5  source zip     release-zips/marklend-desktop-X.Y.Z.zip
 *   6  publish source git push <branch> and the tag  (BEFORE the installer, so the release tag points at pushed code)
 *   7  distribute     electron-builder --win --publish always -> GitHub Release (installer + latest.yml)
 *                     which is what the in-app auto-updater downloads from.
 *
 *   npm run release:current  release the version ALREADY in package.json (for a delivered update zip whose
 *                            CHANGELOG already has its "## X.Y.Z" section): no bump, same commit/tag/zip/push/publish.
 *
 * Flags: --attach-zip --allow-untagged --dry-run --skip-tests --no-zip --no-push --no-publish --draft --strict --current --remote=<name> --publish-only
 * The GitHub token lives in .env.release (never in .env, which is bundled into the installer). */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const L = require('./lib/release-lib');
const { packageZip, verifyZip } = require('./package-zip');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = (n, d) => { const a = args.find(x => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : d; };
const level = args.find(a => !a.startsWith('--')) || 'patch';
const REMOTE = opt('remote', 'origin');
const p = f => path.join(ROOT, f);
const log = (m = '') => console.log(m);
const step = (n, t) => log(`\n[${n}] ${t}`);
class Stop extends Error {}
const stop = m => { throw new Stop(m); };

function run(cmd, a, o = {}) {
  const r = spawnSync(cmd, a, { cwd: ROOT, encoding: 'utf8', stdio: o.inherit ? 'inherit' : 'pipe', env: o.env || process.env });
  if (r.error) stop(`Could not run ${cmd}: ${r.error.message}`);
  return r;
}
const git = (...a) => run('git', a);
const gitOut = (...a) => { const r = git(...a); return r.status === 0 ? r.stdout.trim() : null; };
const node = (script, a, o = {}) => run(process.execPath, [script, ...a], o);

function releaseToken() {
  if (fs.existsSync(p('.env.release'))) {
    const t = dotenv.parse(fs.readFileSync(p('.env.release'), 'utf8')).GH_TOKEN;
    if (t) return t;
  }
  return process.env.GH_TOKEN || '';
}

function publishTarget(pkg) {
  const pub = pkg.build && pkg.build.publish;
  if (!pub || pub.provider !== 'github' || !pub.owner || !pub.repo || /YOUR_|REPLACE/i.test(pub.owner + pub.repo))
    stop('package.json build.publish must name your GitHub owner and repo (provider "github").');
  return pub;
}

function builderCli() {
  if (process.env.ML_BUILDER) return process.env.ML_BUILDER;            // test hook: stand-in for electron-builder
  try { return require.resolve('electron-builder/cli.js', { paths: [ROOT] }); }
  catch (_) { stop('electron-builder is not installed. Run: npm install'); }
}

/* The published installer is built from the working tree, so the working tree must BE the tagged release.
 * Otherwise an installer for v1.9.1 could silently contain code newer (or older) than the v1.9.1 tag. */
function assertCurrentSource(version) {
  if (flag('allow-untagged')) { log('    --allow-untagged: skipping the "published code equals the tag" check'); return; }
  if (gitOut('rev-parse', '--is-inside-work-tree') !== 'true') return;
  const tagCommit = gitOut('rev-list', '-n1', `v${version}`), head = gitOut('rev-parse', 'HEAD');
  const dirty = (gitOut('status', '--porcelain') || '').split('\n').filter(Boolean);
  if (!tagCommit) stop(`Tag v${version} does not exist, so there is no release to publish. Run a normal release (or npm run release:current), or add --allow-untagged.`);
  if (tagCommit !== head || dirty.length)
    stop(`The code here is not what v${version} was tagged with (${tagCommit !== head ? 'new commits since the tag' : ''}${tagCommit !== head && dirty.length ? ' and ' : ''}${dirty.length ? dirty.length + ' uncommitted file(s)' : ''}).\n    Publishing would ship different code under the same version. Release a new version instead (npm run release:patch), or pass --allow-untagged to publish anyway.`);
}

/* Builds the source zip from the CURRENT files (never reuses an older zip) and attaches it to the GitHub release. */
function sourceZip(version, pkg, { attach }) {
  const z = packageZip(ROOT, p('release-zips'));
  try { verifyZip(ROOT, z.path, version); } catch (e) { stop(`The source zip does not match the current files: ${e.message}. Nothing was attached.`); }
  log('    verified: every file in the zip is identical to the file on disk');
  log(`    ${path.relative(ROOT, z.path)}  (${z.files} files, ${(z.bytes / 1024).toFixed(0)} KB, commit ${String(z.info.commit || 'n/a').slice(0, 8)}${z.info.atTag ? ', = tag' : ', NOT at tag'})`);
  if (attach) {
    const pub = publishTarget(pkg), token = releaseToken();
    if (!token) { log('    (no token: source zip not attached to the GitHub release)'); return z; }
    const r = node(path.join(__dirname, 'attach-source.js'), [pub.owner, pub.repo, `v${version}`, z.path], { env: { ...process.env, GH_TOKEN: token } });
    if (r.status !== 0) log(`    WARNING: could not attach the source zip to the release: ${(r.stderr || r.stdout).trim()}\n    The installer is published. Retry with:  npm run release:zip`);
    else log((r.stdout || '').trimEnd());
  }
  return z;
}

function distribute(version, pkg) {
  const pub = publishTarget(pkg);
  const token = releaseToken();
  if (!token) stop('No GitHub token. Put GH_TOKEN=... in .env.release (see .env.release.example). It must NOT go in .env.');
  log(`    publishing v${version} to github.com/${pub.owner}/${pub.repo} (installer + latest.yml)…`);
  const a = ['--win', '--publish', 'always'];
  if (flag('draft')) a.push('-c.publish.releaseType=draft');
  const r = node(builderCli(), a, { inherit: true, env: { ...process.env, GH_TOKEN: token } });
  if (r.status !== 0) stop(`electron-builder failed (exit ${r.status}). Source is already pushed. Fix the problem, then run: npm run release:publish`);
  if (!flag('no-zip')) sourceZip(version, pkg, { attach: true });
}

function preflight(pkg, next) {
  step(1, 'Preflight');
  if (!gitOut('--version')) stop('git is not installed or not on PATH.');
  if (gitOut('rev-parse', '--is-inside-work-tree') !== 'true')
    stop('This folder is not a git repository. Run once:  git init && git add -A && git commit -m "MarkLend ' + pkg.version + '"  then add your GitHub remote.');
  const branch = gitOut('rev-parse', '--abbrev-ref', 'HEAD');
  if (!branch || branch === 'HEAD') stop('Git is on a detached HEAD. Check out a branch first.');
  if (gitOut('rev-parse', '-q', '--verify', `refs/tags/v${next}`)) stop(`Tag v${next} already exists.`);
  const dirty = gitOut('status', '--porcelain');
  if (dirty && flag('strict')) stop('Working tree has uncommitted changes (--strict):\n' + dirty);
  if (dirty) log(`    note: ${dirty.split('\n').length} uncommitted file(s) will be included in the release commit.`);

  if (!flag('no-push')) {
    if (!gitOut('remote', 'get-url', REMOTE)) stop(`No git remote named "${REMOTE}". Add one:  git remote add ${REMOTE} https://github.com/<owner>/<repo>.git   (or use --no-push)`);
    const lt = run('git', ['ls-remote', '--tags', REMOTE, `refs/tags/v${next}`]);
    if (lt.status === 0 && lt.stdout.trim()) stop(`Tag v${next} already exists on ${REMOTE}.`);
  }

  if (fs.existsSync(p('.env'))) {
    const hit = L.findSecret(fs.readFileSync(p('.env'), 'utf8'));
    if (hit) stop(`.env contains ${hit}. .env is packed INTO the installer, so this would ship the secret to every user.\n    Move it to .env.release (never packaged) and delete it from .env.`);
  }
  if (fs.existsSync(p('index.html'))) {                         // the app must be complete: every script it loads has to exist and ship in the installer
    const html = fs.readFileSync(p('index.html'), 'utf8'), pk = (pkg.build && pkg.build.files) || [];
    for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      if (/^https?:/.test(m[1])) continue;
      if (!fs.existsSync(p(m[1]))) stop(`index.html loads ${m[1]} but that file does not exist. The installer would start with a broken app.`);
      const top = m[1].split('/')[0];
      if (pk.length && !pk.some(g => g === m[1] || g.startsWith(top + '/') || g === top)) stop(`index.html loads ${m[1]} but package.json build.files would not include it.`);
    }
  }
  const files = (pkg.build && pkg.build.files) || [];
  if (files.some(f => /\.env\.release|^\*\*\/\*$|^\*$/.test(f))) stop('package.json build.files would package .env.release. Remove that entry.');

  if (!flag('no-publish')) {
    publishTarget(pkg);
    if (!releaseToken() && !flag('dry-run')) stop('No GitHub token found in .env.release (GH_TOKEN). See .env.release.example, or pass --no-publish.');
  }
  const md = fs.existsSync(p('CHANGELOG.md')) ? fs.readFileSync(p('CHANGELOG.md'), 'utf8') : '';
  if (flag('current')) {
    if (!(L.sectionFor(md, next) || '').trim()) stop(`CHANGELOG.md has no "## ${next}" section to use as the release notes.`);
  } else if (!L.hasUnreleasedNotes(md)) stop('CHANGELOG.md has nothing under "## Unreleased". Describe this release there first (these become the GitHub release notes).');
  log(`    ok: branch ${branch}, tag v${next} free, no secrets in .env, release notes present`);
  return branch;
}

function main() {
  const pkg = L.readJson(p('package.json'));

  if (flag('attach-zip')) {                                   // rebuild the source zip from the current files and attach it, no installer build
    step('•', `Source zip only: v${pkg.version}`);
    assertCurrentSource(pkg.version);
    publishTarget(pkg);
    if (!releaseToken()) stop('No GitHub token. Put GH_TOKEN=... in .env.release.');
    const z = sourceZip(pkg.version, pkg, { attach: true });
    return z;
  }
  if (flag('publish-only')) {
    step('•', `Publish only: v${pkg.version}`);
    assertCurrentSource(pkg.version);
    return distribute(pkg.version, pkg);
  }

  const next = flag('current') ? pkg.version : L.bumpSemver(pkg.version, level);
  log(`MarkLend release: ${flag('current') ? 'current version ' + next : pkg.version + ' -> ' + next}${flag('dry-run') ? '   (dry run: nothing will change)' : ''}`);
  const branch = preflight(pkg, next);

  const plan = [flag('current') ? 'write release notes from CHANGELOG (no version bump)' : 'bump version + CHANGELOG + release notes', flag('skip-tests') ? null : 'run tests', 'commit + tag v' + next,
    flag('no-zip') ? null : 'package marklend-desktop-' + next + '.zip', flag('no-push') ? null : `push ${branch} + v${next} to ${REMOTE}`,
    flag('no-publish') ? null : 'build + publish installer to GitHub Releases'].filter(Boolean);
  if (flag('dry-run')) { log('\nPlan:\n  - ' + plan.join('\n  - ')); return; }

  // 2 bump (kept in memory so a failure before the commit can be rolled back)
  step(2, 'Bump');
  const backup = {};
  for (const f of ['package.json', 'package-lock.json', 'CHANGELOG.md']) if (fs.existsSync(p(f))) backup[f] = fs.readFileSync(p(f), 'utf8');
  const rollback = () => { for (const f in backup) fs.writeFileSync(p(f), backup[f]); try { fs.rmSync(p('build/release-notes.md')); } catch (_) { /* not created */ } };
  const date = new Date().toISOString().slice(0, 10);
  let committed = false;
  try {
    let rolled = backup['CHANGELOG.md'];
    if (!flag('current')) {
      L.setVersion(ROOT, next);
      rolled = L.rollChangelog(backup['CHANGELOG.md'], next, date);
      fs.writeFileSync(p('CHANGELOG.md'), rolled);
    }
    const notes = L.sectionFor(rolled, next) || '';
    fs.mkdirSync(p('build'), { recursive: true });
    fs.writeFileSync(p('build/release-notes.md'), notes + '\n');
    log(flag('current') ? `    release notes for ${next} written from CHANGELOG` : `    package.json ${pkg.version} -> ${next}; CHANGELOG rolled; release notes written`);

    if (!flag('skip-tests')) {
      step(3, 'Tests');
      const t = node(p('tests/e2e.js'), [], { inherit: true });
      if (t.status !== 0) stop('Tests failed. Nothing was committed; version and CHANGELOG restored.');
    }

    step(4, 'Commit and tag');
    git('add', '-A');
    for (const f of (gitOut('diff', '--cached', '--name-only') || '').split('\n').filter(Boolean)) {
      if (/(^|\/)(\.env\.release\.example|\.env\.drizzle\.example|release-lib\.js|release\.test\.js|README\.md|CHANGELOG\.md)$/i.test(f)) continue;
      let txt = ''; try { txt = fs.readFileSync(p(f), 'utf8'); } catch (_) { continue; }
      const hit = L.findSecret(txt);
      if (hit) { git('reset', '-q'); stop(`${f} contains ${hit} and was about to be committed. Nothing was committed.`); }
    }
    if (flag('current') && !(gitOut('diff', '--cached', '--name-only') || '')) {
      log('    nothing new to commit; tagging the current commit');
    } else {
      const c = git('commit', '-m', `chore(release): v${next}`);
      if (c.status !== 0) stop('git commit failed:\n' + (c.stderr || c.stdout));
    }
    committed = true;
    const t = git('tag', '-a', `v${next}`, '-m', `MarkLend ${next}`);
    if (t.status !== 0) stop('git tag failed:\n' + t.stderr);
    log(`    committed and tagged v${next}`);
  } catch (e) {
    if (!committed) { git('reset', '-q'); rollback(); }
    throw e;
  }

  const pkg2 = L.readJson(p('package.json'));
  if (!flag('no-zip')) {
    step(5, 'Source zip');
    sourceZip(next, pkg2, { attach: false });
  }
  if (!flag('no-push')) {
    step(6, 'Publish source');
    for (const a of [['push', REMOTE, branch], ['push', REMOTE, `v${next}`]]) {
      const r = run('git', a, { inherit: true });
      if (r.status !== 0) stop(`git ${a.join(' ')} failed. The release commit and tag exist locally. Fix access, then:  git push ${REMOTE} ${branch} && git push ${REMOTE} v${next}  and  npm run release:publish`);
    }
  }
  if (!flag('no-publish')) { step(7, 'Distribute installer'); distribute(next, pkg2); }

  const dbLine = (L.sectionFor(fs.readFileSync(p('CHANGELOG.md'), 'utf8'), next) || '').split('\n').find(l => /database/i.test(l));
  log(`\nDone: MarkLend v${next}`);
  if (dbLine) log(`  ${dbLine.replace(/^[-*]\s*/, '')}   <- remember to run supabase/schema.sql if this says so`);
  log('  Next sequence: add notes for the following release under "## Unreleased" in CHANGELOG.md.');
}

try { main(); }
catch (e) {
  if (e instanceof Stop) { console.error('\nRelease stopped: ' + e.message); process.exit(1); }
  console.error(e); process.exit(1);
}
