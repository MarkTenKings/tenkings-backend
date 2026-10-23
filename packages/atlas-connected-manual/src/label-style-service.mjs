import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { approvedBStyleInputLines } from '@atlas/finishing/label-approved-b';
import { LABEL_STYLE_FONT_CATALOG } from '../../atlas-finishing/src/label-style-paint.mjs';
import { applyReviewedLabelStylePreferences } from '../../atlas-finishing/src/label-style-preferences.mjs';
import { prepareLabelStyleRequest, validateLabelStyleSpec } from './label-style-contract.mjs';
import { createLabelStylePhotoProvider } from './label-style-provider.mjs';
import { createLabelStyleResolver } from './label-style-resolver.mjs';
import { deriveLabelStyleTextures } from './label-style-textures.mjs';
import { createLabelWordmarkProvider } from './label-wordmark-provider.mjs';
import { prepareLabelWordmarkRequest } from './label-wordmark-contract.mjs';
import { createLabelWordmarkResolver } from './label-wordmark-resolver.mjs';

/** Called only by a claimed label job, never by artwork/page reads. The exact
 * public packet and private approved-media manifest supply both photographs.
 * Model work cannot alter a human approval or enrich unconfirmed card facts. */
export function createApprovedLabelStyler({apiKey,imageApiKey,cache,artifacts,storage,fetchImpl=globalThis.fetch}) {
  requireThat(cache?.read&&cache?.putIfAbsent&&artifacts?.read&&storage?.readDerivative,503,'LABEL_STYLE_CONFIGURATION_INVALID');
  return Object.freeze({async resolve({packet,row,publicHash}, {signal}={}) {
    const report=packet.report, manifest=JSON.parse(row.manifest);
    requireThat(publicHash===row.public_hash&&digest(row.manifest)===row.manifest_hash&&manifest.media?.ref
      &&manifest.media.sourceHash===manifest.media.ref.sha256,503,'LABEL_STYLE_APPROVED_SOURCE_INVALID');
    const media=await artifacts.read(manifest.media.ref,{cardId:row.card_id,kind:'APPROVED_MEDIA',sourceHash:manifest.media.sourceHash},{signal});
    requireThat(digest(JSON.stringify(media))===manifest.media.sourceHash,503,'LABEL_STYLE_APPROVED_SOURCE_INVALID');
    const photos={};
    for(const side of ['FRONT','BACK']) {
      const saved=media[side], expected=packet.images[side];
      requireThat(saved?.descriptor?.raster?.content?.sha256===expected?.sha256,503,'LABEL_STYLE_APPROVED_SOURCE_INVALID');
      const image=await storage.readDerivative({...saved,signal});
      requireThat(Buffer.isBuffer(image.bytes)&&digest(image.bytes)===expected.sha256&&image.bytes.length===expected.byteCount,
        503,'LABEL_STYLE_APPROVED_SOURCE_INVALID');
      photos[side]={...expected,bytes:image.bytes,side};
    }
    const input={approval:{cardId:row.card_id,actionId:row.action_id,approvalVersion:packet.approvalVersion,publicHash,reportHash:packet.reportHash},
      identity:report.identity,cardProfile:report.cardProfile,
      photos:['FRONT','BACK'].map(side=>({side,...packet.images[side]})),lines:approvedBStyleInputLines(report.identity,{cardProfile:report.cardProfile})};
    const request=prepareLabelStyleRequest(input,{fontCatalog:Object.values(LABEL_STYLE_FONT_CATALOG),defaultFontId:'knewave'});
    const provider=createLabelStylePhotoProvider({apiKey,fetchImpl,readApprovedImage:async({photo})=>photos[photo.side]});
    const resolved=await createLabelStyleResolver({provider,cache}).resolve(request,{signal});
    if(resolved.state==='PENDING')return resolved;
    const baseSpec=validateLabelStyleSpec(resolved.spec,request);
    const spec=validateLabelStyleSpec(applyReviewedLabelStylePreferences(baseSpec,request.source.photos),request,{baseSpec});
    const textures=await deriveLabelStyleTextures({recipe:spec,photos,signal});
    const wordmarks={};
    for(const line of spec.lines.filter(line=>line.letteringMode==='ORIGINAL_WORDMARK')) {
      // Separator punctuation remains deterministic metadata. Serial fractions
      // and partially styleable identity rows never enter generated lettering.
      requireThat(line.role==='variant'&&!line.protectedSpans.length&&line.styleableSpans.length===1
        &&line.styleableSpans[0].start===0&&line.styleableSpans[0].end===line.text.length,409,'LABEL_WORDMARK_CAPTION_UNSUPPORTED');
      const text=line.text.replace(/\s*·\s*/g,' ');
      const wordmarkRequest=prepareLabelWordmarkRequest({sourceHash:spec.specHash,role:line.role,text,
        traits:line.letteringTraits,normalizeWordInkHeight:line.normalizeWordInkHeight});
      const original=await createLabelWordmarkResolver({provider:createLabelWordmarkProvider({apiKey,imageApiKey,fetchImpl}),cache}).resolve(wordmarkRequest,{signal});
      if(original.state==='PENDING')return original;
      requireThat(original.state==='READY',409,original.code??'LABEL_WORDMARK_UNAVAILABLE');
      wordmarks[line.role]={...original.artifact,sourceText:line.text};
    }
    return {state:'READY',styleSpec:spec,textures,wordmarks,
      receipt:{requestKey:request.requestKey,sourceHash:request.sourceHash,specHash:spec.specHash,
        baseSpecHash:baseSpec.specHash,state:resolved.state,wordmarks:Object.fromEntries(Object.entries(wordmarks).map(([role,{descriptor:d}])=>[role,
          {artifactHash:d.artifactHash,requestKey:d.requestKey,sourceHash:d.sourceHash,text:d.text,
            pngSha256:d.sha256,alphaSha256:d.mask.sha256,width:d.width,height:d.height,provenance:d.provenance}]))}};
  }});
}
