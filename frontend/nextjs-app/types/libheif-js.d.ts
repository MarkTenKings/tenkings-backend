declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  type HeifImage = {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    display(pixels: ImageData, done: (result: ImageData | null) => void): void;
    free(): void;
  };
  export default function createLibheif(options: { print: () => void; printErr: () => void }): Promise<{
    HeifDecoder: new () => { decoder: number | null; decode(bytes: Uint8Array): HeifImage[] };
    heif_context_free(context: number): void;
  }>;
}
