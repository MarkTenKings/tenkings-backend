# Connected manual runtime delivery readiness

Observed September 12, 2026, 22:00–22:04 UTC. Read-only inspection from the fresh
release worktree at `aeb8e68dd6ea007d2bc11ccf568f771375a52af2`. No image was
transferred, built, published, loaded or started remotely; no service, ingress,
database, provider, DNS or account setting changed.

The existing DigitalOcean host can receive the retained Linux image. A new cloud
builder or host is not required by the observed disk/architecture evidence. This
is a delivery recommendation, not native target qualification or production
activation. Existing I and CPU A2 remain separate running services.

## Evidence and current identities

Small evidence is retained under
`/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/runtime/`:

- `host-inventory.json`: normalized remote Docker, host, resource and routing
  inventory, captured by retained `inspect-host.py` over verified SSH.
- `live-identity-and-ci.json`: fresh HTTPS I/CPU health, GitHub main and runner
  inventory. Those health routes describe the old services only.
- `local-final-image.json`: fresh local immutable image/config/layer inspection.
- `SHA256SUMS`: hashes of the compact evidence files.

The original 497-file manifest and image qualification stay in their original
handoff locations. No large evidence tree was copied.

| Item | Fresh observation |
| --- | --- |
| SSH target | `root@104.131.27.245`, existing known-host verification and BatchMode succeed |
| Host | `ubuntu-s-1vcpu-1gb-nyc3-01`; actual `x86_64`, four CPUs; the historical hostname does not describe current capacity |
| Memory | 8,326,975,488 bytes total; 5,693,591,552 bytes available at snapshot |
| Docker disk | 68,805,705,728 bytes free of 165,295,407,104 |
| Docker / Compose | 28.5.1 / 2.40.0 on Linux kernel 6.8.0-90-generic |
| Shared workload | 14 running of 21 retained containers; Bytebot sampled 148.60% CPU, load about 1.9; free capacity is not simultaneous-card throughput proof |
| I container | `atlas-workspace-private-i-20260911`, image ID `sha256:75518ab2a04374a8957edd9b526ef38cf6eebde0491d47d98f00466c45b8ed36`, running since September 11 14:27:50 UTC, zero observed OOM/restart |
| I source | `89c55d916130d914f6a989197538c8bbd31c9594`, independently returned by `https://private.atlasgrading.com/health` |
| I release directory | `/opt/atlas/workspace-fresh-start-i-20260911/`; existing `compose.yaml` and `release.env` |
| CPU A2 | `atlas-workspace-preparation-20260910`, local image ID `sha256:bf85bda31dddcb9fbee2f6a466289a4844322b3a61277fa87e6405774743362f`, running; HTTPS preparation identity pins OCI `sha256:5a4f32f12b55a3fd9dce9d768eac11b5e4fa9ede6cbdd89f53df513166a66b90` and source `6b75c9399b83f55cca55045b560c205cbe91920b` |
| Caddy | `infra-caddy-1`, running since July 22, attached to `infra_default` and internal `atlas-workspace-private-20260910`; default gateway remains on infra network |
| Caddy source | `/root/tenkings-backend/infra/Caddyfile`, 1,932 bytes, SHA256 `3db7ed4c051130971f03d76013c96ca1c70ecf3049b93469346aba5fbdc8c7ab` |
| Manual image on target | No matching connected-manual image or container observed |
| Local final candidate | `.Id=sha256:b6eaf704a8241afd470d9da81b4402cbd8f16184ecd6c608c99b5396f6ae48f1`, Linux/amd64, 606,353,374 reported bytes, 19 rootfs layers |
| Local disk | 3,278,624 KiB available at initial check; avoid another build or local image archive |
| GitHub | Main still `89c55d9…`, latest main CI `34605844130` succeeded; `protected:false`; zero self-hosted runners returned |

The local image reports tag `atlas-connected-manual:final-verified-20260912` and
RepoDigest `atlas-connected-manual@sha256:b6eaf704…`. These are local engine
observations. There is no observed published GHCR repository digest, registry
signature, SBOM or GitHub build provenance for this manual image. Do not describe
it as the protected old `atlas-private` image. The inspected `.Id`, complete
rootfs list, runtime config and final source manifest form the available local
artifact identity.

Fresh-lead integration is concurrently changing the browser approval journal,
publishing the three exact SQL proposals into staff migrations and preparing an
authenticated heartbeat/response envelope for the observed120-second CDN idle
limit. Those changes are not in the retained image inspected here. The lead must
bind the final web source and any changed private transport bytes to their exact
artifact and qualification. The native decoder/measurement proof may be reused
only for unchanged native source; a new long-request envelope is not covered by
the old image's transport pass. The delivery commands below describe the sealed
baseline and must select a newly verified identity if that image is refreshed.

## Prioritized release blockers

1. **Current ingress cannot serve manual requests.** The existing private host
   permits only `/health`, `/workspace/v1` and two old internal endpoints and has
   a global 16,384-byte request limit. The new paths would return 404; merely
   adding a matcher would still reject valid manual traces larger than 16 KiB.
   Retaining `private.atlasgrading.com` avoids a new DNS/TLS dependency, but needs
   a separately scoped manual handler and 2,097,152-byte limit. Preserve I's
   existing paths, 16 KiB limit, upstream and transport settings.
2. **Native target qualification and actual service admission remain undone.**
   The host is native amd64, but the manual image has never been loaded or run
   there. The retained Mac Docker pass does not answer this. Actual restricted
   DB role/schema, storage semantics, matched web deployment/auth, provider
   configuration and ordinary staff access are dependencies owned by the other
   release specialists. No listener alone proves them.
3. **There is no manual health endpoint or Docker HEALTHCHECK.** The new server
   accepts only manual cards routes. `GET /health` must remain 404 there.
   `MANUAL_PRIVATE_LISTENING` reports admitted web identity and Node/platform,
   not independent native source identity or database readiness. Use exact
   container/image/source verification and a signed ordinary-authenticated
   intake-list GET for readiness; do not reuse I's eight-field health assertion.
4. **Final-head release checks and artifact publication are absent.** Current CI
   has GitHub-hosted Ubuntu jobs, builds the staff app and publishes the old
   private/preparation images. It has no connected-manual build/publication job
   or explicit new-package runtime/SQL-proposal coverage. Latest green main is
   I, not this candidate. Existing required checks plus the retained new suite
   must be bound to the final reviewed head. Direct private candidate delivery
   need not wait for a new registry pipeline, but must retain truthful local
   build provenance and pass the applicable release policy before activation.
5. **Capacity/draining/replay admission need operational proof.** The host has
   space, but a CPU-heavy shared workload is active. Measure actual candidate
   peak RSS, tmpfs and duration under the proposed finite resource limits,
   without changing another service. One manual process uses an in-memory nonce
   store; replicas and immediate same-key crash restarts are not qualified.

## Exact retained-artifact delivery plan

This is prepared work only. The lead records the concrete authorized release
intent before any remote artifact load, start, routing change or migration.

1. Use the lead's subsequently qualified 505-file candidate, recorded in the
   [integrated readiness review](connected-manual-release-readiness.md), with
   manifest `e29d8da5a5a0d949d398918a9b109ad6f583d1ab9102264370b66866c219c1f7`.
   Recheck local `.Id`, the complete rootfs layer list and configuration against
   its retained build/readback receipts. The 497-file image in the inventory
   above is the original baseline, superseded by the reviewed small source
   overlay and rebuilt staff artifact. Any further serving change needs a new
   exact delta and qualification; never quietly relabel an older artifact.
2. Inventory target state again and capture I, CPU, Caddy, networks, resource
   state and Caddyfile hash before writes. Allocate a new manual release
   directory; never overwrite I's release directory or env file.
3. Stream the retained image over the existing verified SSH connection, without
   a local archive, registry push or new build. Example after authorization:

   ```sh
   set -o pipefail
   docker image save sha256:315bae6df16bf090faa0c1d23682eb88fb113b79dc793f61680da5a1b5e10bcc |
     ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@104.131.27.245 docker image load
   ```

   Preserve exit status and load output. Independently inspect the target image:
   require the expected `.Id`, Linux/amd64, User `node`, entrypoint, command,
   environment and complete rootfs list. If different Docker image-store
   representation changes an identifier, stop and establish its exact manifest/
   config/layer relationship; do not waive the mismatch by tag equality.
   If transfer outcome is uncertain, inspect first; do not rebuild or repeat an
   operational start to recover missing stdout.
4. Stage only the small source manifest/verification script and explicitly
   selected retained-photo/oracle inputs in the new release directory. Verify
   file hashes against original evidence. A no-network, read-only one-shot run
   must check all 505 image files' byte lengths and SHA256 and run the existing
   native `packages/atlas-connected-manual/scripts/qualify-linux.mjs` proof with
   `/retained` and `/mac-oracle` mounted read-only. Capture host architecture,
   image ID, Node/Python/OpenCV/NumPy versions, duration, peak resources and exit
   status. The original images are test evidence here; they are not new owner
   card acceptance and must not enter production storage or card tables.
5. Use a separate Compose project with `pull_policy: never` and the inspected
   immutable image, no build directive, no host-published port, read-only root,
   original non-root image user, bounded writable `/tmp`, all capabilities
   dropped and no-new-privileges. Start with proposed qualification limits of
   one CPU, 3 GiB memory/no extra swap and 1 GiB tmpfs; these are resource
   qualification inputs, not measured serving sufficiency or product card caps.
   Keep restart policy `no` initially and `stop_grace_period: 240s`.
6. Provide a manual-only internal ingress network and separate outbound bridge;
   do not attach the manual container to `infra_default`. Caddy may be attached
   to the manual internal network with gateway priority `-1`, retaining its
   existing attachments/default route. Keep a record for Caddy recreation;
   existing manual attachment is not made durable by a graceful reload alone.
   This uses the current host and proxy, not another hosted service. Record
   network membership before and after.

## Startup and readiness

Use the private CPU configuration table in
`docs/atlas/runbooks/CONNECTED_MANUAL_RELEASE.md` without copying secrets into
evidence. The new env file is mode0600 with actual matched web release SHA,
deployment hostname, ordinary staff auth, distinct manual signing key, separate
manual DB role and scoped private storage credentials. Identification stays off
until its actual provider activation is accepted. No fixture or Vercel/Lambda
flags belong on this host.

The image's command is
`node packages/atlas-connected-manual/scripts/serve.mjs`; it listens on4319.
Do not override it with the old private entrypoint. Startup qualification must
combine:

- Docker inspection of the running container's `.Image` and supplied immutable
  image/config, read-only mounts and source verification from that container;
- `MANUAL_PRIVATE_LISTENING` with the exact admitted web SHA/deployment and
  `node=v20.20.2`, `platform=linux`, `arch=x64`;
- unsigned GET `/api/staff/manual-intake/cards` returning the expected signature
  refusal, which proves only the transport listener;
- signed GET `/api/staff/manual-intake/cards` through the admitted staff web
  deployment using an ordinary current staff session, returning the actual
  authenticated empty/list shape without manufacturing a session;
- unsigned, replayed, foreign-origin, revoked-session and CSRF refusals plus
  matched storage/DB readbacks owned by the relevant specialists.

The ingress proposal adds an exact manual cards-path matcher to the existing
private hostname and forwards it to the new container on4319 with no retries,
5-second dial timeout and at least210-second response allowance. Its body limit
is2097152 bytes. Move the old16384-byte limit inside the existing old-path
handler, preserving its250-second timeout and I upstream. All other paths retain
404. Validate the full proposed Caddyfile, compare the full diff/hash, then use a
graceful reload of the existing container after authorization; do not recreate
the shared proxy or run `docker compose restart` on shared infra.

After routing, verify the exact signed manual GET and recheck old I and CPU
HTTPS identities, the shared services and Caddy's default route. A second manual
replica cannot be added without a shared atomic nonce store. For the one-process
in-memory store, a same-key restart must also account for previously valid
nonces: close new signing/traffic and allow the complete120-second possible
timestamp acceptance interval to expire before starting another process. A
changed key requires coordinated web configuration, not a silent local rotation.

## Draining and rollback

First close new manual work at the web/ingress boundary while keeping exact
uncertain command identities and readback/recovery available. Existing old I,
preparation, public reports and customer access are not part of this drain.
Capture current in-flight requests and known/unknown provider effects before
changing the manual process. Existing source has no active-request-count health
surface, so record actual connections plus terminal command/effect readbacks;
a fixed sleep or listening log is not proof of a settled operation.

SIGTERM invokes `server.close()`. At215seconds the source calls
`closeAllConnections()`; that closes sockets and does not prove that every
asynchronous handler or paid effect completed. Allow240seconds at Docker level,
record actual exit/OOM/kill status and any unresolved outcome. Preserve original
requests/receipts and use their existing exact recovery path; never blindly
repeat uncertain identification or report approval. Do not overlap same-key
manual replicas during replacement.

If native qualification fails before traffic, stop only the new candidate after
the bounded drain and keep its image/config/evidence. If web activation fails,
disable new manual intake, restore the exact previous web binding and only the
manual ingress change, and retain I's current routing. Recheck the captured
pre-change Caddyfile hash and old HTTPS identities. Later rollback between manual
versions requires a matching web/private release pair and compatible persisted
state; the old I operator cannot process the new manual schemas. Never drop the
three new schemas, delete originals/history/approvals, restart old cards, or
restart shared infra as rollback.

This inspection resolves target availability and the need for a new builder. It
does not complete storage/DB/auth release acceptance, the owner's new physical
card checks, or the initiating-cause prerequisite for a replacement Astra grader.
