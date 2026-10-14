import { staffGrantSQL } from '../../frontend/atlas-app/lib/server/access/privileges.mjs';
import { customerGrantSQL } from '../../frontend/atlas-customer/lib/server/database.mjs';
import { customerPrivateGrantSQL } from '../atlas-connected-manual/scripts/customer-database.mjs';
import { manualGrantSQL } from '../atlas-manual-service/src/staff-auth.mjs';
import { machineGrantSQL } from '../atlas-manual-service/src/machine-auth.mjs';
import { intakeGrantSQL, ingestionGrantSQL } from '../atlas-manual-intake/src/repository.mjs';
import { connectedGrantSQL } from '../atlas-connected-manual/src/details.mjs';
import { analysisGrantSQL, analysisReceiptGrantSQL } from '../atlas-defect-analysis/src/repository.mjs';
import { defectMemoryGrantSQL } from '../atlas-defect-memory/src/repository.mjs';
import { learningGrantSQL } from '../atlas-defect-memory/src/publication-worker.mjs';
import { batchGrantSQL } from '../atlas-batch-grading/src/repository.mjs';
import { publicationGrantSQL } from '../atlas-connected-manual/src/publication-repository.mjs';
import { presentationGrantSQL } from '../atlas-connected-manual/src/presentation-repository.mjs';
import { earlyGeometryGrantSQL } from '../atlas-connected-manual/src/early-geometry-store.mjs';
import { reportImageGrantSQL } from '../atlas-connected-manual/src/report-image-store.mjs';
import { marketJobGrantSQL } from '../atlas-connected-manual/src/market-job-store.mjs';
import { variantJobGrantSQL } from '../atlas-connected-manual/src/variant-job-store.mjs';
import { variantWorkerGrantSQL } from '../atlas-connected-manual/src/variant-worker-grants.mjs';
import { dealerStaffGrantSQL } from '../atlas-connected-manual/src/dealer-operations.mjs';
import { orderDeskGrantSQL } from '../atlas-connected-manual/src/order-desk.mjs';
import { orderDeskInboxGrantSQL } from '../atlas-connected-manual/src/order-desk-inbox.mjs';
import { labelGrantSQL } from '../atlas-connected-manual/src/label-sheet-repository.mjs';
import { finishingStationGrantSQL } from '../atlas-connected-manual/src/finishing-station-repository.mjs';

const roleName = value => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('STANDALONE_ROLE_INVALID');
  return `"${value}"`;
};

export function manualRuntimeGrantSQL(role) {
  roleName(role);
  return [manualGrantSQL, machineGrantSQL, intakeGrantSQL, ingestionGrantSQL,
    connectedGrantSQL, analysisGrantSQL, analysisReceiptGrantSQL, defectMemoryGrantSQL,
    learningGrantSQL, batchGrantSQL, publicationGrantSQL, presentationGrantSQL,
    earlyGeometryGrantSQL, reportImageGrantSQL, marketJobGrantSQL, variantJobGrantSQL,
    dealerStaffGrantSQL, orderDeskGrantSQL, orderDeskInboxGrantSQL, finishingStationGrantSQL, labelGrantSQL]
    .map(grant => grant(role)).join('\n') + `\nGRANT EXECUTE ON FUNCTION atlas_manual_connected.read_grading_photo(uuid,uuid,text,text) TO \"${role}\";`; 
}

// Credentials are deliberately absent. The release operator binds fresh LOGIN
// credentials only after independently verifying the destination and controls.
export function standaloneRoleSQL(roles) {
  const names = ['staff', 'manual', 'variant', 'customer', 'customerPrivate'];
  if (!roles || Object.keys(roles).length !== names.length || names.some(name => !Object.hasOwn(roles, name))
      || new Set(Object.values(roles)).size !== names.length) throw new Error('STANDALONE_ROLES_INVALID');
  const create = names.map(name => `CREATE ROLE ${roleName(roles[name])} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS${name === 'variant' ? ' CONNECTION LIMIT 1' : ''};`);
  return [...create, staffGrantSQL(roles.staff), manualRuntimeGrantSQL(roles.manual),
    variantWorkerGrantSQL(roles.variant), customerGrantSQL(roles.customer),
    customerPrivateGrantSQL(roles.customerPrivate)].join('\n');
}
