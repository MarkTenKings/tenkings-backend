export interface ApprovedReportBinding { specimenId: string; approvalId: string; approvalVersion: number; publicToken: string; publicHash: string }
export interface NfcSignedJob extends ApprovedReportBinding { schemaVersion: string; algorithm: string; signingKeyId: string; purpose: string; nonce: string; url: string; chipType: string; securityMode: string; programmingProfile: string; issuedAt: string; expiresAt: string; signature: string }
export interface NfcTerminalResult extends ApprovedReportBinding { schemaVersion: string; algorithm: string; workstationKeyId: string; jobEnvelopeSha256: string; nonce: string; url: string; chipType: string; securityMode: string; programmingProfile: string; readerModel: string; adapterIdentity: string; adapterVersion: string; readbackPayloadSha256: string; writeProtectionState: string; readerResultCode: string; helperCapability: string; observedAt: string; signature: string }
export interface NfcPublicKey { keyId: string; publicSpkiDerBase64: string }
export interface NfcTrust { schemaVersion: 'atlas-nfc-trust-v1'; serverKeys: NfcPublicKey[]; workstationKeys: (NfcPublicKey & { enrollmentPolicy: 'windows-current-user-nonexportable-p256-v1' })[] }
export interface NfcOperationResponse extends ApprovedReportBinding { helperProtocolVersion: string; helperVersion: string; helperCapability: string; jobEnvelopeSha256: string; url: string; phase: 'preparing' | 'awaiting_manual_start' | 'completed' | 'failed' | 'uncertain' | 'closing_success' | 'closing_discard_failed' | 'closing_discard_uncertain' | 'closing_discard_completed_unrecorded'; terminal: boolean; errorCode: string | null; discardAcknowledgementNonce: string | null; result: NfcTerminalResult | null }
export const ATLAS_NFC: Readonly<{ jobSchema: string; resultSchema: string; algorithm: string; purpose: string; origin: string; staffOrigin: string; chipType: string; securityMode: string; programmingProfile: string; readerModel: string; adapterIdentity: string; adapterVersion: string; writeProtectionState: string; readerResultCode: string; helperCapability: string; maximumJobLifetimeMs: number; workstationEnrollmentPolicy: string }>;
export const JOB_FIELDS: readonly string[];
export const RESULT_FIELDS: readonly string[];
export function atlasReportUrl(publicToken: string, approvalVersion: number): string;
export function validateApprovedReportBinding(value: unknown): Readonly<ApprovedReportBinding>;
export function validateNfcJob(value: unknown): Readonly<NfcSignedJob>;
export function validateNfcTrust(value: unknown): NfcTrust;
export function canonicalNfcJob(value: NfcSignedJob): string;
export function canonicalNfcResult(value: NfcTerminalResult): string;
export function nfcJobEnvelopeSha256(value: NfcSignedJob): string;
export function signNfcJob(args: { approvedReport: ApprovedReportBinding; privateKeyPem: string; now: Date; lifetimeMs?: number }): Readonly<NfcSignedJob>;
export function verifyNfcJob(args: { job: unknown; trust: NfcTrust; now: Date }): Readonly<NfcSignedJob>;
export function verifyNfcResult(args: { job: unknown; result: NfcTerminalResult; approvedReport: ApprovedReportBinding; trust: NfcTrust; now: Date }): Readonly<NfcTerminalResult>;
