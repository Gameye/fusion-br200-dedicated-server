#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unity_cli="${UNITY_CLI:-${HOME}/.unity/bin/unity}"

# Start from an empty folder, so files from an earlier build can't end up in the image.
rm -rf "$project_dir/Builds/linux-server"

exec "$unity_cli" build "$project_dir" \
  --target StandaloneLinux64 \
  --execute-method Gameye.Editor.BR200ServerBuild.Build \
  --output-path "$project_dir/Builds/linux-server/BR200.x86_64" \
  --editor-version 6000.3.19f1 --architecture arm64 \
  --args '-standaloneBuildSubtarget Server' \
  --timeout 1800 \
  --log-file "$project_dir/Logs/br200-linux-server-build.log" \
  --provenance-path "$project_dir/Builds/linux-server/build-provenance.json" \
  --no-tail --format json --non-interactive --no-log-proxy "$@"
