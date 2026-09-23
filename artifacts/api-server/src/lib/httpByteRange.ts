export function parseHttpByteRange(
  header: string,
  size: number,
  maxResponseBytes = size,
): { start: number; end: number } | null {
  if (!Number.isSafeInteger(size) || size <= 0 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  const requestedStart = match[1] ? Number(match[1]) : null;
  const requestedEnd = match[2] ? Number(match[2]) : null;
  const start = requestedStart ?? Math.max(0, size - (requestedEnd ?? 0));
  const end = requestedStart === null ? size - 1 : Math.min(requestedEnd ?? size - 1, size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, start + maxResponseBytes - 1) };
}