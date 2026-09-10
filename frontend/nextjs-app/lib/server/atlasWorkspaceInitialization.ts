import type { PrismaClient } from '@prisma/client';
import { canonical, digest, requireBridge } from '@atlas/service-bridge/protocol';
import { createWorkspaceInitializationService } from '@atlas/service-bridge/workspace-initialization-service';
import type { MachineInitializationConfig } from '@atlas/service-bridge/machine-initialize';
import { atlasIntakeSourceTitle } from './atlasIntake';
import type { createAtlasGradingPorts } from './atlasGradingBridge';
import type { AtlasWorkspaceSourceHostDependencies } from './atlasWorkspaceSourceHost';
import type { createAtlasWorkspaceSourceAuthority } from './atlasWorkspaceSourceAuthority';
import { resolvePersistedSpeedsterPreparationCapture, speedsterPreparationSideAuthority } from './speedsterPreparationCaptureEvidence';
import { currentSpeedsterPreparationRelease } from './speedsterPreparationRelease';
import type { SpeedsterReviewActionSession } from './aiGraderV2ReviewAction';

/** Explicit private-host ports retain the original signed preparation and
 * full detector/trace/measurement service. No environment or default database
 * client is imported here and no historical source is selected. */
export function createAtlasWorkspaceInitialization(options: {
    client: PrismaClient; authority: ReturnType<typeof createAtlasWorkspaceSourceAuthority>;
    config: MachineInitializationConfig & { staffDeploymentId: string; staffReleaseSha: string };
    sourceConfigHash: string; gradingPorts: ReturnType<typeof createAtlasGradingPorts>;
}): AtlasWorkspaceSourceHostDependencies['initialization'] {
    const ports = { ...options.gradingPorts, sourceTitle: atlasIntakeSourceTitle,
        sourceAdmission(source: SpeedsterReviewActionSession) {
            const resolved = resolvePersistedSpeedsterPreparationCapture(source), preparationRelease = currentSpeedsterPreparationRelease();
            const capture = resolved.capture as Record<string, unknown>;
            const front = speedsterPreparationSideAuthority(capture.front), back = speedsterPreparationSideAuthority(capture.back);
            requireBridge(preparationRelease && front && back, 'WORKSPACE_PREPARATION_REQUIRED');
            return { preparationRelease: { ...preparationRelease }, frontAuthorityHash: digest(canonical(front)), backAuthorityHash: digest(canonical(back)) };
        },
    };
    return ({ request, ledger }) => createWorkspaceInitializationService({ client: options.client, authority: options.authority,
        config: options.config, sourceConfigHash: options.sourceConfigHash, ports, request, ledger });
}
