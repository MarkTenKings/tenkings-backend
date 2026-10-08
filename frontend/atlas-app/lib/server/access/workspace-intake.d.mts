/** The JavaScript boundary validates injected ports and untrusted staff/request
 * values at runtime. Callers must validate projected responses before use. */
export class StaffWorkspaceIntake {
    constructor(options: { store: object; source: object; storage?: object | null; readiness?: object | null });
    list(staff: unknown): Promise<unknown>;
    read(staff: unknown, id: unknown): Promise<unknown>;
    evidence(staff: unknown, id: unknown, side: unknown): Promise<unknown>;
    create(staff: unknown, value: unknown): Promise<unknown>;
    planUpload(staff: unknown, id: unknown, value: unknown): Promise<unknown>;
    completeUpload(staff: unknown, id: unknown, value: unknown): Promise<unknown>;
    queue(staff: unknown, id: unknown, value: unknown): Promise<unknown>;
    claim(staff: unknown, id: unknown, value: unknown): Promise<unknown>;
}
