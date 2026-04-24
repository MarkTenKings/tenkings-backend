declare module "canvas-confetti" {
  type Options = Record<string, unknown>;
  type Confetti = (options?: Options) => Promise<null> | null;
  const confetti: Confetti;
  export default confetti;
}
