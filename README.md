# Photon Fusion BR200 dedicated server on Gameye

This kit runs Photon's [BR200 Battle Royale sample](https://assetstore.unity.com/packages/templates/packs/br200-battle-royale-multiplayer-photon-fusion-226753) as a Linux dedicated server in Docker and starts it on [Gameye](https://gameye.com).

It has no Photon or BR200 code. You get the sample from the Unity Asset Store under your own licence, copy these files into it, and build. The kit adds:

- `Assets/Gameye/Editor/BR200ServerBuild.cs`, an editor build method that produces a Linux **Server** build and fails if Unity builds anything else.
- `docker/`, a small Debian image that runs the server as a non-root user, and an entrypoint that turns environment variables into BR200's command-line options.
- `scripts/`, which build the server, package it into an image, and run it locally.
- `tests/`, contract tests for the packaging guard and the entrypoint.
- `examples/session-request.json`, a sample Gameye `POST /session` body.

The kit makes no changes to the sample's C# code.

## What you need

- BR200 2.1.0 from the Unity Asset Store. It ships with Fusion 2.1.1.
- Unity 6000.3.19f1 with the Linux Dedicated Server and Linux IL2CPP build modules.
- A Photon Fusion App ID from the [Photon dashboard](https://dashboard.photonengine.com).
- Docker with Buildx, Python 3, and Node 20 or later for the tests.
- A Gameye account. The free trial at [trial.gameye.com](https://trial.gameye.com) is enough.

## 1. Set up the project

1. Create a project from BR200 in Unity 6000.3.19f1 and let it import.
2. Open the Fusion Hub and set your Fusion App ID. Note the AppVersion you use. Clients and the server only find each other when their App ID, AppVersion and Photon region all match.
3. Copy this repository's `Assets/Gameye`, `docker`, `scripts`, `tests` and `.dockerignore` into the project root.

## 2. Build the Linux server

```sh
scripts/build-linux-server.sh
```

The script calls the Unity CLI (`~/.unity/bin/unity`, or set `UNITY_CLI`) with `Gameye.Editor.BR200ServerBuild.Build`. It pins the editor to 6000.3.19f1 on `arm64`, the Apple silicon editor. Change `--architecture` on an x86-64 machine. The output is `Builds/linux-server/BR200.x86_64` with its data folder and libraries, plus a `server-build-report.json` that records the target, subtarget, scripting backend and result.

The script empties `Builds/linux-server` first, so nothing from an earlier build is left behind. The build report also holds a `manifestSha256`: one hash over every file that ships.

Unity defines `UNITY_SERVER` only for the Server subtarget. That is why the build method sets the subtarget itself and checks it in the build report before it exits 0.

## 3. Package and test it locally

```sh
scripts/docker-build-server.sh                     # builds fusion-br200-gameye:local
SESSION_NAME=br200-local-1 PHOTON_REGION=us MAX_PLAYERS=4 scripts/docker-run-server.sh
```

Before it calls Docker, `docker-build-server.sh` checks that the build report says Server, IL2CPP and Succeeded. It also checks that the executable and both native libraries are Linux x86-64, and that the files in `Builds/linux-server` still match the report's `manifestSha256`, so a folder with files from another build is refused. The image is labelled with the project's commit. If the project isn't the root of its own git repository, for example when it sits inside another one, the label is `GIT_SHA=unknown` and the script prints a warning. The image is `linux/amd64` because Gameye nodes run on x86-64. It copies only the runtime build. It leaves out source, logs and Unity's `DoNotShip` folders.

The run script publishes the server on `127.0.0.1:25000/udp` and keeps `/data` in a named volume. Point two editor clients at that address to check a join before you upload anything.

Run the tests:

```sh
node --test tests/build-artifact-contract.test.mjs
node --test tests/entrypoint-contract.test.mjs     # needs the image built above
```

## 4. Push the image and create a Gameye application

Push the image to GitHub Container Registry or Docker Hub with a new tag for every build, for example the commit SHA:

```sh
docker tag fusion-br200-gameye:local ghcr.io/<your-org>/fusion-br200-gameye:sha-<commit>
docker push ghcr.io/<your-org>/fusion-br200-gameye:sha-<commit>
```

For GHCR, the image owner must match your Gameye organization name. Give the GitHub account `gameyedocker` **Read** access to the package. The package can stay private. See the [GHCR guide](https://gameye.com/docs/getting-started/ghcr/).

In the Gameye Admin Panel, create an application that points at the repository, without a tag. Declare UDP port 7777. If you change `GAME_PORT`, declare that port instead.

## 5. Start a match

**Start sessions cold, without a warm pool.** Every match needs its own `SESSION_NAME`, and BR200 reads it when the server starts. A warm-pool server has already started. While a warm pool is enabled, Gameye ignores the request's environment variables, even when the pool is empty and it starts a server cold, and uses the pool's settings instead. Until Gameye can pass per-match settings to a warm server, keep warm pools off for this application.

Your matchmaker calls `POST /session` when a match is ready. [`examples/session-request.json`](examples/session-request.json) is a two-player battle royale on one map:

```sh
curl -X POST https://api.sandbox-gameye.gameye.net/session \
  -H "Authorization: Bearer $GAMEYE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/session-request.json
```

Trial accounts use `api.sandbox-gameye.gameye.net`, and production accounts use `api.production-gameye.gameye.net`. The token needs the `session:start` scope. The response gives a public IP and UDP port. Clients connect to that address in Fusion's Direct mode with the same session name, App ID, AppVersion and region.

Keep the Gameye token in your backend. Never put it in the session's environment variables or in the game client.

## Runtime settings

Set these as session environment variables. A matching command-line option overrides the variable.

| Variable | Default and rule | BR200 option |
|---|---|---|
| `SESSION_NAME` | Required. Use a unique name per match. | `-sessionName` |
| `PHOTON_REGION` | Required. Must match the clients. | `-region` |
| `MAX_PLAYERS` | 200. Integer from 1 to 200. | `-maxPlayers` |
| `GAME_PORT` | 7777. Must match the port declared in the application. | `-port` |
| `GAME_SCENE` | `GenArea7`, the only map tested so far. | `-scene` |
| `GAME_MODE` | `battleRoyale`, `deathmatch` or `elimination`. | `-battleRoyale` and so on |
| `SERVER_NAME` | `BR200 Gameye`. | `-serverName` |
| `PHOTON_LOBBY` | Not set, so BR200's default lobby applies. | `-lobby` |
| `FPS` | Not set, so the server runs at the Fusion tick rate. | `-fps` |
| `RECORD_SESSION` | `true`. Writes BR200's stats file to `/data`. | `-recordSession` |

The entrypoint always runs in dedicated mode, binds `0.0.0.0`, logs to stdout and writes to `/data`. It rejects options such as `-client` or `-host` that would conflict with that. BR200 reads the first copy of a repeated option, so the entrypoint passes each one exactly once.

Set the application's artifact path to `/data`, so you can download the native log and stats file after the match ends.

## What has been tested

All tests used Unity 6000.3.19f1, BR200 2.1.0 and Fusion 2.1.1.2177.

- **Build.** The Linux Server IL2CPP build succeeds. Unity reports two `RenderTexture.Create failed` errors from the GenArea5 scene, but the build still completes. GenArea7 is the only map that has been run.
- **Local container.** Two editor clients joined the packaged server and stayed in sync. `docker stop` exits 0 in about 2.4 seconds and keeps the log and stats files. In a two-player battle royale, the server ended the match when one player left, then exited 0 on its own. A wrong AppVersion or region returns `GameNotFound`, and an invalid App ID returns `InvalidAuthentication`.
- **Gameye session.** On a Gameye trial account in eu-central-1, `POST /session` returned 201 and the server started. Two editor clients connected over the public UDP port and saw the same game state. `DELETE /session` stopped it, and the artifacts held the log and stats file. The session used 1 vCPU and 2 GB of RAM.

**Not tested yet:** a full playable battle on Gameye, 200 players, CPU and memory sizing for a full match, and maps other than GenArea7. Gameye's player count stays at 0 because BR200 doesn't report players to Gameye.

BR200 starts a 120-second waiting timer as soon as the server boots. Players who join after it runs out are counted as eliminated. Have your clients connect as soon as the session starts.

## Licence

The files in this repository are under the [MIT licence](LICENSE). BR200, Photon Fusion and the sample's art and audio are not part of this repository. They remain under the Unity Asset Store EULA and Photon's terms.
