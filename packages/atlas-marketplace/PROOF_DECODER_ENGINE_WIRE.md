# Inert decoder Engine wire contracts

This additive source slice builds and parses **review data only**. Every emitted
request/observation is `UNQUALIFIED` with `executionAllowed:false`. Nothing opens
a socket, contacts Docker, creates a worker, reads a file, or grants an accepted
validator capability. Engine API **1.47 is an explicit reference contract**, not
a selected or observed target. Existing worker, protocol, fixture supervision,
registry, profile, physical factory/intake and original proof objects are unchanged.

## Fixed request compiler

`compileProofDecoderEngineRequest({apiVersion,plan,job,operation,seccompBytes?})`
accepts the existing pure launch plan and exact owned identity. Version must be
`1.47`. Operations are `IMAGE_INSPECT`, `CREATE`, `LOOKUP`, `INSPECT`, `ATTACH`,
`START`, `WAIT`, `KILL`, and `REMOVE`. No caller endpoint, query, headers, command,
environment, mount, device or body is accepted. Name lookup uses only the original
registry/job-derived name; effects use only a full container ID. No list, pull,
build, exec, prune, stop/restart or cgroup operation is implemented.

The output has schema `atlas-proof-decoder-engine-request-v1`, classification,
executionAllowed, apiVersion, operation, profileHash, limitsHash, job,
`http:{method,path,headers,body}`, bodySha256 and seccompArtifactSha256. Body is a
canonical JSON string for create, otherwise null. The plan is detached/rechecked
and the result deeply frozen. These are structural checks, not a runtime brand.

CREATE requires explicitly supplied seccomp bytes (at most 64 KiB), verifies
their raw SHA-256 against the plan, validates bounded JSON and sends compact
profile content rather than its filesystem path. Whitespace compaction preserves
the artifact's original number/string lexemes. Raw artifact and emitted body
hashes are distinct. Fixed attached stdin is open and `StdinOnce:true`; TTY is
false. The image, worker argv, five environment entries, nonroot identity,
read-only root, no external network intent, namespaces, dropped capabilities,
security options and resource bounds come from the frozen profile.

The [pinned Docker CLI implementation](https://raw.githubusercontent.com/docker/cli/v27.5.1/cli/command/container/opts.go)
compacts supplied seccomp contents and sets StdinOnce for attached open stdin.
This compiler does not read the path or establish that the policy is safe,
supported, approved or enforced. No CgroupParent/daemon/runtime/UID mapping is
invented. The missing owned-parent mapping alone prevents this from being an
execution-ready target plan. Image defaults, generated mounts, native closure,
enforced limits and whole-descendant cleanup still need real qualification.

## Bounded response projection

`projectProofDecoderEngineResponse({apiVersion,plan,job,operation,statusCode,headers,body})`
accepts a Buffer of at most 256 KiB. JSON permits ordinary whitespace/property
order and benign extra Engine properties, while rejecting duplicate/escaped-alias
keys, invalid UTF-8/BOM, dangerous property names, trailing values, depth over 12,
over 16,384 nodes, and strings over 65,536 characters. Required projected values
have their own stricter bounds. Neither failure messages nor output retain raw
responses, Config.Env, paths, mounts or arbitrary response fields. Raw bytes are
hashed in private memory. A future transport must also keep raw bytes out of logs.

The observation schema is `atlas-proof-decoder-engine-observation-v1`, followed
by classification, executionAllowed, apiVersion, operation, profileHash,
limitsHash, job, statusCode, bodySha256, kind and data. Kinds are:

| Kind | Closed data |
| --- | --- |
| CREATE_REPORTED | containerId, warningCount |
| IMAGE_REPORTED | imageId, platform, imageDigest |
| CONTAINER_REPORTED | containerId, name, imageId, state |
| WAIT_REPORTED | exitCode |
| ATTACH_UPGRADE_REPORTED / START_REPORTED / KILL_REPORTED / REMOVE_REPORTED | null |
| NOT_FOUND_REPORTED / ENGINE_ERROR_REPORTED | null |

Container state contains status, running, paused, restarting, dead, oomKilled,
pid, exitCode, startedAt and finishedAt. Identity labels must match the supplied
expected job; this comparison does not authenticate the daemon or grant ownership.
Image inspection checks the expected digest/platform and reports only when baked
ENV/VOLUME fields are empty. Container inspection deliberately makes **no**
effective-configuration or containment assertion. An Engine-reported image ID
is not an independently established image trust anchor.

404 is an unverified report, never proven absence. Start304, standard errors,
lost replies and unknown statuses cannot authorize a replacement job or release
capacity. Wait reports cannot prove a job ran: the separate transcript layer must
first require a consistent observed start. Success plus wait still does not prove
descendants stopped. No output field can make cleanup verified.

## Attachment and multiplexed output

ATTACH and START are separate requests. The reference attachment requests Upgrade
and requires 101, Upgrade tcp, a Connection upgrade token, and
`application/vnd.docker.multiplexed-stream`. The
[pinned Moby attachment router](https://raw.githubusercontent.com/moby/moby/v27.5.1/api/server/router/container/container_routes.go)
uses that media type for upgraded non-TTY attachments from API1.42 onward. The old
raw-stream/200 fallback is refused by this narrower API1.47 contract.

The upgrade projector requires an **empty body**. Any bytes already buffered by
the future HTTP parser must be supplied separately as upgradeHead and fed exactly
once to the multiplex reader; they must never be discarded. Future transport must
write the exact PDW1 header/original, half-close only its write side, then drain
output to EOF. This source slice performs none of those socket operations.

`createProofDecoderEngineMultiplexReader({onStdout,onStderr,stdoutLimit?,stderrLimit?,maxFrames?})`
exposes feed/end/dispose/status. Its ceiling is 4,104 stdout bytes, 4,096 stderr
bytes and 256 records, with eight-byte headers, stream 1 or 2, and zero reserved
bytes. Zero-length records consume the finite record budget. At most one bounded
record is allocated. Overflow, malformed headers, truncated EOF and callback
failure poison the reader; it cannot resume. Callback errors become value-free
codes. Status exposes `stdoutStarted` immediately when a new record's first byte
identifies stdout, even with an incomplete header/payload. The transcript layer
checks it after each feed to reject stdout preceding input EOF. This flag is an
arrival observation, not a validated record or worker result. Explicit end
validates record EOF only; the unchanged PDW1 parser separately
requires exact output EOF and original binding. Diagnostic stderr never becomes
an image verdict or authority.

The [pinned Engine schema](https://raw.githubusercontent.com/moby/moby/v27.5.1/docs/api/v1.47.yaml)
documents the non-TTY header and not-running wait endpoint. Tests use only invented
in-memory JSON, bytes and outcomes; they do not contact an Engine, decode images,
start processes or prove target half-close/resource/isolation behavior.

## Remaining boundary

The actual image/config/native closure, target/boot/daemon/clock/peer identity,
owned non-threaded cgroup parent and driver mapping, independently surviving
watchdog/sole registry writer, live admission/revocation and physical compatibility
join remain absent. There is no target adapter, promotion API or production
activation. Fingerprint plus genuine title/consignment/custody remains required;
ownership claims/history and pricing guidance stay disabled.
