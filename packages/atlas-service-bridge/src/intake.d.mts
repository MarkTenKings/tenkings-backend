export type IntakeSource = { sourceType: 'SPEEDSTER' | 'LOCAL_FIXTURE'; sourceId: string; sourceOwnerId: string };
export type IntakeScope = { actorId: string; sessionHash: string; browserHash: string; accessVersion: number; controlRevision: number;
    staffOrigin: string; deploymentId: string; releaseSha: string; staffConfigHash: string; operationsGrantId: string };
export type IntakeConfig = Readonly<{ purpose: 'atlas-intake-v1'; mode: 'PRODUCTION' | 'LOCAL_FIXTURE'; origin: string;
    deploymentId: string; releaseSha: string; key: Buffer; clientKeyHash: string; configHash: string; gradingPolicyHash: string; phoneAllowlistHash?: string }>;
export type IntakeSummary = { receiptId: string; source: IntakeSource; title: string; subtitle: string; sourceRevision: string; expiresAt: string };
export type IntakePreparation = { preparationRelease: Record<string, unknown>; frontAuthorityHash: string; backAuthorityHash: string };
export type IntakeReceipt = IntakeSource & { id: string; actorId: string; sessionHash: string; operationsGrantId: string; controlRevision: number;
    sourceRevision: string; title: string; subtitle: string; evidenceCanonical: string; evidenceHash: string; admissionCanonical: string;
    admissionHash: string; gradingPolicyHash: string; bridgeConfigHash: string; createdAt: Date; expiresAt: Date };
export type IntakePacket = { purpose: 'atlas-intake-v1'; audience: string; bridgeConfigHash: string; scope: IntakeScope; source: IntakeSource;
    nonce: string; issuedAt: number; expiresAt: number };
export type IntakeHumanAuthority = {
    identity: { id: string; accessVersion: number; revokedAt: Date | null };
    control: { revision: number };
    session: { identityId: string; tokenHash: string; accessVersion: number; revokedAt: Date | null; controlRevision: number; createdAt: Date; expiresAt: Date };
    browser: { tokenHash: string; createdAt: Date; expiresAt: Date };
    grant: { id: string; expiresAt: Date };
};
export const INTAKE_PATH: '/api/internal/atlas/intake';
export const INTAKE_PURPOSE: 'atlas-intake-v1';
export function exactIntakeSource(source: unknown): IntakeSource;
export function makeIntakeConfig(input: { mode: 'PRODUCTION' | 'LOCAL_FIXTURE'; origin: string; deploymentId: string; releaseSha: string;
    key: Buffer | string; gradingPolicyHash: string; otherKeyHashes: string[]; phoneAllowlistHash?: string }): IntakeConfig;
export function signIntakeRequest(config: IntakeConfig, scope: IntakeScope, source: IntakeSource, now?: number, nonce?: string): { body: string; signature: string };
export function verifyIntakeRequest(config: IntakeConfig, body: string, signature: string, now?: number): IntakePacket;
export function validateIntakeReceipt(row: IntakeReceipt, scope: { source: IntakeSource; gradingPolicyHash: string; bridgeConfigHash: string }): IntakeReceipt;
export class ScopedSourceIntake<Tx, Source extends { id: string; createdByUserId: string; workflowState: string; updatedAt: Date }> {
    constructor(options: { client: { $transaction<T>(work: (tx: Tx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T> };
        config: IntakeConfig;
        ports: {
            /** MUST lock exact source row FOR SHARE; metadata only, no HTTP. */
            loadSource(tx: Tx, source: IntakeSource): Promise<Source>;
            sourceEvidence(source: Source, sourceRevision: string): unknown | Promise<unknown>;
            /** Throws if the original preparation release/authority is absent. */
            assertSourceAdmission(source: Source): void | Promise<void>;
            sourceAdmission(source: Source): IntakePreparation | Promise<IntakePreparation>;
            sourceTitle(source: Source): { title: string; subtitle: string } | Promise<{ title: string; subtitle: string }>;
            isStaffPhoneAllowed(phoneHash: string): boolean;
        } });
    /** Private composition only, after authenticating the purpose-scoped packet. */
    authorize(tx: Tx, packet: { scope: IntakeScope }, now: Date): Promise<IntakeHumanAuthority>;
    receive(body: string, signature: string): Promise<IntakeSummary>;
}
export function intakeClient(config: IntakeConfig, fetchImpl?: typeof fetch): Readonly<{
    binding: Readonly<{ bridgeConfigHash: string; gradingPolicyHash: string }>;
    call(scope: IntakeScope, source: IntakeSource): Promise<IntakeSummary>;
}>;
