import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

export function renderReact(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return {
    container,
    rerender(next: ReactNode) {
      act(() => root.render(next));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error("Expected a clickable element");
  await act(async () => element.click());
}
