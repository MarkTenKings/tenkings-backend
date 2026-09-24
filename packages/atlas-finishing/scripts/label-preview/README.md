# Local label studio

Generate a standalone HTML editor from the real, versioned label renderer:

```sh
node packages/atlas-finishing/scripts/label-preview.mjs /tmp/atlas-label-design.html
```

The output must be outside the repository. It embeds the supplied logo and real renderer modules; it needs no provider, server, printer or NFC reader. The editor changes only its synthetic sample and draft design. Name, optional variant, font, size and tracking controls use the shared `label-design.mjs` defaults and validation. Reset restores those defaults. An invalid sample clears the old front and disables export.

**Download design JSON** records `atlas-label-design-draft-v1`, the validated template and logo digest, the sample name/parallel, and `productionActive:false`. Review an exported draft before updating the approved template. Downloading it does not alter any approved finishing plan, enrolled station or qualified print profile. The v2 reverse remains opaque black regardless of front typography.

For the existing local workflow review hub, append `--hub`. After generating and verifying the matching default PDF, add `--pdf-href /label/actual-size.pdf`. The PDF represents the saved default; current slider adjustments remain a separate draft. Without this flag the editor visibly marks the PDF proof as being refreshed.

The generator bundles `client.mjs`, `preview.css` and `shell.html`; no generated HTML, label proofs or browser screenshots belong in Git. This editor does not affect the normal staff workflow.
