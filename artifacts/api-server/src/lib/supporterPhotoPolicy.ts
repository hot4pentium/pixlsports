export interface SupporterPhotoClaim {
  ownerClerkUserId: string;
  objectPath: string;
  expiresAt: Date;
}

export function isUsableSupporterPhotoClaim(
  claim: SupporterPhotoClaim | undefined,
  ownerClerkUserId: string,
  objectPath: string,
  now = new Date(),
) {
  return Boolean(
    claim
    && claim.ownerClerkUserId === ownerClerkUserId
    && claim.objectPath === objectPath
    && claim.expiresAt > now,
  );
}

export function replacedSupporterPhotoPath(
  previousObjectPath: string | undefined,
  nextObjectPath: string,
) {
  return previousObjectPath && previousObjectPath !== nextObjectPath
    ? previousObjectPath
    : undefined;
}