export function normalizeQrInput(raw: string | null | undefined) {
  if (!raw) {
    return "";
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const codeMatch = trimmed.match(/(tk[a-z]+_[0-9a-z]+)/i);
  if (codeMatch) {
    return codeMatch[1].toLowerCase();
  }

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment) {
      return lastSegment;
    }
  } catch (error) {
    // not a URL, ignore
  }

  return trimmed;
}
