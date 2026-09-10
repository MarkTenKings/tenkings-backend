import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { StaffOperationsAuthority,makeOperationsAuthorityConfig } from '../lib/server/access/operations-authority.mjs';
import { StaffOperations } from '../lib/server/access/operations.mjs';

const instruction=()=>({operationId:randomUUID(),reason:'Explicit owned synthetic operator instruction.',authorizationEvidenceHash:'a'.repeat(64)});
async function fixture(context,work) {
    const {admin,auth,config}=context, signed=await context.login();
    const control=await admin.staffControl.findUnique({where:{id:'active'}}),now=new Date();
    const grant=await admin.staffOperationsGrant.create({data:{id:randomUUID(),identityId:signed.staff.id,accessVersion:1,
        controlRevision:control.revision,mode:config.mode,origin:config.origin,deploymentId:config.deploymentId,
        releaseSha:config.releaseSha,configHash:config.configHash,authorizationEvidenceHash:'a'.repeat(64),
        createdAt:new Date(+now-1000),expiresAt:new Date(+now+3600_000)}});
    const client=new PrismaClient({datasources:{db:{url:context.db.operationsUrl}}});
    const authority=new StaffOperationsAuthority({client,auth,config:makeOperationsAuthorityConfig({databaseUrl:context.db.operationsUrl,staffConfig:config})});
    const operations=new StaffOperations({admin:authority});
    try{await work({...context,signed,grant,operations,authority,operationsClient:client});}finally{await client.$disconnect();}
}
export async function operationsScenarios(scenario) {
    await scenario('fresh separate operations grant controls roster access and cannot be inferred from a reviewer session',context=>fixture(context,async f=>{
        assert.equal((await f.operations.roster(f.signed.staff)).length,2);
        await assert.rejects(()=>f.operations.roster({...f.signed.staff}),/SIGN_IN_REQUIRED/);
        const other=await f.login(undefined,'+12025550142');
        await assert.rejects(()=>f.operations.roster(other.staff),/FRESH_HUMAN_OPERATIONS_REQUIRED/);
        await f.admin.staffOperationsGrant.update({where:{id:f.grant.id},data:{revokedAt:new Date()}});
        await assert.rejects(()=>f.operations.roster(f.signed.staff),/FRESH_HUMAN_OPERATIONS_REQUIRED/);
        await assert.rejects(()=>f.admin.staffOperationsGrant.update({where:{id:f.grant.id},data:{revokedAt:null}}));
    }));
    await scenario('operations training and assignments retain exact human capability audits and independent learning authority',context=>fixture(context,async f=>{
        const person=(await f.operations.roster(f.signed.staff)).find(row=>row.id!==f.signed.staff.id);
        const input={...instruction(),identityId:person.id,expectedAccessVersion:person.accessVersion,role:'REVIEWER',revoked:false,
            certificationUntil:new Date(Date.now()+3600_000).toISOString(),trustedLearningUntil:null};
        const first=await f.operations.updateRoster(f.signed.staff,input);
        assert.deepEqual(await f.operations.updateRoster(f.signed.staff,input),first);
        const row=await f.admin.staffIdentity.findUnique({where:{id:person.id}});assert.equal(row.trustedLearningUntil,null);assert(row.certificationUntil);
        const audit=await f.admin.staffAudit.findFirst({where:{event:'STAFF_ROSTER_UPDATED'}});assert.equal(JSON.parse(audit.details).operationsGrantId,f.grant.id);
        await assert.rejects(()=>f.operations.updateRoster(f.signed.staff,{...input,role:'OBSERVER'}),/OPERATIONS_REQUEST_CONFLICT/);
        const card=await f.admin.staffSpecimen.findFirst(),assignment=await f.admin.staffAssignment.findUnique({where:{specimenId_identityId:{specimenId:card.id,identityId:person.id}}});
        const assigned=await f.operations.assign(f.signed.staff,{...instruction(),specimenId:card.id,identityId:person.id,
            expectedFence:assignment?.fence??null,canReview:true,expiresAt:new Date(Date.now()+3600_000).toISOString(),revoked:false});
        assert.equal(assigned.fence,(assignment?.fence??0)+1);
        await assert.rejects(()=>f.operations.updateRoster(f.signed.staff,{...input,operationId:randomUUID(),identityId:f.signed.staff.id,expectedAccessVersion:1}),/current human capability|FRESH_HUMAN_OPERATIONS_REQUIRED/);
    }));
    await scenario('operations credentials cannot activate or bypass immutable human audit, cost and capability boundaries',context=>fixture(context,async f=>{
        const person=(await f.operations.roster(f.signed.staff)).find(row=>row.id!==f.signed.staff.id);
        await assert.rejects(()=>f.operationsClient.$transaction(async tx=>{
            await tx.staffIdentity.update({where:{id:person.id},data:{accessVersion:{increment:1},certificationUntil:new Date(Date.now()+1000)}});
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        }),/exact current human audit/);
        for(const query of ['SELECT * FROM public."User"','UPDATE atlas_staff."StaffControl" SET enabled=true',
            'INSERT INTO atlas_staff."StaffOperationsGrant" (id) VALUES (gen_random_uuid())',
            'UPDATE atlas_staff."StaffOperatorRun" SET state=\'FAILED\'',
            'INSERT INTO atlas_staff."StaffReportApproval" (id) VALUES (gen_random_uuid())',
            'UPDATE atlas_staff."StaffGradingExecution" SET state=\'COMMITTED\'']) await assert.rejects(()=>f.operationsClient.$executeRawUnsafe(query));
        await assert.rejects(()=>f.client.staffOperationsGrant.findMany());
        assert.equal((await f.admin.staffIdentity.findUnique({where:{id:person.id}})).certificationUntil,null);
    }));
}
