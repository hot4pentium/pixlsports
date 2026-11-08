import { pool } from "@workspace/db";
import { GAME_ON_CARD_MARKER } from "./gameOnCard";
import { assertLinkableWebAccount } from "./nativeAccountLink";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";

type TransactionClient = NonNullable<Parameters<typeof assertLinkableWebAccount>[1]>;

export interface OwnedGameOnCardDeletionResult {
  calendarEventDeleted: boolean;
  calendarEventStatus: "deleted" | "not-linked" | "unverified" | "not-found" | "ambiguous";
}

export interface NativeOwnedGameOnCardDeletionResult extends OwnedGameOnCardDeletionResult {
  ownerClerkUserId: string;
}

function isSingleGameOrPractice(events: unknown): boolean {
  if (!Array.isArray(events) || events.length !== 1) return false;
  const event: unknown = events[0];
  return Boolean(event && typeof event === "object" && "type" in event
    && (event.type === "game" || event.type === "practice"));
}

async function deleteInTransaction(
  tx: TransactionClient,
  ownerClerkUserId: string,
  shareToken: string,
): Promise<OwnedGameOnCardDeletionResult | null> {
  const { rows: shares } = await tx.query<{
    id: string;
    team_season: string;
    events: unknown;
    calendar_project_id: string | null;
    calendar_event_id: string | null;
    calendar_owner_clerk_user_id: string | null;
  }>(`SELECT id::text AS id, team_season, events,
        calendar_project_id::text AS calendar_project_id,
        calendar_event_id, calendar_owner_clerk_user_id
      FROM schedule_shares
      WHERE id=$1 AND owner_clerk_user_id=$2
      FOR UPDATE`, [shareToken, ownerClerkUserId]);
  const share = shares[0];
  if (!share || (share.team_season !== GAME_ON_CARD_MARKER && !isSingleGameOrPractice(share.events))) {
    return null;
  }

  let calendarEventStatus: OwnedGameOnCardDeletionResult["calendarEventStatus"] = "not-linked";
  const hasAnyAssociation = Boolean(
    share.calendar_project_id || share.calendar_event_id || share.calendar_owner_clerk_user_id,
  );
  if (hasAnyAssociation) {
    calendarEventStatus = "unverified";
    const cardEvents = Array.isArray(share.events) ? share.events : [];
    const cardEvent = cardEvents[0] as { id?: unknown } | undefined;
    if (share.calendar_project_id && share.calendar_event_id
      && cardEvent?.id === share.calendar_event_id
      && share.calendar_owner_clerk_user_id === ownerClerkUserId) {
      const { rows: projects } = await tx.query<{
        id: string;
        owner_clerk_user_id: string;
        project: unknown;
      }>(`SELECT id::text AS id, owner_clerk_user_id, project
          FROM cloud_projects
          WHERE id=$1
          FOR UPDATE`, [share.calendar_project_id]);
      const calendarProject = projects[0];
      if (calendarProject?.owner_clerk_user_id === ownerClerkUserId) {
        const project = calendarProject.project as { tool?: unknown; events?: unknown } | null;
        if (project?.tool === "schedule" && Array.isArray(project.events)) {
          const eventMatches = project.events.filter((event) => (
            event && typeof event === "object" && "id" in event && event.id === share.calendar_event_id
          ));
          const { rows: linkedShares } = await tx.query<{ id: string }>(`SELECT id::text AS id
            FROM schedule_shares
            WHERE calendar_project_id=$1 AND calendar_event_id=$2`,
          [share.calendar_project_id, share.calendar_event_id]);
          if (eventMatches.length === 0) {
            calendarEventStatus = "not-found";
          } else if (eventMatches.length !== 1 || linkedShares.length !== 1) {
            calendarEventStatus = "ambiguous";
          } else {
            const events = project.events.filter((event) => !(
              event && typeof event === "object" && "id" in event && event.id === share.calendar_event_id
            ));
            const updated = await tx.query(`UPDATE cloud_projects
              SET project=$1::jsonb, revision=revision + 1, updated_at=NOW()
              WHERE id=$2 AND owner_clerk_user_id=$3`,
            [JSON.stringify({ ...project, events }), calendarProject.id, ownerClerkUserId]);
            calendarEventStatus = updated.rowCount === 1 ? "deleted" : "unverified";
          }
        }
      }
    }
  }

  const deleted = await tx.query(`DELETE FROM schedule_shares
    WHERE id=$1 AND owner_clerk_user_id=$2`, [share.id, ownerClerkUserId]);
  if (deleted.rowCount !== 1) return null;
  return {
    calendarEventStatus,
    calendarEventDeleted: calendarEventStatus === "deleted",
  };
}

export async function deleteOwnedGameOnCard(
  ownerClerkUserId: string,
  shareToken: string,
): Promise<OwnedGameOnCardDeletionResult | null> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`native-event:${ownerClerkUserId}`],
    );
    const result = await deleteInTransaction(tx, ownerClerkUserId, shareToken);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}

export async function deleteNativeSupporterEventCard(
  identity: NativeIdentity,
  shareToken: string,
): Promise<NativeOwnedGameOnCardDeletionResult | null> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const { rows: links } = await tx.query<{ owner_clerk_user_id: string }>(`SELECT owner_clerk_user_id
      FROM native_account_links
      WHERE native_issuer=$1 AND native_subject=$2
      FOR SHARE`, [identity.issuer, identity.subject]);
    const ownerClerkUserId = links[0]?.owner_clerk_user_id;
    if (!ownerClerkUserId) {
      throw new NativeLinkError(409, "Connect your PIXL account before deleting an Event Card.");
    }
    await assertLinkableWebAccount(
      ownerClerkUserId,
      tx,
      "This PIXL account can’t delete Event Cards right now. Check its account status on PIXL Sports.",
    );
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`native-event:${ownerClerkUserId}`],
    );
    const result = await deleteInTransaction(tx, ownerClerkUserId, shareToken);
    await tx.query("COMMIT");
    return result ? { ...result, ownerClerkUserId } : null;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
