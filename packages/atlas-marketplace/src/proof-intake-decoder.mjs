// Structural projection only. The owned adapter checks concrete private origin
// and its original BOOTTIME deadline before and after the actual database read.
import {canonicalJSON,requireValue} from './contract.mjs';
import {decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {publicationDecoderOutcome} from './proof-publication-lifecycle.mjs';
import {intakeProtectedInstallation,intakeProtectedRecord} from './proof-intake-protected-protocol.mjs';
const check=(v,c='INTAKE_DECODER_BINDING')=>requireValue(v,c);
export function intakeDecodedValidationFields(input,installation){
 const value=decoderContractData(input);decoderExact(value,['created','observation','atMs']);
 const c=intakeProtectedInstallation(installation),created=intakeProtectedRecord(value.created,c),observed=publicationDecoderOutcome(value.observation),at=value.atMs;
 check(created.operation.kind==='CREATE'&&created.upload.status==='PREPARED');
 check(Number.isSafeInteger(at)&&at>=created.upload.createdAt&&at<created.upload.expiresAt&&at>=c.policy.effectiveAt&&at<c.policy.expiresAt,'INTAKE_DECODER_WINDOW');
 check(observed.disposition==='COMPLETE_CLEAN'&&observed.completion?.outcome==='SUCCESS','INTAKE_DECODER_NO_CLEAN_SUCCESS');
 check(canonicalJSON(observed.request.plan)===canonicalJSON(created.upload.plan));
 // Decoder ID and DTO are derived together from one concrete-produced result.
 // All source/epoch/profile/deadline fields remain bound by the closed outcome
 // and the private client checks. Nothing here claims qualified admission.
 return decoderFreeze({createOperationId:created.operation.operationId,createOperationHash:created.operationHash,expectedUploadHash:created.uploadHash,decoderRequestId:observed.request.requestId,validation:observed.completion.validation});
}
