# ATLAS private workspace service

This package hosts the private workspace source, image and execution adapters. It reuses the original grading implementation through explicit scoped ports. The staff application calls this service through its authenticated private transport; this service is not a public browser application. Runtime configuration and admission checks live in `src/config.mjs` and `src/runtime.ts`.

## Container candidate

`scripts/package-container.mjs` writes a new Docker context outside the checkout. It copies only the two private bundles and their build manifest, the combined Prisma 5.22 client/schema/library with the Debian OpenSSL 3 x64 engine, the bootstrap, and the eleven exact Linux Sharp runtime packages pinned in `pnpm-lock.yaml`. It does not copy the repository, `.env` files, credentials, a database URL, or an operator release artifact. Neither dependency installation nor Prisma generation runs inside the image.

The producer checks every bundle input against the current checkout and checks the generated client against both canonical schemas. A stale bundle or schema stops packaging. The npm archives are fetched only with explicit `--download`, only from their fixed public registry URLs, and must match the lockfile's SHA512 integrity before a bounded archive reader extracts regular files. No package scripts run. The resulting `app/container-manifest.json` records source commit/tree context, current worktree input hashes, package integrities and all output file hashes. `candidate: WORKTREE` makes no claim that uncommitted bytes belong to the recorded commit.

The image uses the exact official Linux amd64 Node 20.20.1 Bookworm image `sha256:abc255963bb4311b1f81bf45f2382df39a4041d2a975b1807d05809f1bc21bbe`, including `libc6=2.36-9+deb12u13` and `libssl3=3.0.18-1~deb12u2`. Application files are root-owned, read-only and inventoried; the process runs as UID/GID 65532. Startup verifies the actual Node executable hash (`a03953a7b16bff002b94d6fb58ada900b68241cbcaee6efc400b20dadd36dddc`) and the inventory before importing private or native modules. The shell checks the official Node/Yarn version metadata before removing only those two inert variables. Node loader, native-library, Prisma, OpenSSL, CA and debug overrides are rejected instead of being silently removed.

Build from the repository root using the canonical installed lock versions and Node 20.20.1:

```sh
node backend/atlas-private/scripts/generate-database.mjs
node backend/atlas-private/scripts/build.mjs
node --test backend/atlas-private/test/*.test.mjs

# Select canonical absolute paths; the output directory must not exist.
mkdir -p /private/tmp/atlas-private-container-cache
node backend/atlas-private/scripts/package-container.mjs \
  --cache /private/tmp/atlas-private-container-cache \
  --output /private/tmp/atlas-private-container-candidate \
  --download

docker build --platform linux/amd64 --pull=false --network=none \
  --tag atlas-private-service:local-candidate \
  /private/tmp/atlas-private-container-candidate
docker run --rm --platform linux/amd64 --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  atlas-private-service:local-candidate --smoke
```

On Linux use a canonical path under `/tmp` instead of `/private/tmp`. Reuse an already verified cache without `--download` for offline packaging. No output directory is overwritten; create a fresh candidate path after any relevant source change. The Docker build also runs the smoke probe with its network disabled. The probe imports the actual private bundle, decodes/transforms synthetic pixels with Sharp and constructs the exact Prisma library engine without calling `$connect` or querying a database. Its receipt records the actual Node and Prisma engine hashes. A separate run without configuration must terminate with exit 78 and the bounded startup-rejection message:

```sh
docker run --rm --platform linux/amd64 --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  atlas-private-service:local-candidate
```

## Deployment boundary

This package is a local candidate until its exact committed source, image digest, required checks, provenance/signature and release admission are recorded through the approved release process. The preparation release is currently unadmitted, so packaging and passing smoke tests do not enable preparation or real grading.

A serving container must use a dedicated private Docker network, the configured internal listener (`ATLAS_PRIVATE_LISTEN_HOST=0.0.0.0`, port 8091), a read-only root filesystem, dropped capabilities and no host port publication. The authorized private proxy supplies the external transport boundary. Runtime secrets are injected by the deployment owner through the validated configuration; they are never Docker build arguments, image layers or package inputs.

Mount the separately admitted operator artifact and its independently pinned manifest read-only at the paths required by the runtime. Its Node executable must match the actual Node bytes in this same pinned base. The image does not generate, replace or admit that artifact. The database credentials retain the separate restricted roles checked by the private runtime. Preparation, geometry, registration, storage and operator credentials remain separate scoped ports. Passing the local smoke probe supplies no provider, database, private transport or paid-worker admission evidence.
