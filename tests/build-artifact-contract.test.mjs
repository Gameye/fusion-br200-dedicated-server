import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The manifest BR200ServerBuild.cs writes: every file that ships, as .dockerignore decides.
function manifestSha256(root) {
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [relative(root, path).split(sep).join('/')];
  });
  const ships = (rel) => {
    const parts = rel.split('/');
    if (parts.length === 1) return !rel.endsWith('.json');
    return !parts[0].endsWith('BackUpThisFolder_ButDontShipItWithYourGame') && !parts[0].endsWith('BurstDebugInformation_DoNotShip');
  };
  const sha = (data) => createHash('sha256').update(data).digest('hex');
  const files = walk(root).filter(ships).sort();
  return sha(files.map((rel) => `${sha(readFileSync(join(root, rel)))}  ${rel}\n`).join(''));
}

// invalid: report | architecture | data | stale | no-manifest. git: root | nested | none.
function probe(optimization, invalid, git = 'root') {
  const root = mkdtempSync(resolve(tmpdir(), 'br200-build-guard-'));
  const output = resolve(root, 'Builds/linux-server');
  const tools = resolve(root, 'tools');
  const marker = resolve(root, 'docker-args');
  try {
    mkdirSync(output, { recursive: true });
    mkdirSync(resolve(root, 'scripts'));
    mkdirSync(tools);
    const script = resolve(root, 'scripts/docker-build-server.sh');
    writeFileSync(script, readFileSync(resolve(project, 'scripts/docker-build-server.sh')));
    writeFileSync(resolve(tools, 'docker'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\n`);
    const toplevel = { root, nested: dirname(root) }[git];
    writeFileSync(resolve(tools, 'git'), git === 'none'
      ? '#!/bin/sh\necho "fatal: not a git repository" >&2\nexit 128\n'
      : `#!/bin/sh\ncase "$*" in\n  *--show-toplevel*) echo '${toplevel}';;\n  *rev-parse*) echo fixture-revision;;\nesac\n`);
    chmodSync(resolve(tools, 'docker'), 0o755);
    chmodSync(resolve(tools, 'git'), 0o755);
    const header = Buffer.alloc(20);
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(header);
    header.writeUInt16LE(invalid === 'architecture' ? 183 : 62, 18);
    for (const name of ['BR200.x86_64', 'UnityPlayer.so', 'GameAssembly.so']) writeFileSync(resolve(output, name), header);
    if (invalid !== 'data') {
      mkdirSync(resolve(output, 'BR200_Data'));
      writeFileSync(resolve(output, 'BR200_Data/globalgamemanagers'), 'data');
    }
    // Not shipped, so not in the manifest: changing them must not matter.
    mkdirSync(resolve(output, 'BR200_BurstDebugInformation_DoNotShip'));
    writeFileSync(resolve(output, 'BR200_BurstDebugInformation_DoNotShip/lib.txt'), 'debug');
    const report = { target: 'StandaloneLinux64', subtarget: 'Server', backend: 'IL2CPP', result: 'Succeeded' };
    if (invalid === 'report') Object.assign(report, { subtarget: 'Player', backend: 'Mono', result: 'Failed' });
    if (invalid !== 'no-manifest') report.manifestSha256 = manifestSha256(output);
    writeFileSync(resolve(output, 'server-build-report.json'), JSON.stringify(report));
    writeFileSync(resolve(output, 'build-provenance.json'), '{}');
    writeFileSync(resolve(output, 'BR200_BurstDebugInformation_DoNotShip/lib.txt'), 'changed after the build');
    if (invalid === 'stale') writeFileSync(resolve(output, 'BR200_Data/left-over-from-an-old-build'), 'old');
    const result = spawnSync('bash', [script], {
      env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, PYTHONOPTIMIZE: String(optimization) },
      encoding: 'utf8', timeout: 10000
    });
    const dockerArgs = existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n') : undefined;
    return { ...result, dockerCalled: dockerArgs !== undefined, dockerArgs };
  } finally {
    rmSync(root, { recursive: true });
  }
}

for (const optimization of [1, 2]) {
  for (const invalid of ['report', 'architecture', 'data', 'stale', 'no-manifest']) {
    test(`rejects invalid ${invalid} with PYTHONOPTIMIZE=${optimization}`, () => {
      const result = probe(optimization, invalid);
      assert.notEqual(result.status, 0, result.stderr);
      assert.equal(result.dockerCalled, false);
    });
  }
}

test('valid artifact metadata and headers can reach the Docker build boundary', () => {
  const result = probe(1);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.dockerCalled, true);
  assert.ok(result.dockerArgs.includes('GIT_SHA=fixture-revision'), result.dockerArgs.join(' '));
});

test('a stale file names the cause', () => {
  assert.match(probe(1, 'stale').stderr, /does not match its build report/);
});

for (const git of ['nested', 'none']) {
  test(`labels the image GIT_SHA=unknown with a warning when the project is ${git === 'none' ? 'not in a git repository' : 'inside another repository'}`, () => {
    const result = probe(1, undefined, git);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.dockerArgs.includes('GIT_SHA=unknown'), result.dockerArgs.join(' '));
    assert.match(result.stderr, /not the root of its own git repository/);
  });
}
