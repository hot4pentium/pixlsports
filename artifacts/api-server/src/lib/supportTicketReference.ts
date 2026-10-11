import { randomBytes } from "node:crypto";

const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const REFERENCE_BYTES = 5;
const REFERENCE_LENGTH = 8;
export const MAX_SUPPORT_TICKET_REFERENCE_ATTEMPTS = 5;

export function generateSupportTicketReference(
  getRandomBytes: (size: number) => Buffer = randomBytes,
): string {
  const bytes = getRandomBytes(REFERENCE_BYTES);
  if (bytes.length !== REFERENCE_BYTES) {
    throw new Error(`Support ticket references require exactly ${REFERENCE_BYTES} random bytes.`);
  }

  let value = BigInt(`0x${bytes.toString("hex")}`);
  let suffix = "";
  for (let index = 0; index < REFERENCE_LENGTH; index += 1) {
    suffix = REFERENCE_ALPHABET[Number(value & 31n)] + suffix;
    value >>= 5n;
  }

  return `PS-${suffix}`;
}

export class SupportTicketReferenceUnavailableError extends Error {
  constructor(readonly attempts: number) {
    super(`Could not generate a unique support ticket reference after ${attempts} attempts.`);
    this.name = "SupportTicketReferenceUnavailableError";
  }
}

export async function insertSupportTicketWithUniqueReference<T>(
  insert: (reference: string) => Promise<T | null>,
  createReference: () => string = generateSupportTicketReference,
  maxAttempts = MAX_SUPPORT_TICKET_REFERENCE_ATTEMPTS,
): Promise<T> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("Support ticket reference attempts must be a positive integer.");
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const created = await insert(createReference());
    if (created !== null) return created;
  }

  throw new SupportTicketReferenceUnavailableError(maxAttempts);
}
