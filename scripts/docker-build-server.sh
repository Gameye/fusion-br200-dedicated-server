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

# Same manifest as BR200ServerBuild.cs: every file that ships, as .dockerignore decides.
def ships(rel):
    parts = rel.split('/')
    if len(parts) == 1:
        return not rel.endswith('.json')
    return not parts[0].endswith(('BackUpThisFolder_ButDontShipItWithYourGame', 'BurstDebugInformation_DoNotShip'))

def file_sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

files = sorted(rel for rel in (p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()) if ships(rel))
manifest = ''.join(f'{file_sha256(root / rel)}  {rel}\n' for rel in files)
expected = report.get('manifestSha256')
if not expected:
    raise SystemExit('The build report has no manifestSha256. Rebuild with the current BR200ServerBuild.cs')
if hashlib.sha256(manifest.encode('utf-8')).hexdigest() != expected:
    raise SystemExit('Builds/linux-server does not match its build report: files were added, removed or changed after the build. Rebuild with scripts/build-linux-server.sh')

digest = hashlib.sha256()
with (root / 'GameAssembly.so').open('rb') as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
print(digest.hexdigest())
PY
)"
# Label the image with the project's commit, but only when the project is the root of its own
# repository. Inside another repository, HEAD would be that repository's commit.
revision=unknown
if toplevel="$(git -C "$project_dir" rev-parse --show-toplevel 2>/dev/null)" \
  && [[ "$(cd "$toplevel" && pwd -P)" == "$(cd "$project_dir" && pwd -P)" ]]; then
  revision="$(git -C "$project_dir" rev-parse HEAD)"
  if [[ -n "$(git -C "$project_dir" status --porcelain)" ]]; then revision="$revision-dirty"; fi
else
  printf 'warning: %s is not the root of its own git repository, so the image is labelled GIT_SHA=unknown\n' "$project_dir" >&2
fi

exec docker buildx build --platform linux/amd64 --load \
  --file "$project_dir/docker/Dockerfile" \
  --build-arg "GIT_SHA=$revision" --build-arg "SERVER_BINARY_SHA=$binary_sha" \
  --tag "$image" "$project_dir"
