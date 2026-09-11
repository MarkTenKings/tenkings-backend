/** Public vocabulary only. These labels never confer workflow authority. */
export const WORKSPACE_STATES = Object.freeze(['DRAFT', 'WAITING', 'IN_PROGRESS', 'NEEDS_ATTENTION', 'HUMAN_REVIEW', 'APPROVED']);
export const WORKSPACE_STAGES = Object.freeze(['PHOTOS', 'IDENTITY', 'PREPARATION', 'CENTERING', 'INSPECTION', 'REPORT', 'REVIEW', 'FINISHING']);
export const WORKSPACE_SIDES = Object.freeze(['FRONT', 'BACK']);
export const WORKSPACE_ACTIONS = Object.freeze(['SAVE_IDENTITY', 'SAVE_BOUNDARY', 'PREPARE_SIDE', 'SAVE_CENTERING', 'RESOLVE_MAP', 'REGISTER_MAP', 'CONTINUE_WITHOUT_MAP', 'INITIALIZE_REPORT']);
export const WORKSPACE_MAP_STATES = Object.freeze(['LOADED', 'NO_MAP', 'LOOKUP_FAILED', 'INTEGRITY_ERROR', 'REGISTRATION_BLOCKED', 'HUMAN_REVIEW_WITHOUT_MAP', 'APPLIED']);
export const WORKSPACE_MAP_ACTIONS = Object.freeze({ RESOLVE_MAP: 'resolveMap', REGISTER_MAP: 'registerMap', CONTINUE_WITHOUT_MAP: 'continueWithoutMap' });
export const workspaceMapReady = map => map?.status === 'NO_MAP' || map?.status === 'HUMAN_REVIEW_WITHOUT_MAP'
    || ['LOADED', 'APPLIED'].includes(map?.status) && map.bindingReady === true;
export const WORKSPACE_CONTROLS = Object.freeze(['PAUSE', 'RESUME', 'STEP', 'TAKE_OVER', 'RECOVER']);
export const WORKSPACE_MAX_CARDS = 10;
export const WORKSPACE_MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const WORKSPACE_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const WORKSPACE_STATE_NAMES = Object.freeze({ DRAFT: 'Photo drafts', WAITING: 'Waiting to grade', IN_PROGRESS: 'In progress',
    NEEDS_ATTENTION: 'Needs attention', HUMAN_REVIEW: 'Human review', APPROVED: 'Approved' });
export const WORKSPACE_STAGE_NAMES = Object.freeze({ PHOTOS: 'Photos', IDENTITY: 'Card details', PREPARATION: 'Prepare images',
    CENTERING: 'Centering', INSPECTION: 'Inspect card', REPORT: 'Draft report', REVIEW: 'Human review', FINISHING: 'Finishing' });
