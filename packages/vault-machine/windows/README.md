# Vault Windows source artifacts

These files are development source artifacts, not a production installer. `install.ps1`
and `update.ps1` only stage a create-only release under `InstallRoot/staged/version`.
They verify a manifest digest obtained from the approved release channel, validate
Windows-safe relative paths, reject links/unlisted content, copy only verified members,
then recheck the staged bytes. They never alter a serving release or service.

Use Node 20 for manifest validation. The manifest must live outside the release member
directory and contain:

```json
{
  "schemaVersion": 1,
  "version": "1.0.0",
  "sourceCommit": "0123456789abcdef0123456789abcdef01234567",
  "nodeMajor": 20,
  "files": [{ "path": "dist/cli.js", "size": 123, "sha256": "<64 hex characters>" }]
}
```

The example is structural only; actual members, sizes and digests must be generated from
the reviewed release. A checksum supplied alongside untrusted content is not release
approval. The manifest digest must be checked against separately approved provenance.

`update.ps1 -Activate` and `rollback.ps1` fail before any service or release mutation.
Activation still needs implementation: a trusted machine-service maintenance barrier,
completion/reconciliation of active work, consistent encrypted backup and restore,
app/schema/config compatibility validation, signed release provenance, pinned Node 20
and compatible Windows native SQLite binary, service account/registration and protected
credentials, assigned-access setup, and installed-machine update/power-cut/rollback tests.
The WinSW XML is a quoted-path template, not an installed service or approved wrapper.

The support PowerShell script collects OS/service metadata only. The fuller redacted
machine diagnostic exporter remains in the machine package and must be integrated into
the final authorized Windows release. No source script proves hardware or appliance acceptance.
