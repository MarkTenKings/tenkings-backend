import { prisma } from '@tenkings/database';
import { atlasMachineInitializationConfig, createAtlasMachineInitialization } from '../../../../../lib/server/atlasMachineInitialization';
import { createAtlasMachineInitializationHandler } from '../../../../../lib/server/atlasMachineInitializationHttp';
export const config = { api: { bodyParser: false }, maxDuration: 240 };
export default createAtlasMachineInitializationHandler('EXECUTE', { settings: atlasMachineInitializationConfig,
    receive: (settings, body, signature, signal) => createAtlasMachineInitialization(prisma, settings).execute(body, signature, signal) });
