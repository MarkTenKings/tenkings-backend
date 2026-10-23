# Read-only decoder target facts

`scripts/inspect-decoder-target.py` is a Linux-only, standard-library collector
for the separately authorized R2 qualification VM. The lead must bind the new
provider instance and SSH host identity before transferring or running it.
Do not run it on grading, production, an existing host, or this development Mac.
Importing the module does not collect facts. It does not install or start services.

After that separate identity check, the lead may run `python3 -B
inspect-decoder-target.py`. By default **no socket is opened**. To explicitly
request daemon-reported versions, add `--docker-socket /run/docker.sock` (the only
other accepted path is `/var/run/docker.sock`). This makes one AF_UNIX HTTP
`GET /version` request with `Connection: close`; it never uses TCP, DNS, a Docker
CLI/context, configuration files, inherited credential variables or discovery.
No other Docker API path, general inspect, Config.Env, container operation or
provider operation exists in this collector.

The single JSON record uses the separate schema
`atlas-proof-decoder-target-facts-v1`. It always has `status:UNVERIFIED`,
`runtimeQualified:false` and `executionAllowed:false`. Each fact has a source
and an `OBSERVED` value or an explicit non-observed status. `missingFacts` lists
every non-observed fact. `COMPLETED` means the bounded collection pass ended;
it does not mean all facts were available or the target passed anything. Exit 0
means completed collection, and exit 2 means the overall deadline expired.

The fixed observations are:

- Selected OS-release keys; uname machine and kernel release; boot UUID; libc
  reported by `confstr`, without scanning executables or environment variables.
- The cgroup2 mount specifically at `/sys/fs/cgroup`, a boolean saying whether
  its mount root is `/`, selected mount flags, root controller names and type.
  Private mount paths, unrelated mounts and raw mountinfo are not emitted.
- AppArmor's module enabled flag and LSM names, without reading policy/profile
  content. Enabled is not a claim of enforced confinement.
- Whether PID 1's comm is `systemd`, plus the installed systemd binary's bounded
  version line from the fixed `/usr/lib/systemd/systemd --version` command.
  The binary version does not prove PID 1 is that exact binary or its configuration.
- Only when explicitly requested: Docker Engine `Version`, `ApiVersion`,
  `MinAPIVersion`, `Os`, `Arch`, and the reported containerd/runc component version
  strings. Component `Details`, arbitrary fields and raw response/error text are
  discarded. Missing components remain missing. No Docker client version is
  collected; the source is the server's version endpoint, not an installed CLI.

File paths are allowlisted, opened read-only without following directory/file
symlinks, and limited to 8 KiB each (mountinfo: 256 KiB). The sole os-release alias
exception permits `/etc/os-release` to point to `/usr/lib/os-release`. Other file
types and arbitrary symlinks are refused. The fixed version child receives only
constant PATH/LC_ALL values, no inherited environment, no stdin and no retained
stderr. Its output is at most 4 KiB and its deadline is one second; on failure the
collector kills only that child. The optional socket read has a two-second total
deadline, 8 KiB header, 64 KiB decoded body, 96 KiB wire and finite chunk bounds.
Duplicate JSON/header keys, ambiguous framing, redirects, compression, trailers,
extra messages and malformed projected values are refused. No raw body is logged.
The CLI imposes a ten-second overall alarm and a 32 KiB output ceiling. On overall
timeout it discards partial observations and reports every fact as not collected.

These observations do not authenticate a daemon, bind provider identity, pin a
profile, prove image/native closure, cgroup delegation or cleanup, prove IPC peers,
establish independently surviving supervision, run the 22 qualification cases, or
grant a validator/admission capability. This is not target-evidence input for
`assessProofDecoderTargetEvidence`. Source fixture values are never defaults.
Pinning or qualification requires separate observed evidence and review. Ownership
claims/history and pricing remain disabled pending Fingerprint plus genuine
title, consignment or custody authority.

`python3 -B packages/atlas-marketplace/test/inspect-decoder-target.test.py` runs
synthetic tests with fake files/data, mocked sockets/processes and a local pipe.
It does not execute the collector against the local host, start a version binary,
open a daemon socket, or contact the qualification VM/provider.
