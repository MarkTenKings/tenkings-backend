# Final ATLAS source build checks — September 24, 2026

All three production builds passed in the one owned Linux/amd64 fixture. Customer API function metadata records110 seconds. Public boundary:13chunks/10traces/712files; staff boundary:32chunks/15traces/3003files. Customer/public/staff build and artifact receipts are retained here.

The final source manifest is `bba67e1ced915580936c604007ac1c75016f0d9a3244d3a9e07bc6b2962aff23` (1,020files). Customer built immediately before a documentation-only integration note changed; `customer-to-final-source-diff.json` records that distinction. `post-test-source-diff.json` confirms every final manifest byte was unchanged after the tests.

- Changed-package integration:424tests,423pass,1native opt-in skip,0fail. The separate real native CPU opt-in test then passed, with six other tests excluded by its explicit name selection. Those six are not additional executed tests.
- Customer/public and seven affected staff suites:117pass,0fail,0skip across22test files. This includes the generated report dependencies missing from the earlier host-only attempt.
- Current HEIF source was compiled against the existing Linux native libraries before integration; `local-native-identity.json` binds the exact local addon. This fixture image is a build dependency source, not the final production candidate or proof of production native preservation.
- `staff-traces.json` retains every resolved server trace and confirms zero paths outside `/build`. The customer-service-v1 bridge marker does not occur in staff JavaScript and the customer bridge source is not a traced staff artifact; its runtime import belongs to the separate private customer listener. The initial capture assertion assumed otherwise and was corrected to record the observed dependency fact, without changing any application source. Staff was fully rebuilt regardless.

Fixture identity and resource isolation are in `fixture.json`. It used no host mounts and no network, with writable owned tmpfs only and the default HOME preserved. `cleanup.json` records nonce/image/ID-verified removal plus an independent failed inspect; no other container was touched. Existing cached dependencies were copied without changing shared worktrees or installing on the host. No hosted deploy, database/provider effect or production mutation occurred during these checks.
