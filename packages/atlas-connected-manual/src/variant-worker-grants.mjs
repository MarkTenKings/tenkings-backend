import {requireThat} from '@atlas/manual-service/contract';
import {machineGrantSQL} from '@atlas/manual-service/machine-auth';
import {analysisGrantSQL,analysisReceiptGrantSQL} from '@atlas/defect-analysis/repository';
import {variantJobGrantSQL} from './variant-job-store.mjs';
const roleName=role=>{requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role),500,'VARIANT_ROLE_INVALID');return role;};
/** Review template only. A fresh role remains NOLOGIN until the release operator
 * binds its separately protected credential; no password enters this helper. */
export function variantWorkerRoleSQL(role){roleName(role);return `CREATE ROLE "${role}" NOLOGIN CONNECTION LIMIT 1 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`;}
/** Existing schemas through77. Deliberately does not call broad serving grants.
 * UPDATE(id) permits PostgreSQL row locks, while immutable-id/revision triggers
 * forbid actual card mutation without the separately withheld revision grant. */
export function variantWorkerGrantSQL(role){roleName(role);return `GRANT USAGE ON SCHEMA atlas_manual,atlas_manual_intake,atlas_manual_connected,atlas_defect_analysis TO "${role}";
GRANT SELECT ON atlas_manual.card,atlas_manual.action,atlas_manual.approval,
 atlas_manual_intake.card,atlas_manual_intake.upload,atlas_manual_intake.ingestion,atlas_manual_intake.discarded_card,
 atlas_manual_connected.identification TO "${role}";
GRANT UPDATE(id) ON atlas_manual.card,atlas_manual_intake.card TO "${role}";
GRANT SELECT ON atlas_manual.defect_memory_publication,atlas_manual.learning_control,atlas_manual.learning_release,
 atlas_manual.learning_release_member,atlas_manual.learning_publication,atlas_manual.learning_publication_job,
 atlas_manual.learning_withdrawal TO "${role}";
GRANT EXECUTE ON FUNCTION atlas_manual.defect_memory_design(jsonb,text) TO "${role}";
${machineGrantSQL(role)}
${analysisGrantSQL(role)}
${analysisReceiptGrantSQL(role)}
${variantJobGrantSQL(role,{worker:true})}`;}
export const VARIANT_WORKER_FORBIDDEN_WRITES=Object.freeze([
 'atlas_manual.card','atlas_manual.action','atlas_manual.approval','atlas_manual.publication',
 'atlas_manual_intake.card','atlas_manual_intake.upload','atlas_manual_intake.discarded_card',
 'atlas_manual_connected.variant_confirmation','atlas_manual_connected.variant_contribution',
 'atlas_manual_connected.market_job','atlas_manual_connected.batch_grading',
 'atlas_manual.learning_publication','atlas_manual.learning_publication_job','atlas_manual.learning_release','atlas_manual.learning_control',
]);
