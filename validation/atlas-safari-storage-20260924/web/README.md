# Capture and storage web release evidence

The three actual READY deployments and public promotion use web source `fa966112bd5028fbed61f086c15ad3a72f4fc16d`. The retained private image remains `sha256:532cfa57c6f86404db62a378094fa4d7af9fada38877ff649fe8dbc4a6ec252a` from native source `47cb501adfd609ff3ba863851b65580f0868ab53`. No claim is made that the private image was built from the web commit.

The three local app artifacts were compiled from `a5f4fb13b22f36f131b17b6982d95e55b48a8a0f`. Its staff build compiled successfully, then rejected the new browser-only photo byte helper in the strict packaging check. The final successor changes only that exact allowlist and SESSION_LOG. All application and test source bytes, and all three artifact hashes, remain identical. The corrected final-source staff check passes; the isolated full frontend suite passes 723/723. Vercel built the final source and returned three actual READY records.

Public project changes comprise two existing upstream-origin rows and one guarded promotion. All customer environment rows and every other public row were preserved. The first origin-apply attempt stopped at an expired-token read before consuming an intent or sending any PATCH; normal CLI refresh restored the existing account. The fresh successful plan performed the two previously unconsumed writes once.

Files in this directory contain selected statuses, hashes, counts, deployment identities and public origins. They exclude environment dumps, credential values, sessions, photographs and customer records. Internal private-service cutover/control and canonical acceptance evidence belong to the companion runtime/customer evidence packages.

`manifest.json` hashes every selected file except itself. JSON `protectedReceipt` fields are relative to the external evidence root `/Users/markthomas/.codex/atlas-handoffs/atlas-capture-storage-20260924/web-release`, not to this directory. Their SHA-256 values identify the original protected receipts retained outside the repository.
