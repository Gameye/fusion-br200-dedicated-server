#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${1:-fusion-br200-gameye:local}"
(( $# <= 1 )) || { printf 'Usage: %s [image:tag]; configure native options through env\n' "$0" >&2; exit 64; }
: "${SESSION_NAME:?Set SESSION_NAME to a unique local room}"
: "${PHOTON_REGION:?Set PHOTON_REGION to the matching client region}"
name="${CONTAINER_NAME:-br200-local}"
data_volume="${DATA_VOLUME:-$name-data}"
env_args=()
for key in SESSION_NAME PHOTON_REGION PHOTON_LOBBY GAME_PORT MAX_PLAYERS GAME_SCENE GAME_MODE SERVER_NAME FPS RECORD_SESSION; do
  if [[ -n "${!key:-}" ]]; then env_args+=(--env "$key=${!key}"); fi
done
exec docker run --rm --name "$name" --platform linux/amd64 \
  --mount "type=volume,source=$data_volume,target=/data" \
  --publish "127.0.0.1:${LOCAL_UDP_PORT:-25000}:${GAME_PORT:-7777}/udp" \
  "${env_args[@]}" "$image"
