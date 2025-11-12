declare module "iohook" {
  interface KeyEvent {
    rawcode: number;
    keycode: number;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
  }

  type KeyHandler = (event: KeyEvent) => void;

  interface IoHookInstance {
    on(event: "keydown" | "keyup", handler: KeyHandler): void;
    start(): void;
    stop(): void;
  }

  const iohook: IoHookInstance;
  export default iohook;
}
