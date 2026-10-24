import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createProofAuthorityPostgres} from '../src/proof-authority-postgres.mjs';
import {engineDataOptions} from '../src/proof-decoder-engine-json.mjs';

/** Explicit operator composition only: caller supplies three already-configured
 * pools for an isolated schema and independently reviewed function-definition
 * pins. No URL, environment/credential discovery, DDL, seed, reset or activation.
 * This harness establishes real-role REFUSAL/ABSENCE ONLY, never authority. */
export async function qualifyProofAuthorityPostgres(options){
  const o=engineDataOptions(options,['requestPool','settlerPool','revokerPool','expectedDatabase','expectedFunctionOwner','functionHashes']);
  const hashes=engineDataOptions(o.functionHashes,['REQUEST','SETTLER','REVOKER']);
  const adapters=[],results=[],id='00000000-0000-4000-8000-000000000001',h='0'.repeat(64);
  try{
    for(const [kind,pool,role] of [['REQUEST',o.requestPool,'atlas_proof_request'],['SETTLER',o.settlerPool,'atlas_proof_settler'],['REVOKER',o.revokerPool,'atlas_proof_revoker']]){
      const a=createProofAuthorityPostgres({enabled:true,pool,roleKind:kind,expectedRole:role,expectedDatabase:o.expectedDatabase,expectedFunctionOwner:o.expectedFunctionOwner,functionHashes:hashes[kind]});adapters.push(a);
      const result=kind==='REVOKER'?await a.readDrain({mutationId:id}):await a.lookupClaim({stageId:id,claimHash:h});
      assert.equal(result.status,'ABSENT_HOLD');assert.equal(result.authority,false);results.push({case:`${kind}_EXACT_GRANTS_AND_ABSENT_HOLD`,status:'PASS'});
      if(kind==='SETTLER'){
        const v=await a.settleStage({schema:'atlas-proof-stage-settle-v1',installationId:id,stageId:id,operationHash:h,settlementId:id,disposition:'COMPLETE',outcomeHash:h,publisherBarrierId:null,publisherBarrierRevision:null});
        assert.equal(v.status,'ABSENT_HOLD');assert.equal(v.authority,false);results.push({case:'SYNTHETIC_COMPLETE_JSON_NEVER_SETTLES',status:'PASS'});
      }
      if(kind==='REVOKER'){
        const v=await a.applyMutation({mutationId:id,mutationHash:h});assert.equal(v.status,'ABSENT_HOLD');assert.equal(v.authority,false);results.push({case:'NO_APPLY_WITHOUT_ORIGINAL_MUTATION',status:'PASS'});
      }
    }
    return Object.freeze({schema:'atlas-proof-authority-postgres-refusal-evidence-v1',classification:'UNQUALIFIED',authority:false,
      scope:'ACTUAL_POSTGRES_ROLE_AND_REFUSAL_ONLY',results,
      notRun:['actual canonical request/roster/policy admission','stage creation or DB-derived C1 identity','drain/settlement/revocation races','all legacy writer hooks','lost real COMMIT response','publisher/decoder/customer activation']});
  }finally{for(const a of adapters)a.close();} // caller owns supplied pools
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)throw new Error('OPERATOR_COMPOSITION_REQUIRED_NO_CREDENTIAL_DISCOVERY');
