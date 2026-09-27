export function nonnegativeInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function validateStatCounts(label: string, totalText: string, athleteText: string):
  | { valid: true; total: number; athlete: number }
  | { valid: false; field: 'total' | 'athlete'; message: string } {
  const total = nonnegativeInteger(totalText);
  if (total === null) {
    return { valid: false, field: 'total', message: `${label}: total tracked must be a whole number (0 or greater).` };
  }
  const athlete = nonnegativeInteger(athleteText);
  if (athlete === null) {
    return { valid: false, field: 'athlete', message: `${label}: athlete credited must be a whole number (0 or greater).` };
  }
  if (athlete > total) {
    return {
      valid: false,
      field: 'total',
      message: `${label}: ${athlete} credited to the athlete exceeds ${total} tracked in total. Increase total tracked to at least ${athlete}, or lower athlete credited to ${total}.`,
    };
  }
  return { valid: true, total, athlete };
}