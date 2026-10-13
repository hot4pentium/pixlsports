export function nonnegativeInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function otherStatCount(total: number, athlete: number): number {
  return Math.max(0, total - athlete);
}

export function validateCorrectedStatCounts(label: string, athleteText: string, otherText: string):
  | { valid: true; total: number; athlete: number }
  | { valid: false; field: 'other' | 'athlete'; message: string } {
  const athlete = nonnegativeInteger(athleteText);
  if (athlete === null) {
    return { valid: false, field: 'athlete', message: `${label}: athlete count must be a whole number (0 or greater).` };
  }
  const other = nonnegativeInteger(otherText);
  if (other === null) {
    return { valid: false, field: 'other', message: `${label}: team or unassigned count must be a whole number (0 or greater).` };
  }
  const total = athlete + other;
  if (!Number.isSafeInteger(total)) {
    return { valid: false, field: 'athlete', message: `${label}: combined count is too large. Lower one of the counts.` };
  }
  return { valid: true, total, athlete };
}