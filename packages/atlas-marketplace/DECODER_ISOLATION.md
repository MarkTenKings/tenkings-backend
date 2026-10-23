# Decoder isolation preparation

The selected target architecture is a dedicated operator-owned Unix-socket supervisor and one disposable Linux/Docker worker per job. The marketplace application receives no Docker access or root privileges. This document describes preparation, not a qualified service or production capability.

The current `proof-image.mjs` validator fully decodes PNG/JPEG in a killable local child. Its Node heap limit does not bound native memory, descendants, network access or host filesystem access. Existing local decode tests remain evidence for image validation only. The physical factory and accepted validator brand are unchanged in this preparation stage; target physical activation remains unavailable pending the qualified isolated capability and the other release gates.

## Current source boundary

New protocol/client preparation is explicitly unqualified and cannot satisfy the existing proof-image validator assertion. Caller-supplied qualification hashes and epochs are expectations to compare, not authority. A protocol response, successful local test or callback returning true cannot confer target admission.

The profile/launch-plan preparation is pure data validation and argument construction. It invokes no Docker command, launches no worker and does not discover a host, image, endpoint, identity, credential or limit. Required target values must be supplied and independently qualified. Synthetic values in tests are not deployment configuration. The [protocol specification](PROOF_DECODER_PROTOCOL.md) and [profile/evidence contracts](PROOF_DECODER_CONTRACTS.md) define the current source APIs.

The next local source stage extracts the existing full decode closure and adds a fixed one-shot worker, strict original-byte pipe protocol, metadata-only private SQLite job registry, owned-operation descriptions, and fixture supervisor/watchdog logic. The sealed `LOCAL_FIXTURE` executor runs only the fixed local Node worker or fixed simulated fault scenarios. Its container and cgroup observations are explicitly simulated; actual local child exit does not establish Linux containment. All components remain `UNQUALIFIED`, default-off, and outside the accepted validator brand.

Registry recovery covers committed intent/effect boundaries and clean close/reopen. Any existing SQLite journal/WAL/SHM sidecar is refused before opening or modifying the database; its bytes are preserved and uncertain capacity remains held. Interrupted SQLite-write recovery is not qualified. A fixture watchdog is in the same test process, so supervisor-logic separation does not establish independently surviving watchdog deployment.

Existing proof object keys, manifests, read access, factory/intake interfaces, release bindings and production wiring remain unchanged. No provider, grading or Ten Kings path is modified.

## Intended service boundary

The supervisor must never import sharp or accept a caller-selected image, command, executable path, mount or runtime option. The app connects through a dedicated IPC-only directory it cannot replace. The unsafe worker receives original bytes through attached input and bounded output through a pipe; it receives no operator-added or image-declared data volumes, application environment, credentials or private proof volume. Docker-generated system mounts must be enumerated and qualified on the target; an empty operator mount list is not a complete mount-isolation observation.

The operator must qualify an immutable image, nonroot identity, read-only code/root, dropped capabilities, no-new-privileges, private namespaces, seccomp and applicable MAC policy, external networking disabled, and finite native-memory, CPU, PID/thread, descriptor and temporary-filesystem limits. Docker's `none` network retains loopback. Realized cgroup and mount restrictions must be observed; a launch plan alone proves none of them.

Every request has an absolute deadline covering incomplete input and output, bounded metadata and image bytes, strict identity/digest/length/type agreement, no queue and no automatic retry. Preserve the existing maximum 10 MiB object, 16 million pixels, 15-second operation and two concurrent jobs. The worker needs a shorter decode deadline so cleanup fits within the operation budget.

Success requires both a valid full decode and trusted evidence of termination and complete cleanup of the exact owned job. A timeout, disconnected socket, process signal or supervisor death is not evidence that the worker stopped. Unknown cleanup quarantines admission and keeps capacity occupied. A watchdog independent of the supervisor must enforce worker lifetime if that supervisor dies. Before a new service epoch accepts work, reconcile all prior-generation jobs; never automatically replay unknown work.

## Remaining qualification and integration

The immutable Linux worker image, real fixed-operation adapter, independently deployed watchdog, target peer verification and live qualification authority remain separate implementation and review steps. The local source implementation supplies none of those target facts. Production physical construction must eventually require that isolated capability; the direct child is for explicit local fixtures. No generic client registration or approval boolean may bypass that gate.

Target evidence must bind the image, worker, dependency lock, profile and supervisor hashes; actual target, boot and service epoch; endpoint/peer identity; realized isolation and resource limits; qualification corpus and harness; observed outcomes; and current validity/revocation state. Per-job evidence binds that admission to the input/request, exit/OOM status and observed whole-cgroup cleanup.

Qualification must exercise malformed/oversized input and output, native memory pressure, descendants, resource exhaustion, forbidden network/filesystem/privilege access, disconnect/death, ignored termination, watchdog cleanup and restart reconciliation with synthetic canaries. Local fake-peer tests establish only the exercised protocol behavior. They do not establish Linux containment, peer identity or cleanup truth.

Later intake integration must distinguish an unavailable or uncertain decoder from an invalid image, recheck admission before fresh publication, and preserve historical original keys/manifests/read access. Actual container builds/runs and shared-host changes require separate coordination with the master lead after the label release window. Ownership claims/history remain disabled pending Fingerprint and genuine ownership authority.

## Primary platform references

- [Docker run options](https://docs.docker.com/reference/cli/docker/container/run/)
- [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)
- [Docker none networking](https://docs.docker.com/engine/network/drivers/none/)
- [Docker seccomp](https://docs.docker.com/engine/security/seccomp/)
- [Docker tmpfs mounts](https://docs.docker.com/engine/storage/tmpfs/)
- [Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
