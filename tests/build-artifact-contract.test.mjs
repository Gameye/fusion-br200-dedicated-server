import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function probe(optimization, invalid) {
  const root = mkdtempSync(resolve(tmpdir(), 'br200-build-guard-'));
  const output = resolve(root, 'Builds/linux-server');
  const tools = resolve(root, 'tools');
  const marker = resolve(root, 'docker-called');
  try {
    mkdirSync(output, { recursive: true });
    mkdirSync(resolve(root, 'scripts'));
    mkdirSync(tools);
    const script = resolve(root, 'scripts/docker-build-server.sh');
    writeFileSync(script, readFileSync(resolve(project, 'scripts/docker-build-server.sh')));
    writeFileSync(resolve(tools, 'docker'), `#!/bin/sh\ntouch '${marker}'\n`);
    writeFileSync(resolve(tools, 'git'), '#!/bin/sh\ncase "$*" in *rev-parse*) echo fixture-revision;; esac\n');
    chmodSync(resolve(tools, 'docker'), 0o755);
    chmodSync(resolve(tools, 'git'), 0o755);
    const report = { target: 'StandaloneLinux64', subtarget: 'Server', backend: 'IL2CPP', result: 'Succeeded' };
    if (invalid === 'report') Object.assign(report, { subtarget: 'Player', backend: 'Mono', result: 'Failed' });
    writeFileSync(resolve(output, 'server-build-report.json'), JSON.stringify(report));
    const header = Buffer.alloc(20);
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(header);
    header.writeUInt16LE(invalid === 'architecture' ? 183 : 62, 18);
    for (const name of ['BR200.x86_64', 'UnityPlayer.so', 'GameAssembly.so']) writeFileSync(resolve(output, name), header);
    if (invalid !== 'data') mkdirSync(resolve(output, 'BR200_Data'));
    const result = spawnSync('bash', [script], {
      env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, PYTHONOPTIMIZE: String(optimization) },
      encoding: 'utf8', timeout: 10000
    });
    return { ...result, dockerCalled: existsSync(marker) };
  } finally {
    rmSync(root, { recursive: true });
  }
}

for (const optimization of [1, 2]) {
  for (const invalid of ['report', 'architecture', 'data']) {
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
});
