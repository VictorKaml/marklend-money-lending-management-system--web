/* Release pipeline tests:  node --test tests/release.test.js
 * Runs the real scripts/ in throwaway git repos with a local bare repo as "GitHub" and a stub in place
 * of electron-builder (ML_BUILDER), so no network, token or Windows machine is needed. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const AdmZip = require('adm-zip');
const L = require('../scripts/lib/release-lib');

const REAL = path.join(__dirname, '..');
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

function sh(cwd, cmd, args, env) { return spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }); }

function makeProject(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mlrel-'));
  const proj = path.join(root, 'proj'), remote = path.join(root, 'remote.git');
  fs.mkdirSync(proj);
  fs.cpSync(path.join(REAL, 'scripts'), path.join(proj, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'src')); fs.writeFileSync(path.join(proj, 'src', 'app.js'), 'console.log("hi")\n');
  fs.mkdirSync(path.join(proj, 'tests'));
  fs.writeFileSync(path.join(proj, 'tests', 'e2e.js'), `process.exit(${opts.failTests ? 1 : 0})\n`);
  const pkg = { name: 'marklend-desktop', version: '1.7.2', main: 'main.js', scripts: {}, dependencies: { dotenv: '*' },
    build: { files: ['main.js', 'src/**/*', '.env'], publish: { provider: 'github', owner: opts.owner || 'acme', repo: 'marklend-desktop', releaseType: 'release' }, ...(opts.buildExtra || {}) } };
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(path.join(proj, 'package-lock.json'), JSON.stringify({ name: 'marklend-desktop', version: '1.7.2', lockfileVersion: 3, packages: { '': { name: 'marklend-desktop', version: '1.7.2' } } }, null, 2) + '\n');
  fs.writeFileSync(path.join(proj, 'CHANGELOG.md'), opts.changelog ?? '# Changelog\n\n## Unreleased\n\n- Added the thing\n- Database: no changes\n\n## 1.7.2 — 2026-10-16\n\n- previous\n');
  fs.copyFileSync(path.join(REAL, '.gitignore'), path.join(proj, '.gitignore'));
  fs.writeFileSync(path.join(proj, '.env'), opts.env ?? 'SUPABASE_URL=https://x.supabase.co\nSUPABASE_ANON_KEY=public\n');
  fs.writeFileSync(path.join(proj, 'main.js'), '// main\n');
  if (opts.releaseEnv !== false) fs.writeFileSync(path.join(proj, '.env.release'), opts.releaseEnv ?? `GH_TOKEN=${TOKEN}\n`);
  fs.symlinkSync(path.join(REAL, 'node_modules'), path.join(proj, 'node_modules'));
  // stub electron-builder: records argv and whether the token arrived
  const stub = path.join(root, 'builder-stub.js');
  fs.writeFileSync(stub, `require('fs').writeFileSync(${JSON.stringify(path.join(root, 'builder.json'))}, JSON.stringify({argv:process.argv.slice(2),tokenOk:process.env.GH_TOKEN===${JSON.stringify(TOKEN)}}));process.exit(${opts.builderFails ? 3 : 0})\n`);
  sh(proj, 'git', ['init', '-q', '-b', 'main']);
  sh(proj, 'git', ['config', 'user.email', 't@t.t']); sh(proj, 'git', ['config', 'user.name', 't']);
  sh(proj, 'git', ['add', '-A']); sh(proj, 'git', ['commit', '-q', '-m', 'initial']);
  if (opts.remote !== false) { sh(root, 'git', ['init', '-q', '--bare', remote]); sh(proj, 'git', ['remote', 'add', 'origin', remote]); }
  return { root, proj, remote, stub, builderLog: path.join(root, 'builder.json') };
}
const rel = (P, args) => sh(P.proj, process.execPath, [path.join(P.proj, 'scripts', 'release.js'), ...args], { ML_BUILDER: P.stub, GH_TOKEN: '' });
const read = (P, f) => fs.readFileSync(path.join(P.proj, f), 'utf8');
const ver = P => JSON.parse(read(P, 'package.json')).version;
const tags = P => sh(P.proj, 'git', ['tag']).stdout.trim().split('\n').filter(Boolean);
const clean = P => fs.rmSync(P.root, { recursive: true, force: true });

/* ---------------- pure helpers ---------------- */
test('bumpSemver: patch, minor, major, explicit, and invalid input', () => {
  assert.equal(L.bumpSemver('1.7.2', 'patch'), '1.7.3');
  assert.equal(L.bumpSemver('1.7.2', 'minor'), '1.8.0');
  assert.equal(L.bumpSemver('1.7.2', 'major'), '2.0.0');
  assert.equal(L.bumpSemver('1.7.2', '1.9.0'), '1.9.0');
  assert.throws(() => L.bumpSemver('1.7.2', '1.7.2'), /not greater/);
  assert.throws(() => L.bumpSemver('1.7.2', '1.6.9'), /not greater/);
  assert.throws(() => L.bumpSemver('1.7', 'patch'), /not a plain/);
});
test('changelog: unreleased detection, roll and section extraction', () => {
  const md = '# C\n\n## Unreleased\n\n- (nothing yet)\n\n## 1.0.0 — x\n\n- old\n';
  assert.equal(L.hasUnreleasedNotes(md), false);
  assert.equal(L.hasUnreleasedNotes('## Unreleased\n\n- real note\n'), true);
  assert.equal(L.hasUnreleasedNotes('# no section'), false);
  const rolled = L.rollChangelog('## Unreleased\n\n- a\n- Database: none\n\n## 1.0.0 — x\n\n- old\n', '1.1.0', '2026-01-02');
  assert.match(rolled, /## Unreleased\n\n- \(nothing yet\)\n\n## 1.1.0 — 2026-01-02\n\n- a/);
  assert.equal(L.sectionFor(rolled, '1.1.0'), '- a\n- Database: none');
  assert.equal(L.sectionFor(rolled, '1.0.0'), '- old');
  assert.equal(L.sectionFor(rolled, '9.9.9'), null);
});
test('findSecret: detects tokens without echoing them; ignores the public anon key', () => {
  assert.ok(L.findSecret('GH_TOKEN=abc'));
  assert.ok(L.findSecret('x ' + TOKEN));
  assert.ok(L.findSecret('github_pat_' + 'a'.repeat(30)));
  assert.ok(L.findSecret('DATABASE_URL=postgres://u:p@h/db'));
  assert.equal(L.findSecret('SUPABASE_URL=https://x.supabase.co\nSUPABASE_ANON_KEY=eyJhbGciOi.public\n'), null);
  assert.ok(!String(L.findSecret('GH_TOKEN=abc')).includes('abc'));
});

/* ---------------- full release flow ---------------- */
test('dry run: prints the plan and changes nothing', () => {
  const P = makeProject();
  const before = read(P, 'package.json') + read(P, 'CHANGELOG.md');
  const r = rel(P, ['patch', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1\.7\.2 -> 1\.7\.3/);
  assert.match(r.stdout, /publish installer/);
  assert.equal(read(P, 'package.json') + read(P, 'CHANGELOG.md'), before);
  assert.deepEqual(tags(P), []); assert.ok(!fs.existsSync(path.join(P.proj, 'release-zips')));
  clean(P);
});

test('full release: bump, changelog roll, commit, tag, zip, source push, installer publish', () => {
  const P = makeProject();
  const r = rel(P, ['patch', '--skip-tests']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(ver(P), '1.7.3');
  assert.equal(JSON.parse(read(P, 'package-lock.json')).version, '1.7.3');
  assert.equal(JSON.parse(read(P, 'package-lock.json')).packages[''].version, '1.7.3');
  const cl = read(P, 'CHANGELOG.md');
  assert.match(cl, /## Unreleased\n\n- \(nothing yet\)\n\n## 1\.7\.3 — \d{4}-\d{2}-\d{2}\n\n- Added the thing/);
  assert.match(read(P, 'build/release-notes.md'), /Added the thing/);
  assert.equal(sh(P.proj, 'git', ['log', '-1', '--format=%s']).stdout.trim(), 'chore(release): v1.7.3');
  assert.deepEqual(tags(P), ['v1.7.3']);
  // source published: remote has the branch head and the tag
  const local = sh(P.proj, 'git', ['rev-parse', 'main']).stdout.trim();
  assert.equal(sh(P.remote, 'git', ['rev-parse', 'main']).stdout.trim(), local);
  assert.match(sh(P.remote, 'git', ['tag']).stdout, /v1\.7\.3/);
  assert.equal(sh(P.remote, 'git', ['rev-list', '-n1', 'v1.7.3']).stdout.trim(), local, 'tag points at the pushed commit');
  // installer published with the token, via the stub
  const b = JSON.parse(fs.readFileSync(P.builderLog, 'utf8'));
  assert.deepEqual(b.argv.slice(0, 3), ['--win', '--publish', 'always']);
  assert.equal(b.tokenOk, true);
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN), 'token must never be printed');
  // zip
  const zipPath = path.join(P.proj, 'release-zips', 'marklend-desktop-1.7.3.zip');
  assert.ok(fs.existsSync(zipPath));
  const names = new AdmZip(zipPath).getEntries().map(e => e.entryName);
  assert.ok(names.includes('marklend-desktop-1.7.3/package.json'));
  assert.ok(names.includes('marklend-desktop-1.7.3/src/app.js'));
  assert.ok(names.includes('marklend-desktop-1.7.3/.env'), 'bundled .env (Supabase only) is part of the source zip');
  assert.ok(!names.some(n => /\.env\.release$/.test(n)), 'release token file must not be zipped');
  assert.ok(!names.some(n => /node_modules|\.git\/|release-zips|\.zip$/.test(n)));
  assert.match(r.stdout, /Database: no changes/);
  clean(P);
});

test('--draft publishes as a draft release', () => {
  const P = makeProject();
  assert.equal(rel(P, ['minor', '--skip-tests', '--draft']).status, 0);
  assert.equal(ver(P), '1.8.0');
  assert.ok(JSON.parse(fs.readFileSync(P.builderLog, 'utf8')).argv.includes('-c.publish.releaseType=draft'));
  clean(P);
});

test('sequence: a second release continues from the first (1.7.2 -> 1.7.3 -> 1.7.4)', () => {
  const P = makeProject();
  assert.equal(rel(P, ['patch', '--skip-tests', '--no-publish']).status, 0);
  const again = rel(P, ['patch', '--skip-tests', '--no-publish']);
  assert.notEqual(again.status, 0, 'empty Unreleased must block the next release');
  assert.match(again.stderr, /nothing under "## Unreleased"/);
  fs.writeFileSync(path.join(P.proj, 'CHANGELOG.md'), read(P, 'CHANGELOG.md').replace('- (nothing yet)', '- Second change\n- Database: re-run schema.sql'));
  const r = rel(P, ['patch', '--skip-tests', '--no-publish']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(ver(P), '1.7.4');
  assert.deepEqual(tags(P), ['v1.7.3', 'v1.7.4']);
  assert.match(r.stdout, /Database: re-run schema\.sql/);
  clean(P);
});

test('--publish-only (with --allow-untagged) publishes the current version without touching git or files', () => {
  const P = makeProject();
  const r = rel(P, ['--publish-only', '--allow-untagged']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(ver(P), '1.7.2'); assert.deepEqual(tags(P), []);
  assert.equal(JSON.parse(fs.readFileSync(P.builderLog, 'utf8')).tokenOk, true);
  clean(P);
});

test('--current releases the version already in package.json (delivered update zip): no bump, tagged and pushed', () => {
  const P = makeProject({ changelog: '# Changelog\n\n## Unreleased\n\n- (nothing yet)\n\n## 1.7.2 — 2026-10-16\n\n- shipped notes\n- Database: no changes\n' });
  const before = read(P, 'CHANGELOG.md');
  const r = rel(P, ['--current', '--skip-tests']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(ver(P), '1.7.2');
  assert.equal(read(P, 'CHANGELOG.md'), before, 'changelog untouched');
  assert.match(read(P, 'build/release-notes.md'), /shipped notes/);
  assert.deepEqual(tags(P), ['v1.7.2']);
  assert.equal(sh(P.remote, 'git', ['rev-list', '-n1', 'v1.7.2']).stdout.trim(), sh(P.proj, 'git', ['rev-parse', 'main']).stdout.trim());
  assert.ok(fs.existsSync(path.join(P.proj, 'release-zips', 'marklend-desktop-1.7.2.zip')));
  assert.equal(JSON.parse(fs.readFileSync(P.builderLog, 'utf8')).tokenOk, true);
  clean(P);
});
test('--current refuses when the CHANGELOG has no section for the version', () => {
  const P = makeProject({ changelog: '# C\n\n## Unreleased\n\n- (nothing yet)\n' });
  const r = rel(P, ['--current', '--skip-tests']);
  assert.equal(r.status, 1); assert.match(r.stderr, /no "## 1\.7\.2" section/);
  assert.deepEqual(tags(P), []); clean(P);
});

/* ---------------- safety guards: each must stop BEFORE changing anything ---------------- */
/* ---------------- 1.10.0: the published package is the CURRENT source ---------------- */
function startStub(P, env = {}) {
  return new Promise((resolve, reject) => {
    const log = path.join(P.root, 'gh.log'); fs.writeFileSync(log, '');
    const c = spawn(process.execPath, [path.join(REAL, 'tests', 'gh-stub.js')], { env: { ...process.env, STUB_LOG: log, ...env } });
    c.stdout.once('data', d => resolve({ port: String(d).trim(), log, stop: () => c.kill(), lines: () => fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) }));
    c.once('error', reject);
  });
}
const relApi = (P, args, port) => sh(P.proj, process.execPath, [path.join(P.proj, 'scripts', 'release.js'), ...args], { ML_BUILDER: P.stub, GH_TOKEN: '', ML_GH_API: `http://127.0.0.1:${port}` });
const zipOf = (P, v) => new AdmZip(path.join(P.proj, 'release-zips', `marklend-desktop-${v}.zip`));

test('source zip is rebuilt from the current files and stamped (version, commit, tag, tree hash)', () => {
  const P = makeProject();
  fs.mkdirSync(path.join(P.proj, 'release-zips'));
  fs.writeFileSync(path.join(P.proj, 'release-zips', 'marklend-desktop-1.7.3.zip'), 'STALE OLD ZIP');   // an older package of the same version
  const r = rel(P, ['patch', '--skip-tests', '--no-publish']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const z = zipOf(P, '1.7.3');
  const info = JSON.parse(z.getEntry('marklend-desktop-1.7.3/BUILD-INFO.json').getData().toString());
  const head = sh(P.proj, 'git', ['rev-parse', 'HEAD']).stdout.trim();
  assert.equal(info.version, '1.7.3'); assert.equal(info.commit, head); assert.equal(info.atTag, true); assert.equal(info.uncommitted, 0);
  assert.equal(z.readAsText('marklend-desktop-1.7.3/src/app.js'), 'console.log("hi")\n');
  assert.match(info.tree, /^[0-9a-f]{64}$/);
  assert.equal(JSON.parse(z.readAsText('marklend-desktop-1.7.3/package.json')).version, '1.7.3', 'zip holds the bumped package.json, not the old one');
  clean(P);
});

test('verifyZip proves the zip is the current source and catches a stale file', () => {
  const P = makeProject();
  const { packageZip, verifyZip } = require(path.join(P.proj, 'scripts', 'package-zip.js'));
  const z = packageZip(P.proj, path.join(P.proj, 'release-zips'));
  assert.equal(verifyZip(P.proj, z.path), true);
  fs.writeFileSync(path.join(P.proj, 'src', 'app.js'), 'console.log("edited after packaging")\n');
  assert.throws(() => verifyZip(P.proj, z.path), /older src.app\.js/);
  fs.writeFileSync(path.join(P.proj, 'src', 'new.js'), '1\n');
  assert.throws(() => verifyZip(P.proj, z.path), /older src.app\.js|missing src.new\.js/);
  assert.throws(() => verifyZip(P.proj, z.path, '9.9.9'), /9\.9\.9/);
  clean(P);
});

test('preflight stops when index.html loads a script that is missing or would not ship', () => {
  let P = makeProject();
  fs.writeFileSync(path.join(P.proj, 'index.html'), '<script src="src/app.js"></script><script src="src/gone.js"></script>');
  sh(P.proj, 'git', ['add', '-A']); sh(P.proj, 'git', ['commit', '-qm', 'x']);
  let r = rel(P, ['patch', '--skip-tests', '--no-publish', '--no-push']);
  assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, /src\/gone\.js.*does not exist/);
  clean(P);
  P = makeProject();
  fs.mkdirSync(path.join(P.proj, 'extra')); fs.writeFileSync(path.join(P.proj, 'extra', 'x.js'), '1');
  fs.writeFileSync(path.join(P.proj, 'index.html'), '<script src="extra/x.js"></script>');
  sh(P.proj, 'git', ['add', '-A']); sh(P.proj, 'git', ['commit', '-qm', 'x']);
  r = rel(P, ['patch', '--skip-tests', '--no-publish', '--no-push']);
  assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, /would not include it/);
  clean(P);
  P = makeProject();
  fs.writeFileSync(path.join(P.proj, 'index.html'), '<script src="src/app.js"></script>');
  sh(P.proj, 'git', ['add', '-A']); sh(P.proj, 'git', ['commit', '-qm', 'x']);
  r = rel(P, ['patch', '--skip-tests', '--no-publish', '--no-push']);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /verified: every file in the zip is identical/);
  clean(P);
});

test('publish: builds the installer, then attaches a fresh source zip to the GitHub release (replacing the old asset)', async () => {
  const P = makeProject(), S = await startStub(P);
  try {
    const r = relApi(P, ['patch', '--skip-tests'], S.port);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const q = S.lines();
    assert.ok(q.every(x => x.auth === 'Bearer ' + TOKEN));
    assert.ok(q.some(x => x.method === 'DELETE' && /assets\/99$/.test(x.url)), 'the older zip asset is removed first');
    const up = q.find(x => x.method === 'POST');
    assert.ok(up && /name=marklend-desktop-1\.7\.3\.zip/.test(up.url) && up.type === 'application/zip' && up.head === 'PK' && up.bytes === fs.statSync(path.join(P.proj, 'release-zips', 'marklend-desktop-1.7.3.zip')).size);
    assert.match(r.stdout, /attached marklend-desktop-1\.7\.3\.zip/);
    assert.ok(!(r.stdout + r.stderr).includes(TOKEN));
  } finally { S.stop(); clean(P); }
});

test('publish-only is refused when the code has moved on since the tag (would ship different code under the same version)', async () => {
  const P = makeProject(), S = await startStub(P);
  try {
    assert.equal(relApi(P, ['patch', '--skip-tests'], S.port).status, 0);
    // 1) uncommitted edit
    fs.writeFileSync(path.join(P.proj, 'src', 'app.js'), 'console.log("newer")\n');
    let r = relApi(P, ['--publish-only'], S.port);
    assert.notEqual(r.status, 0); assert.match(r.stderr, /not what v1\.7\.3 was tagged with.*1 uncommitted/s);
    // 2) committed but not released
    sh(P.proj, 'git', ['commit', '-qam', 'more work']);
    r = relApi(P, ['--attach-zip'], S.port);
    assert.notEqual(r.status, 0); assert.match(r.stderr, /new commits since the tag/);
    // 3) explicit override builds from the new code and says it is not at the tag
    r = relApi(P, ['--attach-zip', '--allow-untagged'], S.port);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /NOT at tag/);
    assert.equal(zipOf(P, '1.7.3').readAsText('marklend-desktop-1.7.3/src/app.js'), 'console.log("newer")\n');
  } finally { S.stop(); clean(P); }
});

test('publish-only on a clean, tagged tree rebuilds the zip and attaches it; no tag at all is refused', async () => {
  const P = makeProject(), S = await startStub(P);
  try {
    let r = relApi(P, ['--publish-only'], S.port);
    assert.notEqual(r.status, 0); assert.match(r.stderr, /Tag v1\.7\.2 does not exist/);
    assert.equal(relApi(P, ['patch', '--skip-tests', '--no-zip'], S.port).status, 0);
    fs.rmSync(path.join(P.proj, 'release-zips'), { recursive: true, force: true });
    r = relApi(P, ['--publish-only'], S.port);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(P.proj, 'release-zips', 'marklend-desktop-1.7.3.zip')), 'zip is rebuilt even though it was deleted');
    assert.ok(S.lines().some(x => x.method === 'POST'));
  } finally { S.stop(); clean(P); }
});

test('if attaching the zip fails, the installer stays published and the message says how to retry', async () => {
  const P = makeProject(), S = await startStub(P, { STUB_NO_RELEASE: '1' });
  try {
    const r = relApi(P, ['patch', '--skip-tests'], S.port);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /WARNING: could not attach the source zip/); assert.match(r.stdout, /npm run release:zip/);
    assert.equal(JSON.parse(fs.readFileSync(P.builderLog, 'utf8')).tokenOk, true);
  } finally { S.stop(); clean(P); }
});

function assertUntouched(P, version = '1.7.2') { assert.equal(ver(P), version); assert.deepEqual(tags(P), []); assert.equal(sh(P.proj, 'git', ['log', '--oneline']).stdout.trim().split('\n').length, 1); }

test('guard: a GitHub token in the bundled .env blocks the release', () => {
  const P = makeProject({ env: `SUPABASE_URL=https://x.supabase.co\nGH_TOKEN=${TOKEN}\n` });
  const r = rel(P, ['patch', '--skip-tests']);
  assert.equal(r.status, 1); assert.match(r.stderr, /\.env contains a GitHub token/);
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN));
  assertUntouched(P); clean(P);
});
test('guard: no token for publishing blocks the release (and --no-publish allows it)', () => {
  const P = makeProject({ releaseEnv: false });
  const r = rel(P, ['patch', '--skip-tests']);
  assert.equal(r.status, 1); assert.match(r.stderr, /No GitHub token/); assertUntouched(P);
  assert.equal(rel(P, ['patch', '--skip-tests', '--no-publish']).status, 0);
  clean(P);
});
test('guard: placeholder GitHub owner blocks publishing', () => {
  const P = makeProject({ owner: 'YOUR_GITHUB_USERNAME' });
  const r = rel(P, ['patch', '--skip-tests']);
  assert.equal(r.status, 1); assert.match(r.stderr, /build\.publish must name/); assertUntouched(P); clean(P);
});
test('guard: build.files that would package .env.release is rejected', () => {
  const P = makeProject({ buildExtra: {} });
  const pkg = JSON.parse(read(P, 'package.json')); pkg.build.files.push('.env.release');
  fs.writeFileSync(path.join(P.proj, 'package.json'), JSON.stringify(pkg, null, 2)); sh(P.proj, 'git', ['commit', '-qam', 'x']);
  const r = rel(P, ['patch', '--skip-tests']);
  assert.equal(r.status, 1); assert.match(r.stderr, /would package \.env\.release/); clean(P);
});
test('guard: empty Unreleased notes block the release', () => {
  const P = makeProject({ changelog: '# C\n\n## Unreleased\n\n- (nothing yet)\n\n## 1.7.2 — d\n\n- x\n' });
  const r = rel(P, ['patch', '--skip-tests']);
  assert.equal(r.status, 1); assert.match(r.stderr, /nothing under "## Unreleased"/); assertUntouched(P); clean(P);
});
test('guard: existing tag, missing remote, --strict dirty tree', () => {
  let P = makeProject();
  sh(P.proj, 'git', ['tag', 'v1.7.3']);
  let r = rel(P, ['patch', '--skip-tests']);
  assert.equal(r.status, 1); assert.match(r.stderr, /Tag v1\.7\.3 already exists/); assert.equal(ver(P), '1.7.2'); clean(P);

  P = makeProject({ remote: false });
  r = rel(P, ['patch', '--skip-tests']);
  assert.equal(r.status, 1); assert.match(r.stderr, /No git remote named "origin"/); assertUntouched(P); clean(P);

  P = makeProject(); fs.writeFileSync(path.join(P.proj, 'src', 'new.js'), '1\n');
  r = rel(P, ['patch', '--skip-tests', '--strict']);
  assert.equal(r.status, 1); assert.match(r.stderr, /uncommitted changes/); assert.equal(ver(P), '1.7.2'); clean(P);
});
test('guard: remote already has the tag', () => {
  const P = makeProject();
  sh(P.proj, 'git', ['push', '-q', 'origin', 'main']); sh(P.proj, 'git', ['tag', 'v1.7.3']); sh(P.proj, 'git', ['push', '-q', 'origin', 'v1.7.3']); sh(P.proj, 'git', ['tag', '-d', 'v1.7.3']);
  const r = rel(P, ['patch', '--skip-tests']);
  assert.equal(r.status, 1); assert.match(r.stderr, /already exists on origin/); assert.equal(ver(P), '1.7.2'); clean(P);
});
test('failing tests roll everything back (version, lockfile, changelog, no commit, no tag)', () => {
  const P = makeProject({ failTests: true });
  const before = ['package.json', 'package-lock.json', 'CHANGELOG.md'].map(f => read(P, f));
  const r = rel(P, ['patch', '--no-publish']);
  assert.equal(r.status, 1); assert.match(r.stderr, /Tests failed/);
  assert.deepEqual(['package.json', 'package-lock.json', 'CHANGELOG.md'].map(f => read(P, f)), before);
  assert.ok(!fs.existsSync(path.join(P.proj, 'build', 'release-notes.md')));
  assertUntouched(P); clean(P);
});
test('a token that sneaks into a source file is caught at commit time and nothing is committed', () => {
  const P = makeProject();
  fs.writeFileSync(path.join(P.proj, 'src', 'oops.js'), `const t = "${TOKEN}";\n`);
  const r = rel(P, ['patch', '--skip-tests', '--no-publish']);
  assert.equal(r.status, 1); assert.match(r.stderr, /src\/oops\.js contains a GitHub token/);
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN));
  assert.equal(ver(P), '1.7.2'); assert.deepEqual(tags(P), []);
  assert.equal(sh(P.proj, 'git', ['diff', '--cached', '--name-only']).stdout.trim(), '', 'nothing left staged');
  clean(P);
});
test('push failure leaves the local commit and tag and says how to recover', () => {
  const P = makeProject();
  fs.rmSync(P.remote, { recursive: true, force: true }); fs.mkdirSync(P.remote); // remote exists but is not a repo
  const r = rel(P, ['patch', '--skip-tests', '--no-publish']);
  assert.equal(r.status, 1);
  assert.deepEqual(tags(P), ['v1.7.3']);
  assert.match(r.stderr, /git push origin main .*npm run release:publish/s);
  clean(P);
});
test('installer failure after the source is pushed says to run release:publish', () => {
  const P = makeProject({ builderFails: true });
  const r = rel(P, ['patch', '--skip-tests']);
  assert.equal(r.status, 1); assert.match(r.stderr, /Source is already pushed.*npm run release:publish/s);
  assert.equal(sh(P.remote, 'git', ['rev-parse', 'main']).status, 0); clean(P);
});
test('package-zip refuses to package a file containing a token', () => {
  const P = makeProject();
  fs.writeFileSync(path.join(P.proj, 'src', 'oops.js'), `const t = "${TOKEN}";\n`);
  const r = sh(P.proj, process.execPath, [path.join(P.proj, 'scripts', 'package-zip.js')]);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /Refusing to package: src[\\/]oops\.js/);
  clean(P);
});
test('zipExcluded drops build output and secrets but keeps source', () => {
  for (const f of ['node_modules/x/y.js', '.git/config', 'dist/app.exe', 'build/release-notes.md', '.env.release', '.env.drizzle', 'a.zip', 'release-zips/z.zip'])
    assert.equal(L.zipExcluded(f), true, f);
  for (const f of ['src/core.js', '.env', '.env.example', 'supabase/schema.sql', 'assets/brand/logo.png', 'scripts/release.js'])
    assert.equal(L.zipExcluded(f), false, f);
});
