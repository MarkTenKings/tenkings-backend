import { prisma } from '@tenkings/database';
import { atlasMachineInitializationConfig, createAtlasMachineInitialization } from '../../../../../lib/server/atlasMachineInitialization';
import { createAtlasMachineInitializationHandler } from '../../../../../lib/server/atlasMachineInitializationHttp';
import { atlasIntakeConfig } from '../../../../../lib/server/atlasIntake';
export const config = { api: { bodyParser: false }, maxDuration: 20 };
export default createAtlasMachineInitializationHandler('ADMIT', { settings: atlasMachineInitializationConfig,
    receive: (settings, body, signature) => createAtlasMachineInitialization(prisma, settings).admit(body, signature, atlasIntakeConfig()) });
