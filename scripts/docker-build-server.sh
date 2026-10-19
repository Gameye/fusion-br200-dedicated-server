#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${1:-fusion-br200-gameye:local}"
(( $# <= 1 )) || { printf 'Usage: %s [image:tag]\n' "$0" >&2; exit 64; }

binary_sha="$(python3 - "$project_dir" <<'PY'
from pathlib import Path
import hashlib, json, sys
root = Path(sys.argv[1]) / 'Builds/linux-server'
report = json.loads((root / 'server-build-report.json').read_text())
if (report['target'], report['subtarget'], report['backend'], report['result']) != ('StandaloneLinux64', 'Server', 'IL2CPP', 'Succeeded'):
    raise SystemExit('A successful Linux IL2CPP Server build is required')
for name in ('BR200.x86_64', 'UnityPlayer.so', 'GameAssembly.so'):
    with (root / name).open('rb') as stream:
        header = stream.read(20)
    if not (header[:4] == b'\x7fELF' and header[4:6] == b'\x02\x01' and int.from_bytes(header[18:20], 'little') == 62):
        raise SystemExit(f'{name} must be ELF x86-64')
if not (root / 'BR200_Data').is_dir():
    raise SystemExit('Missing complete runtime data')
digest = hashlib.sha256()
with (root / 'GameAssembly.so').open('rb') as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
print(digest.hexdigest())
PY
)"
revision="$(git -C "$project_dir" rev-parse HEAD)"
if [[ -n "$(git -C "$project_dir" status --porcelain)" ]]; then revision="$revision-dirty"; fi

exec docker buildx build --platform linux/amd64 --load \
  --file "$project_dir/docker/Dockerfile" \
  --build-arg "GIT_SHA=$revision" --build-arg "SERVER_BINARY_SHA=$binary_sha" \
  --tag "$image" "$project_dir"
