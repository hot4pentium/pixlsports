import { createHash } from "node:crypto";

const REPLY_TOKEN_PATTERN = /^[a-f0-9]{56}$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function hashSupportTicketReplyToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeSupportReplyDomain(value: string | null | undefined): string | undefined {
  const domain = value?.trim().toLowerCase();
  if (!domain) return undefined;
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new Error("RESEND_INBOUND_DOMAIN must be a valid receiving domain.");
  }
  return domain;
}

export function buildSupportTicketReplyAddress(token: string, domain: string): string {
  if (!REPLY_TOKEN_PATTERN.test(token)) throw new Error("Support email reply token is invalid.");
  const normalizedDomain = normalizeSupportReplyDomain(domain);
  if (!normalizedDomain) throw new Error("A support email receiving domain is required.");
  return `ticket+${token}@${normalizedDomain}`;
}

function normalizeEmailAddress(address: string): string {
  const trimmed = address.trim();
  const bracketedAddress = trimmed.match(/<\s*([^<>]+)\s*>/);
  return (bracketedAddress?.[1] ?? trimmed).trim().toLowerCase();
}

export function getSupportTicketReplyToken(recipient: string, domain: string): string | undefined {
  const normalizedDomain = normalizeSupportReplyDomain(domain);
  if (!normalizedDomain) return undefined;

  const trimmed = recipient.trim();
  const bracketedAddress = trimmed.match(/<\s*([^<>]+)\s*>/);
  const address = (bracketedAddress?.[1] ?? trimmed).trim();
  const atIndex = address.lastIndexOf("@");
  if (atIndex < 0 || address.slice(atIndex + 1).toLowerCase() !== normalizedDomain) return undefined;

  const localPart = address.slice(0, atIndex);
  const match = localPart.match(/^ticket\+([a-f0-9]{56})$/i);
  return match?.[1];
}

export function normalizeSupportSender(address: string): string {
  return normalizeEmailAddress(address);
}
