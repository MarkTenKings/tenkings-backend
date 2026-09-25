# ATLAS scalable processing: capacity qualification

Status: implementation and testing in progress. The production deployment has not changed to this candidate. Full sustained throughput and twenty-card live ASTRA capacity are not yet proven.

## What is already measured

- Fifty retained full-resolution originals uploaded to the configured storage at twenty-five image arrivals per minute. All fifty were read back and SHA-256 verified. Including the final verification, the run took 120.342 seconds; p95 upload was 2.241 seconds and p95 verification was 8.789 seconds.
- One actual provider run completed automatically through its machine report in 304.592 seconds. It did not certify the card. One out-of-outline model proposal was preserved for human review instead of crashing the report.
- A twenty-card Mac run uploaded and verified all forty originals, but preparation was too slow. The run was intentionally stopped, accepted provider work was reconciled, and the isolated database was retained. This is not a concurrency pass.
- A four-image Linux composite on two CPU cores took 55.90 seconds through preparation, request-image generation and CPU measurements. The subsequent full-runtime replay showed growing queues and nearly two cores of CPU use. A replay-provider GET defect invalidated that run as a complete-report capacity measurement; its original upload, verification and CPU observations remain partial evidence only.

An image is one original photograph. At two photographs per card, twenty-five images per minute is twelve-and-a-half card pairs per minute. These tests use approximately twelve-megapixel JPEG originals of 5.2–6.7 MB each. They do not establish throughput for a future camera or RAW files.

## Candidate changes being qualified

Durable database work records carry originals through verification, preparation, admission, identity, ASTRA and reports. Machine authorization does not depend on the capture browser remaining open. Expiring leases, retry backoff, stable request identities and receipt reconciliation recover interrupted work. Originals remain byte-identical. Accepted or uncertain paid requests are not blindly resubmitted.

Automatic preparation creates the exact rectified and inspection images consumed by grading. The three optional reveal views are deferred, retaining the verified lossless source and saved geometry for later generation. Manual five-view preparation remains available. Native, geometry, discovery and model concurrency are separately bounded; changing a number does not establish safe hardware capacity.

## Proposed dedicated capacity test

Prepare a separate DigitalOcean CPU-Optimized server in the same region as ATLAS storage and database, with sixteen dedicated vCPUs and 32 GiB RAM. The current shared server and unrelated applications remain in place. The test server initially has no public application ingress. Use the qualified immutable candidate image, a new isolated database and task-owned storage prefixes. Copy only the runtime dependencies and credentials required for the explicit test through authenticated encrypted transport. Do not copy production database contents.

The listed regular CPU-Optimized price checked on 2026-09-25 is **$0.50/hour, capped at $336/month**, before applicable tax or additional services. Source: [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets). No server has been provisioned or charged by this proposal. Regional availability and the actual checkout price must be checked before creation.

Requested test budget: **at most $3 of additional server usage**. Retain test receipts and results locally. Stop and remove only the newly created test server after results are safely retained unless continued production use is explicitly approved. A stopped DigitalOcean server still incurs charges; powering it off alone does not end billing.

If the candidate passes, keeping this capacity in production is a separate recurring commitment unless the owner explicitly approves both test and production use. Final production networking, database grants, migration, release bindings and rollback must be reviewed against the actual server identity before cutover. A passing isolated benchmark does not authorize changing unrelated services.

## Acceptance checks

1. First run a single-card complete pipeline replay, including the real executor's POST → GET → persisted receipt lifecycle, to validate the harness.
2. Run sustained representative original arrivals at twenty-five images per minute. Count uploads, checksum verifications, prepared pairs, model admissions and complete reports separately. Report queue growth, oldest queue age, CPU, memory peak, retries and final drain time. A configured concurrency value or upload-only success cannot pass this check.
3. After verified originals are stored, terminate the owned worker process and start a fresh process against the same isolated database and storage. Revoke the browser session. Verify automatic completion without client callbacks and without duplicate model admission.
4. Run an actual single-card ASTRA baseline and an actual twenty-card trial. Measure accepted simultaneous work, individual and batch report latency, and the ratio to the baseline. Report the provider's observed capacity instead of assuming twenty configured jobs mean twenty concurrent model requests.
5. Exercise recoverable storage/network failures, lease expiry, safe rate-limit retry and uncertain provider acceptance. Verify that retries retain originals, prior work and request receipts. An ambiguous card or proposal must surface a specific human-review state, not silently invent a grade or stall behind a generic save message.
6. Confirm changed-source regression checks, immutable source/native identities, migration/role boundaries, production rollback and live signed request verification before promoting the release.

No finite test proves that all future cards, devices and provider conditions will be failure-free. The release record must distinguish demonstrated performance from untested camera formats, workloads and external provider limits.
