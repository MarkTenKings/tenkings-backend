export type WorkspaceDatabaseKind = 'SOURCE' | 'COORDINATOR';
export type WorkspaceTableRights = Readonly<Partial<Record<'SELECT' | 'INSERT' | 'UPDATE', readonly string[]>>>;
export const WORKSPACE_GRANTS: Readonly<Record<WorkspaceDatabaseKind, Readonly<Record<string, Readonly<Record<string, WorkspaceTableRights>>>>>>;
export const WORKSPACE_FUNCTIONS: Readonly<Record<WorkspaceDatabaseKind, readonly string[]>>;
export function workspaceGrantSQL(role: string, kind?: WorkspaceDatabaseKind): string;
export function assertWorkspacePrivileges(tx: { $queryRaw: Function }, kind?: WorkspaceDatabaseKind): Promise<void>;
