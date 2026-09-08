import { prisma } from '@tenkings/database';
import { atlasIdentityCorrectionConfig, createAtlasIdentityCorrection } from '../../../../lib/server/atlasIdentityCorrectionBridge';
import { createAtlasIdentityCorrectionHandler } from '../../../../lib/server/atlasIdentityCorrectionHttp';
export const config={api:{bodyParser:false},maxDuration:30};
export default createAtlasIdentityCorrectionHandler({settings:atlasIdentityCorrectionConfig,
    receive:(settings,body,signature)=>createAtlasIdentityCorrection(prisma,settings).receive(body,signature)});
