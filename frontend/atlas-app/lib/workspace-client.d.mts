export type PhotoSide = 'FRONT' | 'BACK';
export type PhotoInfo = { name: string; type: string; size: number };
export type ReadablePhoto = PhotoInfo & { arrayBuffer(): Promise<ArrayBuffer> };
export type PhotoDescription = { name: string; contentType: string; byteCount: number; sha256: string };
export type UploadGrant = { id: string; method: 'PUT'; url: string; expiresAt: string; headers?: Record<string, string> };
export type PhotoUploadTransport<T> = {
    status: number;
    withCredentials: boolean;
    timeout: number;
    upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void };
    onload?: () => void;
    onerror?: () => void;
    ontimeout?: () => void;
    onabort?: () => void;
    open(method: string, url: string): void;
    setRequestHeader(name: string, value: string): void;
    send(file: T): void;
};
export type IntakeEntry<T extends PhotoInfo = ReadablePhoto> = {
    title: string;
    identity: unknown;
    pairConfirmed: boolean;
    files?: Partial<Record<PhotoSide, T | null>>;
    uploads?: Partial<Record<PhotoSide, Record<string, unknown> | null>>;
    card?: Record<string, unknown> | null;
    pending?: Record<string, unknown> | null;
    sourceFiles?: Partial<Record<PhotoSide, PhotoInfo | null>>;
    photoImports?: Partial<Record<PhotoSide, unknown>>;
    [field: string]: unknown;
};
export function describePhoto(file: ReadablePhoto, cryptoImpl?: Pick<Crypto, 'subtle'>): Promise<PhotoDescription>;
export function replaceIntakePhoto<T extends PhotoInfo>(entry: IntakeEntry<T>, side: PhotoSide, file: T, options?: { original?: PhotoInfo | null; conversion?: unknown }): IntakeEntry<T>;
export function uploadPhoto(grant: UploadGrant, file: Blob, options?: { onProgress?: (percent: number) => void; now?: () => number }): Promise<void>;
export function uploadPhoto<T>(grant: UploadGrant, file: T, options: { xhrFactory: () => PhotoUploadTransport<T>; onProgress?: (percent: number) => void; now?: () => number }): Promise<void>;
export type IntakeUploadOptions<T extends PhotoInfo> = {
    request(path: string, options: { body: Record<string, unknown> }): Promise<Record<string, unknown>>;
    persist(entry: IntakeEntry<T>): void | Promise<void>;
    onProgress?: (side: PhotoSide, phase: string, percent: number) => void;
};
export function uploadIntakeEntry(initial: IntakeEntry<File>, options: IntakeUploadOptions<File> & {
    put?: (grant: UploadGrant, file: File, options: { onProgress: (percent: number) => void }) => Promise<void>;
    describe?: (file: File) => Promise<PhotoDescription>;
}): Promise<IntakeEntry<File>>;
/** Nonbrowser photo fixtures must supply their own byte description and transport. */
export function uploadIntakeEntry<T extends PhotoInfo>(initial: IntakeEntry<T>, options: IntakeUploadOptions<T> & {
    put: (grant: UploadGrant, file: T, options: { onProgress: (percent: number) => void }) => Promise<void>;
    describe: (file: T) => Promise<PhotoDescription>;
}): Promise<IntakeEntry<T>>;
