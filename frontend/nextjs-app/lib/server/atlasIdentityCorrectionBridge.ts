import type { Prisma, PrismaClient } from '@prisma/client';
import { makeIdentityCorrectionConfig, ScopedIdentityCorrection, identityCorrectionRawSource,
    type IdentityCorrectionConfig, type IdentityCorrectionLocator, type IdentityCorrectionExpected, type IdentityCorrectionRequest } from '@atlas/service-bridge/identity-correction';
import { canonical, digest, keyBytes, requireBridge, SHA } from '@atlas/service-bridge/protocol';
import { previewAtlasReport } from '@atlas/grading-core/report';
import { canonicalizeSpeedsterSessionIdentity } from '../ai-grader-v2/identity';
import { validateSpeedsterPinnedMapFilterInput } from '../ai-grader-v2/map-filter';
import { atlasGradingPolicyHash, atlasSpeedsterSourceEvidence, assertAtlasSpeedsterSourceAdmission } from './atlasGradingBridge';
import { atlasTrustedLearningSourceProjection } from './atlasTrustedLearning';
import { atlasIntakeSourceTitle } from './atlasIntake';
import { classifyAtlasIdentityCorrection, type AtlasIdentityCorrectionPorts } from './atlasIdentityCorrection';
import { resolvePersistedSpeedsterPreparationCapture, speedsterPreparationSideAuthority } from './speedsterPreparationCaptureEvidence';
import { currentSpeedsterPreparationRelease } from './speedsterPreparationRelease';
import { loadEffectiveActiveSpeedsterMapRevision, loadLockedEffectiveSpeedsterMapRevision, assertSpeedsterMapRevisionAppliesToIdentity,
    parseSpeedsterMapSourceSession, parseSpeedsterMapRegistration, speedsterPhysicalQuadHash, hashSpeedsterMapStorageEvidence,
    type SpeedsterAppliedMapRevision } from './speedsterCardTypeMaps';
import { verifySpeedsterRegistrationLessonCaptureAuthority, verifySpeedsterRegistrationLessonReferenceAuthority,
    type RegistrationLessonRow } from './speedsterMapRegistrationLessons';
import type { SpeedsterReviewActionSession } from './aiGraderV2ReviewAction';

export type AtlasIdentityCorrectionSettings = IdentityCorrectionConfig & Readonly<{allowedPhoneHashes:readonly string[]}>;
const otherKeys=['ATLAS_GRADING_BRIDGE_KEY','ATLAS_INTAKE_KEY','ATLAS_TRUSTED_LEARNING_KEY','ATLAS_OPERATOR_EVIDENCE_KEY',
    'ATLAS_PUBLIC_MEDIA_KEY','ATLAS_MACHINE_ADMISSION_KEY','ATLAS_MACHINE_EXECUTION_KEY'] as const;
export function atlasIdentityCorrectionConfig(env:NodeJS.ProcessEnv=process.env):AtlasIdentityCorrectionSettings{
    requireBridge(env.NODE_ENV==='production'&&env.VERCEL_ENV==='production'&&env.ATLAS_IDENTITY_CORRECTION_ENABLED==='true'
        &&!Object.keys(env).some(name=>name.startsWith('ATLAS_LOCAL_'))&&/^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL??'')
        &&/^[A-Za-z0-9_-]{1,120}$/.test(env.VERCEL_DEPLOYMENT_ID??'')&&/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA??'')
        &&env.VERCEL_GIT_COMMIT_SHA!=='0'.repeat(40),'IDENTITY_NOT_ENABLED');
    const encoded=env.ATLAS_IDENTITY_CORRECTION_ALLOWED_PHONE_HASHES_JSON;
    requireBridge(typeof encoded==='string'&&Buffer.byteLength(encoded)<=8192,'IDENTITY_ROSTER_INVALID');
    let parsed:unknown;try{parsed=JSON.parse(encoded!);}catch{requireBridge(false,'IDENTITY_ROSTER_INVALID');}
    requireBridge(Array.isArray(parsed)&&parsed.length>0&&parsed.length<=100&&parsed.every(v=>typeof v==='string'&&SHA.test(v))
        &&new Set(parsed).size===parsed.length,'IDENTITY_ROSTER_INVALID');
    const allowedPhoneHashes=Object.freeze([...(parsed as string[])].sort()),key=keyBytes(env.ATLAS_IDENTITY_CORRECTION_KEY),
        otherKeyHashes=otherKeys.filter(name=>env[name]!==undefined).map(name=>digest(keyBytes(env[name])));
    requireBridge(!otherKeyHashes.includes(digest(key)),'IDENTITY_CONFIGURATION_INVALID');
    return Object.freeze({...makeIdentityCorrectionConfig({mode:'PRODUCTION',origin:env.ATLAS_IDENTITY_CORRECTION_ORIGIN!,
        deploymentId:env.VERCEL_DEPLOYMENT_ID!,releaseSha:env.VERCEL_GIT_COMMIT_SHA!,key,gradingPolicyHash:atlasGradingPolicyHash(),
        phoneAllowlistHash:digest(canonical(allowedPhoneHashes)),otherKeyHashes}),allowedPhoneHashes});
}
export function atlasIdentityCorrectionBinding(settings:AtlasIdentityCorrectionSettings){
    const verified=makeIdentityCorrectionConfig({...settings,otherKeyHashes:[]});
    requireBridge(verified.configHash===settings.configHash,'IDENTITY_CONFIGURATION_INVALID');const{key:_key,...binding}=verified;return Object.freeze(binding);
}
export function atlasIdentityCorrectionSourceProjection(raw:SpeedsterReviewActionSession):ReturnType<AtlasIdentityCorrectionPorts['reportSource']>{
    const result=atlasTrustedLearningSourceProjection(resolvePersistedSpeedsterPreparationCapture(raw));
    const capture=result.capture as Record<string,unknown>|null;
    requireBridge(capture&&typeof capture==='object'&&!Array.isArray(capture)&&['front','back'].every(side=>{
        const value=capture[side];return value&&typeof value==='object'&&!Array.isArray(value)&&Object.hasOwn(value,'centeringQuad');
    }),'IDENTITY_CAPTURE_INVALID');
    return result as ReturnType<AtlasIdentityCorrectionPorts['reportSource']>;
}
function admitted(raw:SpeedsterReviewActionSession){
    const source=resolvePersistedSpeedsterPreparationCapture(raw);assertAtlasSpeedsterSourceAdmission(source);return source;
}
function admissionMetadata(raw:SpeedsterReviewActionSession,gradingPolicyHash:string){
    const source=admitted(raw),capture=source.capture as Record<string,unknown>,preparationRelease=currentSpeedsterPreparationRelease(),
        front=speedsterPreparationSideAuthority(capture.front),back=speedsterPreparationSideAuthority(capture.back);
    requireBridge(front&&back&&preparationRelease,'IDENTITY_PREPARATION_REQUIRED');
    return{gradingPolicyHash,preparationRelease:{...preparationRelease},frontAuthorityHash:digest(canonical(front)),backAuthorityHash:digest(canonical(back))};
}
function sourceIdentity(raw:SpeedsterReviewActionSession){
    requireBridge(raw.cardProfile==='SPORTS'||raw.cardProfile==='POKEMON','IDENTITY_SOURCE_CHANGED');
    const cardProfile=raw.cardProfile as 'SPORTS'|'POKEMON';return{cardProfile,identity:canonicalizeSpeedsterSessionIdentity(cardProfile,raw.identity)};
}
type HashEvidence=(key:string)=>Promise<string>;
type FindLesson=(id:string)=>Promise<RegistrationLessonRow|null>;

/** Reuses persisted-map geometry/registration validators. Submission receipts
 * are deliberately absent from the original persisted registration format. */
export async function assertAtlasIdentityCorrectionMap(source:SpeedsterReviewActionSession,applied:SpeedsterAppliedMapRevision|null,
    hashEvidence:HashEvidence,findLesson:FindLesson){
    const identity=sourceIdentity(source),mapSource=parseSpeedsterMapSourceSession({...source,...identity});
    if(!source.mapRevisionId){
        requireBridge(!applied&&!source.mapFilterPolicyVersion&&source.mapRegistration==null,'IDENTITY_MAP_REPROCESS_REQUIRED');return;
    }
    requireBridge(applied&&applied.revision.revisionId===source.mapRevisionId
        &&applied.revision.filterPolicyVersion===source.mapFilterPolicyVersion,'IDENTITY_MAP_REPROCESS_REQUIRED');
    const revision=applied!.revision;assertSpeedsterMapRevisionAppliesToIdentity(revision,identity);
    validateSpeedsterPinnedMapFilterInput({revision,registration:source.mapRegistration});
    for(const side of ['FRONT','BACK'] as const){
        const name=side==='FRONT'?'front':'back',map=side==='FRONT'?revision.frontMap:revision.backMap;
        const registration=parseSpeedsterMapRegistration((source.mapRegistration as Record<string,unknown>)[name],
            {side,mapRevisionId:revision.revisionId,zones:map.zones,anchors:map.anchors,designBoundary:map.designBoundary});
        requireBridge(registration.currentPhysicalQuadSha256===speedsterPhysicalQuadHash(mapSource[name].sourceCorners)
            &&registration.currentInspectionSha256===await hashEvidence(mapSource[name].inspectionStorageKey),'IDENTITY_MAP_REPROCESS_REQUIRED');
        for(const reference of [map.referenceInspection,...map.anchors.map(anchor=>anchor.referencePatch)])
            requireBridge(await hashEvidence(reference.storageKey)===reference.sha256,'IDENTITY_MAP_EVIDENCE_CHANGED');
        const provenance=registration.candidateProvenance;
        if(provenance?.source==='HUMAN_CORRECTION'||provenance?.source==='REGISTRATION_LESSON'){
            requireBridge(provenance.lessonId&&provenance.lessonId===provenance.candidateId,'IDENTITY_MAP_LESSON_REQUIRED');
            const row=await findLesson(provenance!.lessonId!);
            if(provenance.source==='HUMAN_CORRECTION')await verifySpeedsterRegistrationLessonCaptureAuthority({lessonId:provenance.lessonId!,
                mapRevisionId:revision.revisionId,side,currentInspectionSha256:registration.currentInspectionSha256,
                currentPhysicalQuadSha256:registration.currentPhysicalQuadSha256,registration,hashEvidence,findLesson:async()=>row});
            else await verifySpeedsterRegistrationLessonReferenceAuthority({lessonId:provenance.lessonId!,mapRevisionId:revision.revisionId,
                side,expectedAnchors:map.anchors.map(({id,point})=>({id,point})),hashEvidence,findLesson:async()=>row});
        }
    }
}
async function verifyPreparationBytes(source:SpeedsterReviewActionSession,hashEvidence:HashEvidence){
    for(const side of ['front','back']){
        const body=speedsterPreparationSideAuthority((source.capture as Record<string,unknown>)[side]);requireBridge(body,'IDENTITY_PREPARATION_REQUIRED');
        requireBridge(await hashEvidence(body!.input.source.storageKey)===body!.input.source.sha256,'IDENTITY_PREPARATION_BYTES_CHANGED');
        for(const artifact of Object.values(body!.artifacts))
            requireBridge(await hashEvidence(artifact.storageKey)===artifact.sha256,'IDENTITY_PREPARATION_BYTES_CHANGED');
    }
}
async function loadLesson(tx:Pick<Prisma.TransactionClient,'$queryRaw'>,id:string):Promise<RegistrationLessonRow|null>{
    const rows=await tx.$queryRaw<RegistrationLessonRow[]>`SELECT id,"tenantId","operatorAdminId","mapRevisionId",side,"evidenceSessionId","currentInspectionKey",
        "currentInspectionSha256","currentPhysicalQuadSha256","originalExpectedAnchors","automaticDiagnostics","humanCorrectedAnchors","validatedRegistration",
        "algorithmVersion","policyVersion","rescueAttemptId","lessonHash","createdAt" FROM public."AiGraderV2MapRegistrationLesson" WHERE id=${id} FOR SHARE`;
    return rows.length===1?rows[0]:null;
}

export function createAtlasIdentityCorrectionPorts(client:PrismaClient,settings:AtlasIdentityCorrectionSettings){
    atlasIdentityCorrectionBinding(settings);const hashes=[...settings.allowedPhoneHashes].sort();
    requireBridge(settings.mode==='PRODUCTION'&&hashes.length>0&&hashes.length<=100&&hashes.every(v=>SHA.test(v))&&new Set(hashes).size===hashes.length
        &&digest(canonical(hashes))===settings.phoneAllowlistHash,'IDENTITY_ROSTER_INVALID');
    const allowed=new Set(hashes),preflights=new WeakMap<object,{rawHash:string;mapCanonical:string;hashes:Map<string,string>}>();
    return{
        async loadRawSource(tx:Prisma.TransactionClient,exact:IdentityCorrectionLocator):Promise<SpeedsterReviewActionSession>{
            requireBridge(exact.sourceType==='SPEEDSTER','IDENTITY_SOURCE_CHANGED');
            const rows=await tx.$queryRaw<SpeedsterReviewActionSession[]>`SELECT id,"createdByUserId","cardProfile","workflowState",identity,capture,
                "reviewedDefects","gradeReport","mapRevisionId","mapFilterPolicyVersion","mapRegistration","updatedAt"
                FROM public."AiGraderV2Session" WHERE id=${exact.sourceId} AND "createdByUserId"=${exact.sourceOwnerId} FOR UPDATE`;
            requireBridge(rows.length===1&&rows[0].id===exact.sourceId&&rows[0].createdByUserId===exact.sourceOwnerId&&rows[0].workflowState==='CAPTURED','IDENTITY_SOURCE_CHANGED');return rows[0];
        },
        classify(raw:SpeedsterReviewActionSession,expected:IdentityCorrectionExpected,next:IdentityCorrectionRequest['next']){
            const source=admitted(raw);return classifyAtlasIdentityCorrection({source,expected,next},{reportSource:atlasIdentityCorrectionSourceProjection,
                sourceEvidence:atlasSpeedsterSourceEvidence,previewReport:previewAtlasReport,
                sourceAdmission:value=>admissionMetadata(value,settings.gradingPolicyHash)});
        },
        async preflight(raw:SpeedsterReviewActionSession){
            const source=admitted(raw),hashes=new Map<string,string>();
            const hashEvidence:HashEvidence=async key=>{if(hashes.has(key))return hashes.get(key)!;
                requireBridge(hashes.size<40,'IDENTITY_PREFLIGHT_TOO_LARGE');const hash=await hashSpeedsterMapStorageEvidence(key);hashes.set(key,hash);return hash;};
            let timer:ReturnType<typeof setTimeout>|undefined;
            try{return await Promise.race([(async()=>{
                const applied=await loadEffectiveActiveSpeedsterMapRevision(sourceIdentity(source));
                await verifyPreparationBytes(source,hashEvidence);
                await assertAtlasIdentityCorrectionMap(source,applied,hashEvidence,id=>loadLesson(client,id));
                const handle=Object.freeze({});preflights.set(handle,{rawHash:digest(canonical(identityCorrectionRawSource(raw))),mapCanonical:canonical(applied),hashes});return handle;
            })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('IDENTITY_PREFLIGHT_EXPIRED')),10_000);})]);}
            finally{clearTimeout(timer);}
        },
        async assertCurrentAuthority(tx:Prisma.TransactionClient,raw:SpeedsterReviewActionSession,handle:object){
            const preflight=preflights.get(handle);requireBridge(preflight&&preflight.rawHash===digest(canonical(identityCorrectionRawSource(raw))),'IDENTITY_PREFLIGHT_CHANGED');
            const source=admitted(raw),applied=await loadLockedEffectiveSpeedsterMapRevision(tx,sourceIdentity(source));
            requireBridge(canonical(applied)===preflight!.mapCanonical,'IDENTITY_MAP_REPROCESS_REQUIRED');
            const hashEvidence:HashEvidence=async key=>{const hash=preflight!.hashes.get(key);requireBridge(hash,'IDENTITY_PREFLIGHT_CHANGED');return hash!;};
            await verifyPreparationBytes(source,hashEvidence);
            await assertAtlasIdentityCorrectionMap(source,applied,hashEvidence,id=>loadLesson(tx,id));
        },
        projectNext:(raw:SpeedsterReviewActionSession,identity:unknown,updatedAt:Date)=>({...structuredClone(raw),identity:structuredClone(identity),updatedAt:new Date(updatedAt)}),
        reportSource:atlasIdentityCorrectionSourceProjection,sourceEvidence:atlasSpeedsterSourceEvidence,previewReport:previewAtlasReport,safeTitle:atlasIntakeSourceTitle,
        async compareAndSwap(tx:Prisma.TransactionClient,previous:SpeedsterReviewActionSession,next:SpeedsterReviewActionSession){
            const rows=await tx.$queryRaw<SpeedsterReviewActionSession[]>`UPDATE public."AiGraderV2Session" SET identity=${canonical(next.identity)}::jsonb,
                "updatedAt"=(${next.updatedAt}::timestamptz AT TIME ZONE 'UTC') WHERE id=${previous.id} AND "createdByUserId"=${previous.createdByUserId}
                AND "workflowState"='CAPTURED' AND "updatedAt"=(${previous.updatedAt}::timestamptz AT TIME ZONE 'UTC')
                RETURNING id,"createdByUserId","cardProfile","workflowState",identity,capture,"reviewedDefects","gradeReport","mapRevisionId","mapFilterPolicyVersion","mapRegistration","updatedAt"`;
            requireBridge(rows.length===1,'IDENTITY_SOURCE_CAS_FAILED');return rows[0];
        },
        isStaffPhoneAllowed:(hash:string)=>allowed.has(hash),
    };
}
export function createAtlasIdentityCorrection(client:PrismaClient,settings:AtlasIdentityCorrectionSettings){
    return new ScopedIdentityCorrection<Prisma.TransactionClient,SpeedsterReviewActionSession,object>({client,config:settings,ports:createAtlasIdentityCorrectionPorts(client,settings)});
}
