import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image = process.env.BR200_CONTRACT_IMAGE || 'fusion-br200-gameye:local';
const scratch = mkdtempSync(resolve(tmpdir(), 'br200-entrypoint-contract-'));
const binary = resolve(scratch, 'BR200.x86_64');
const data = resolve(scratch, 'data');
writeFileSync(binary, '#!/bin/bash\nprintf "\\0BR200_ARGS\\0"\nprintf "%s\\0" "$@"\n');
chmodSync(binary, 0o755);
mkdirSync(data, { mode: 0o777 });
chmodSync(scratch, 0o755);
chmodSync(data, 0o777);
after(() => rmSync(scratch, { recursive: true }));

function launch(env = {}, args = []) {
  const dockerArgs = ['run', '--rm', '--platform', 'linux/amd64', '--network', 'none',
    '--entrypoint', '/usr/local/bin/entrypoint.sh',
    '--mount', `type=bind,source=${binary},target=/server/BR200.x86_64,readonly`,
    '--mount', `type=bind,source=${data},target=/data`];
  for (const [key, value] of Object.entries(env)) dockerArgs.push('--env', `${key}=${value}`);
  return spawnSync('docker', [...dockerArgs, image, ...args], { encoding: 'utf8', timeout: 30000 });
}

function argumentsOf(result) {
  assert.equal(result.status, 0, result.stderr);
  const marker = '\0BR200_ARGS\0';
  assert.ok(result.stdout.includes(marker), result.stdout);
  return result.stdout.split(marker)[1].split('\0').slice(0, -1);
}

const config = { SESSION_NAME: 'br200-test', PHOTON_REGION: 'us' };

test('packaged entrypoint matches the current source before contract validation', () => {
  const result = spawnSync('docker', ['run', '--rm', '--platform', 'linux/amd64', '--network', 'none',
    '--entrypoint', 'sha256sum', image, '/usr/local/bin/entrypoint.sh'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const expected = createHash('sha256').update(readFileSync(resolve(root, 'docker/entrypoint.sh'))).digest('hex');
  assert.equal(result.stdout.split(/\s+/)[0], expected, 'Rebuild the image after changing the entrypoint');
});

test('default server config emits the native startup contract', () => {
  assert.deepEqual(argumentsOf(launch(config)), [
    '-batchmode', '-nographics', '-logFile', '-', '-dedicatedServer',
    '-ip', '0.0.0.0', '-dataPath', '/data', '-battleRoyale',
    '-sessionName', 'br200-test', '-region', 'us', '-maxPlayers', '200',
    '-scene', 'GenArea7', '-port', '7777', '-serverName', 'BR200 Gameye', '-recordSession'
  ]);
});

test('CLI overrides env once, preserves extra args and values with spaces literally', () => {
  const actual = argumentsOf(launch({ ...config, GAME_PORT: '7777', MAX_PLAYERS: 'bad' }, [
    '-port', '9000', '-port', '9001', '-sessionName', 'room with spaces',
    '-maxPlayers', '4', '-deathmatch', '-randomDeviceID', '-custom', '$(touch /data/nope)'
  ]));
  assert.equal(actual.filter(x => x === '-port').length, 1);
  assert.equal(actual[actual.indexOf('-port') + 1], '9001');
  assert.equal(actual[actual.indexOf('-maxPlayers') + 1], '4');
  assert.equal(actual[actual.indexOf('-sessionName') + 1], 'room with spaces');
  assert.ok(actual.includes('-deathmatch'));
  assert.ok(!actual.includes('-battleRoyale'));
  assert.deepEqual(actual.slice(-3), ['-randomDeviceID', '-custom', '$(touch /data/nope)']);
  assert.equal(existsSync(resolve(data, 'nope')), false);
});

test('managed CLI args can supply required values when env is absent', () => {
  const actual = argumentsOf(launch({}, ['-sessionName', 'cli-room', '-region', 'eu']));
  assert.equal(actual[actual.indexOf('-sessionName') + 1], 'cli-room');
  assert.equal(actual[actual.indexOf('-region') + 1], 'eu');
});

test('missing required fields or incomplete CLI values fail before launching', () => {
  for (const [env, args] of [[{}, []], [{ SESSION_NAME: 'room' }, []], [config, ['-port']]]) {
    const result = launch(env, args);
    assert.equal(result.status, 64, result.stderr);
    assert.ok(!result.stdout.includes('BR200_ARGS'));
  }
});

test('invalid numeric config fails rather than selecting random ports or wrapping values', () => {
  for (const env of [{ GAME_PORT: '0' }, { GAME_PORT: '65536' }, { GAME_PORT: 'abc' },
    { MAX_PLAYERS: '0' }, { MAX_PLAYERS: '201' }, { FPS: 'abc' }]) {
    const result = launch({ ...config, ...env });
    assert.equal(result.status, 64, result.stderr);
    assert.ok(!result.stdout.includes('BR200_ARGS'));
  }
});

test('caller cannot change dedicated mode, bind address, stdout or writable data contract', () => {
  for (const args of [['-client'], ['-host'], ['-ip', '127.0.0.1'],
    ['-logFile', '/data/hidden.log'], ['-dataPath', '/server'], ['-extraPeers', '10']]) {
    const result = launch(config, args);
    assert.equal(result.status, 64, result.stderr);
  }
});

test('optional lobby, fps and recording controls reach the native executable', () => {
  const actual = argumentsOf(launch({ ...config, PHOTON_LOBBY: 'private', FPS: '60', RECORD_SESSION: 'false' }));
  assert.equal(actual[actual.indexOf('-lobby') + 1], 'private');
  assert.equal(actual[actual.indexOf('-fps') + 1], '60');
  assert.ok(!actual.includes('-recordSession'));
});

test('an env value cannot become a native mode flag', () => {
  const result = launch({ ...config, PHOTON_LOBBY: '-client' });
  assert.equal(result.status, 64, result.stderr);
  assert.ok(!result.stdout.includes('BR200_ARGS'));
});
