import { prisma } from '@tenkings/database';
import { atlasTrustedLearningConfig, createAtlasTrustedLearning } from '../../../../../lib/server/atlasTrustedLearning';
import { createAtlasTrustedLearningHandler } from '../../../../../lib/server/atlasTrustedLearningHttp';

export const config = { api: { bodyParser: false }, maxDuration: 20 };
export default createAtlasTrustedLearningHandler({ settings: atlasTrustedLearningConfig,
    receive: (settings, body, signature) => createAtlasTrustedLearning(prisma, settings).receive(body, signature) });
