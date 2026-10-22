# Staff comp web integration — October 22, 2026

The optional Card History comp-review interface now connects to a dedicated authenticated web proxy. It remains disabled unless the exact configuration flag is enabled. Browser requests cannot use the private service alias or fall back to the generic grading proxy. Existing grading requests and the saved market-read route retain their original path.

The original composition was split into web-only and native-only modules with unchanged factory bodies. The page receives only an authenticated opt-in boolean; the browser client remains bound to the same staff session and card and closes on access loss. Existing read, Skip and No suitable decisions are supported. Pricing policy stays null: this does not introduce selected price guidance, acquisition, a public listing or a money transaction.

Root qualification: 961/961 staff tests under OS network denial, zero skips; scoped lint clean; clean-environment Node22 production build and static boundary passed. The boundary checked 15 server traces and 2,031 file references. Independent reviews passed for the split, route delegation, factory and page/client. Root verified 36 factory and 46 page source/evidence references. The final integrated test run supersedes the earlier page run that had 54 passing tests and one missing parallel-module import.

Evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-staff-comp-curation-20261021/registration-integration-01/qualification.json`, SHA256 `9659dd7254af80c486319098886575f00b2754527814b0c2c25640ae3112a519`. This includes 14 exact source copies, prior qualifications and five logs. Existing actual CardHistory browser layout evidence is retained; new page lifecycle behavior was tested in the hook harness, not claimed as a new production browser check.

No deployment, production configuration, schema, grant, provider request, grade change or payment occurred. Native restricted-client registration, operational schema/roles, rights/recency/method decisions and real authenticated acceptance remain outstanding.
