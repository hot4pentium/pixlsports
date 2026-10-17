import { createClerkClient } from "@clerk/express";
import { desc, eq } from "drizzle-orm";
import {
  athleteEditorAccessTable,
  db,
  type AthleteEditorAccess,
} from "@workspace/db";

export const ATHLETE_EDITOR_METADATA_KEY = "pixlSportsAthleteEditorAccessId";

export function createAthleteEditorClerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is required for athlete editor access");
  return createClerkClient({ secretKey });
}

export async function getAthleteEditorAccessForUser(userId: string): Promise<AthleteEditorAccess | null> {
  const [access] = await db.select()
    .from(athleteEditorAccessTable)
    .where(eq(athleteEditorAccessTable.athleteClerkUserId, userId))
    .limit(1);
  return access ?? null;
}

export async function getLatestAthleteEditorAccessForInvite(inviteId: string): Promise<AthleteEditorAccess | null> {
  const [access] = await db.select()
    .from(athleteEditorAccessTable)
    .where(eq(athleteEditorAccessTable.athleteInviteId, inviteId))
    .orderBy(desc(athleteEditorAccessTable.createdAt))
    .limit(1);
  return access ?? null;
}

export async function isAthleteEditorInvitationIdentity(userId: string): Promise<boolean> {
  if (await getAthleteEditorAccessForUser(userId)) return true;
  const user = await createAthleteEditorClerkClient().users.getUser(userId);
  const metadata = user.publicMetadata as Record<string, unknown> | null;
  const accessId = metadata?.[ATHLETE_EDITOR_METADATA_KEY];
  return typeof accessId === "string";
}
