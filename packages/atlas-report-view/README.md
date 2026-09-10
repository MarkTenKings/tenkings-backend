# ATLAS report presentation

Shared React report component, CSS and strict public packet schema. These modules receive server-verified data and have no database, storage, authentication, grading calculation, network call or approval authority. `GradedReport` displays both staff drafts and public approvals with explicit synthetic labeling. Public schema validation is used before approval storage and again by the public reader; unknown/internal fields and unapproved findings are rejected. Existing authoritative grading remains in `@atlas/grading-core`.
