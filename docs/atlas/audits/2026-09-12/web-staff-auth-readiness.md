# Connected manual web and staff-auth release review

September 12, 2026. Fresh Astra/xhigh specialist review of handoff commit
`aeb8e68dd6ea007d2bc11ccf568f771375a52af2`. No deployment, provider configuration,
SMS, paid identification, production database or object mutation occurred.
The dedicated Vercel staff application and separate private Linux service remain
the intended boundary. This review adds a narrow local transport correction;
the previously sealed 497-file image remains evidence for its original source,
not for this new delta.

## Observed deployment and remaining provider readback

An authenticated Chrome Vercel UI read verifies staff deployment
`dpl_V8k7yMUQQhKDaqYsyFSpgArh5A6L`, hostname
`atlas-grading-staff-fhhgiscxz-ten-kings.vercel.app`, as Ready, Production/Staged,
on source `89c55d916130d914f6a989197538c8bbd31c9594`. It has seven historical
functions and no new manual page. The project overview's “No Production
Deployment” means no promoted production target; the exact deployment page
independently identifies the staged artifact as Production. Do not promote the
staff project itself to replace the public `/admin` gateway.

The exact deployment settings show Fluid Compute enabled, Node20.x, iad1,
standard 1vCPU/2GB, legacy standard deployment protection and 12-hour skew
protection. Current project duration has no override; its visible default
placeholder is 300 seconds. The inspected UI does **not** expose the deployed
catch-all API's individual maximum duration. Source declares 240 seconds; the
new staged deployment's actual function metadata still needs readback.
Vercel displays a September30,2026 end date for new Node20 builds. This is a
future release constraint, not evidence that today's Node20 build is refused;
no runtime upgrade was made.

The canonical CLI credential returned403 for five read-only API metadata
requests. Its token was never printed. Chrome's existing login supplied the
deployment observations above. Current environment values, secret equality,
public gateway upstream/alias and new candidate bindings were not independently
verified by this specialist. The summary receipt records these limits rather
than presenting retained provider JSON as fresh evidence.

## Request-duration finding and correction

The public middleware uses `NextResponse.rewrite` with `proxyTimeout:240000`.
It does not implement an application response buffer. The staff API declares
`maxDuration:240`. The new manual proxy has a210-second fetch/body deadline;
private service graceful drain is215seconds. Those values alone do not cover
the outer idle boundary: Vercel documents a120-second initial/between-chunks
timeout for external proxy responses. [Vercel origin timeout](https://vercel.com/changelog/cdn-origin-timeout-increased-to-two-minutes),
[function duration](https://vercel.com/docs/functions/configuring-functions/duration).

The handoff proxy buffered the entire private response and emitted no bytes
until completion. Thus a legitimate slow preparation/initialization request can
lose the rewritten connection before the210-second proxy deadline. This is a
transport reliability gap, not proof that committed evidence is lost or paid
work is duplicated. Private HTTP handlers do not pass the proxy socket's
disconnect signal into connected processing; already-started work may finish.
Intake preparation returns its stored source on replay, workflow actions retain
their exact action IDs, and identification's unique photo-pair claim prevents
repeat OCR/model dispatch. An existing RUNNING/UNKNOWN identification is not
blindly retried. These facts protect recovery; they do not make routine gateway
timeouts desirable.

The lead authorized this small correction:

- Authenticated POSTs still dispatch once to the same signed private endpoint.
  If they remain open after15seconds, the Vercel proxy sends JSON whitespace
  every15seconds, with `no-transform` and `X-Accel-Buffering:no`.
- Fast responses preserve their normal HTTP status/body. After streaming starts,
  HTTP200 is only the transport status; one strict
  `atlas-manual-response-v1` terminal envelope carries the actual status/body.
  Heartbeats cannot represent dispatch, successful save or human approval.
- A browser-safe decoder preserves actual401/403/409/422 and uncertain503/504
  meanings. Truncation, wrong protocol, stripped protocol header and invalid
  terminal status remain unknown outcomes. Both real readers use it:
  `manualRequest` and the manual workflow client. Intake already receives
  `manualRequest` by injection, so no third decoder or dependency was added.
- GET/image behavior,210-second proxy deadline,240-second function/proxy
  settings, response-size bounds, native processes, accounting and replay
  identities stay intact. Close/abort stops heartbeat writes and the transport;
  it does not assert cancellation of a private operation.

The server artifact allowlist adds only `atlas-manual-service/package.json` and
its new browser-safe `src/response.mjs`. No persistence or native service import
is allowed into this web path by that change. The final staged hosted acceptance
must observe actual chunks through `/admin`, including a response lasting beyond
120seconds, plus a terminal refusal. A local socket test is not proof of the
Vercel CDN's behavior. The proxy and both readers must ship in one matched staff
artifact; the earlier reader cannot interpret the new slow-response envelope.

## Authentication, image and coordinated-release review

Source checks retain these boundaries:

- Public forwarding replaces caller routing/bypass headers and signs the exact
  mounted method/target/deployment. Staff ingress verifies the HMAC,30-second
  age, host, HTTPS and exact API query. A caller bearer does not grant staff
  authority. Customer login remains separate.
- The manual web wrapper checks this ingress, JSON/origin/same-origin fetch,
  CSRF and `DurableStaffAuth.authenticate` before invoking the proxy or starting
  a heartbeat. The private transport binds exact method/path/body, cookie,
  CSRF, origin, content-type, timestamp and one-use nonce. It drops browser
  actor/signature claims and refuses redirects.
- Private access configuration explicitly binds the admitted Vercel deployment
  and release. Ordinary cookie authentication is repeated privately, and the
  restricted manual SQL boundary refreshes current staff/browser/control/role
  authority before and after short transactions. Current reviewer certification
  remains required for separate report approval. No certification was seeded.
- The manual service key must be canonical32-byte base64 and distinct from
  session, phone and router keys. Single-process nonce storage is bounded and
  fail-closed; replicas require a shared atomic store before activation.
- Signed PUT/GET origins must equal the configured upload origin. CSP includes
  that precise HTTPS origin; browser review verifies object byte count/hash and
  uses Blob images. Storage endpoint, CORS/private access and conditional-write
  behavior still require the storage specialist's actual-provider qualification.

For the concrete release plan, record the new exact staff deployment/release,
its baked CSP/upload origin, manual service origin/key identity, private image
digest/config hash, TLS ingress, DB migrations/role grants and staff-control
binding. `makeAccessConfig` hashes deployment and release, so changing only
feature environment flags cannot establish a matched ordinary session. A
Vercel environment edit requiring redeploy creates a new deployment identity;
bind the private service and control to the **final** staged artifact.

Keep staged candidates protected and unadmitted while prerequisites are checked.
The shared current staff-control binding makes final auth activation a
coordinated change; account for old private-I consumers explicitly. Preserve
their history and do not silently replace or restart the old grading operator.
After matched private/auth/storage readiness, switch the public gateway to that
exact staff artifact and verify ordinary staff access, denials, mounted assets,
chunks and fresh native intake. Existing source/native tests do not establish
fresh physical-card detail, optical/color acceptance or a real human approval.

Rollback must restore a complete prior route plus matching ordinary staff
control/runtime binding, or close new intake. A project environment toggle alone
does not alter already-built code/CSP. Preserve all native originals, manual
rows, action/effect receipts and approved snapshots; do not drop schemas or
restart canceled old cards. The lead separately found and is correcting a
same-card cross-tab journal race in `ManualCards.jsx`; that component and its
evidence are outside this specialist's edits.

## Verification and evidence

Shared root:
`/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/web/`.

- `tests-node20-wire-final.log`:32 tests pass on Node20.20.1, no failures/skips.
  Tests include actual loopback HTTP first-byte-before-upstream completion,
  terminal409, delayed success/refusals, timeout504, disconnect cleanup,
  ordinary auth before streaming, both actual readers, and durable same-command
  recovery. The owned HTTP test servers are closed by their test cleanup.
- `browser-reader-boundary.json`: both readers bundle for the browser from four
  fresh source files, with no native/server module. Output stayed in memory.
- `cold-web-import-fresh.json`: fresh-source web import passes an explicit
  native/provider import guard, with zero network calls.
- `vercel-browser-observations.json`: compact facts observed in the signed-in
  Chrome UI; `vercel-metadata.json` retains the API403 attempt.
- `source-seal.json`: this specialist's exact file hashes and evidence hashes.

No dependencies were installed. A local resolver forces current workspace
packages and uses retained ecd7 third-party dependencies. Existing per-package
symlinks remain untouched; only absent root workspace-package links were added,
recorded in `test-symlinks.json`. Earlier setup failures (system Node25 cold-child
resolution and one misspelled test filename) are retained. Because another
specialist's per-app links can resolve old workspace packages in a child that
sanitizes its environment, the additional cold-import and browser bundle checks
explicitly force the fresh files. Full clean-build artifact/target-host and
hosted release acceptance remain required for the integrated delta candidate.

## Source publication follow-up — September 12

The existing signed-in Chrome dashboard confirms one project connected to
`MarkTenKings/tenkings-backend` in the visible Ten Kings team:
`tenkings-backend-nextjs-app` (`prj_trW9xKIEQl6ye9Vq9V9PuDtCILxI`). The Git
settings **Manage projects** dialog explicitly lists that repository's team
projects and contains only this project; it was canceled without changes.
The team overview displays eleven projects. The three dedicated ATLAS projects
and three older service/app projects display **Connect Git Repository**; the
remaining four cards identify other Git repositories. This is a team-scoped
inventory, not a claim about projects in inaccessible accounts or teams.

The legacy project's [build settings](https://vercel.com/ten-kings/tenkings-backend-nextjs-app/settings/build-and-deployment)
show root `frontend/nextjs-app`, build `cd ../../ && pnpm -w run vercel:build`,
install `cd ../../ && pnpm install --frozen-lockfile`, output `.next`, Node22,
and inclusion of files outside the root. Skip-unaffected deployments is disabled;
Ignored Build Step is **Automatic**. Git/deployment sources inherit unrestricted
team policy. [Environment settings](https://vercel.com/ten-kings/tenkings-backend-nextjs-app/settings/environments)
track production `main` and enable preview tracking for **All unassigned
branches**. No custom environment or deploy hook was listed. Recent ATLAS
receipt-recovery and live-workspace branch previews are visibly Ready.

The [protection settings](https://vercel.com/ten-kings/tenkings-backend-nextjs-app/settings/deployment-protection)
have Vercel login, password and trusted-IP requirements disabled. A concealed
automation bypass secret exists, but the UI says it has no effect without
enabled protection. Preview variable labels show `TWILIO_AUTH_TOKEN`,
`TWILIO_ACCOUNT_SID`, `TWILIO_SMS_FROM`, `SOLDCOMPS_API_KEY` and `SERPAPI_KEY`
shared between Production and Preview. A targeted preview search shows
`OPENAI_API_KEY` scoped to All Environments. Values remained concealed.
The Shared preview tab reports no linked variables; searches for `DATABASE`
and `BRIDGE` return no matches. Those searches are not proof that equivalent
database/bridge capabilities are absent, and no live credential was exercised.

At the lead's explicit direction, added only
`"codex/atlas-connected-manual-release-20260912": false` to the legacy root's
`git.deploymentEnabled` map. All eight existing entries, including `main:false`,
remain unchanged. This file is outside the qualified 505-file manual image
closure. Node20.20.1 parsed both JSON versions, checked the exact current branch,
and proved removal of this one new key restores the complete prior document.

This is the documented source-only suppression mechanism: Vercel's
[Git configuration](https://vercel.com/docs/project-configuration/git-configuration)
supports an exact branch key set to false, with unspecified branches enabled;
its [static configuration](https://vercel.com/docs/project-configuration/vercel-json)
belongs in the configured project root. The visible provider root matches
`frontend/nextjs-app/vercel.json`. No true or wildcard rule conflicts with this
new exact exclusion. Thus the reviewable commit includes suppression for the
only repository-linked project visible in the team. No push was performed,
so actual provider acknowledgement of a skipped push remains future evidence.
Unexcluded branches and existing preview deployments retain the observed
unprotected credential posture; this change does not remediate those settings.

Receipt: `source-publication-browser-20260912.json` in the shared web evidence
directory (SHA256 `4e7fd07aeb258d0ebb0a47326c017b11db3b28fded4ea18a5af3d2e537d99529`).
`source-publication-seal.json` separately binds the refreshed audit, configuration
and receipt. The earlier `source-seal.json` is preserved as its historical
checkpoint. No provider setting, deployment, login, credential, SMS or paid
provider action was performed. The earlier serving-code freeze remains intact.
