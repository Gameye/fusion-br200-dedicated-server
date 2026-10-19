#!/bin/bash
set -euo pipefail

fail() { printf 'BR200 config error: %s\n' "$*" >&2; exit 64; }
value() { (($# >= 2)) && [[ -n "$2" && "$2" != -* ]] || fail "$1 needs a value"; }
integer() {
  local name="$1" number="$2" maximum="$3"
  [[ "$number" =~ ^[0-9]{1,10}$ ]] || fail "$name must be an integer"
  ((10#$number >= 1 && 10#$number <= maximum)) || fail "$name must be between 1 and $maximum"
}

session="${SESSION_NAME:-}"
region="${PHOTON_REGION:-}"
players="${MAX_PLAYERS:-200}"
scene="${GAME_SCENE:-GenArea7}"
port="${GAME_PORT:-7777}"
server_name="${SERVER_NAME:-BR200 Gameye}"
mode="${GAME_MODE:-battleRoyale}"
lobby="${PHOTON_LOBBY:-}"
fps="${FPS:-}"
record="${RECORD_SESSION:-true}"
extra=()

while (($#)); do
  case "$1" in
    -sessionName) value "$@"; session="$2"; shift 2 ;;
    -region) value "$@"; region="$2"; shift 2 ;;
    -maxPlayers) value "$@"; players="$2"; shift 2 ;;
    -scene) value "$@"; scene="$2"; shift 2 ;;
    -port) value "$@"; port="$2"; shift 2 ;;
    -serverName) value "$@"; server_name="$2"; shift 2 ;;
    -lobby) value "$@"; lobby="$2"; shift 2 ;;
    -fps) value "$@"; fps="$2"; shift 2 ;;
    -battleRoyale|-deathmatch|-elimination) mode="${1#-}"; shift ;;
    -recordSession) record=true; shift ;;
    -dedicatedServer|-batchmode|-nographics) shift ;;
    -client|-host|-extraPeers|-ip|-dataPath|-logFile)
      fail "$1 conflicts with the dedicated server runtime contract" ;;
    *) extra+=("$1"); shift ;;
  esac
done

[[ -n "$session" && "$session" != -* ]] || fail 'SESSION_NAME or -sessionName is required'
[[ -n "$region" && "$region" != -* ]] || fail 'PHOTON_REGION or -region is required'
[[ -n "$scene" && "$scene" != -* ]] || fail 'GAME_SCENE must be nonempty'
[[ -n "$server_name" && "$server_name" != -* ]] || fail 'SERVER_NAME must be nonempty'
[[ -z "$lobby" || "$lobby" != -* ]] || fail 'PHOTON_LOBBY cannot start with a flag'
[[ "$mode" == battleRoyale || "$mode" == deathmatch || "$mode" == elimination ]] || fail 'GAME_MODE must be battleRoyale, deathmatch or elimination'
[[ "$record" == true || "$record" == false ]] || fail 'RECORD_SESSION must be true or false'
integer GAME_PORT "$port" 65535
integer MAX_PLAYERS "$players" 200
[[ -z "$fps" ]] || integer FPS "$fps" 2147483647
[[ -d /data && -w /data ]] || fail '/data must be writable by the runtime user'

args=(-batchmode -nographics -logFile - -dedicatedServer -ip 0.0.0.0 -dataPath /data
  "-$mode" -sessionName "$session" -region "$region" -maxPlayers "$((10#$players))"
  -scene "$scene" -port "$((10#$port))" -serverName "$server_name")
[[ -z "$lobby" ]] || args+=(-lobby "$lobby")
[[ -z "$fps" ]] || args+=(-fps "$((10#$fps))")
[[ "$record" == false ]] || args+=(-recordSession)
printf 'BR200_BOOT session=%s region=%s mode=%s scene=%s port=%s max_players=%s\n' "$session" "$region" "$mode" "$scene" "$port" "$players"
exec /server/BR200.x86_64 "${args[@]}" "${extra[@]}"
