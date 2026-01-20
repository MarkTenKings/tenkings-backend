export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toSafeKeyPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/g, "")}/${path.replace(/^\/+/g, "")}`;
}
