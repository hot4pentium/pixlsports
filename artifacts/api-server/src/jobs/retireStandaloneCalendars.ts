import { and, count, eq, isNotNull, ne, not, or, sql } from "drizzle-orm";
import {
  athleteInvitesTable,
  cloudProjectsTable,
  db,
  scheduleSharesTable,
} from "@workspace/db";
import { GAME_ON_CARD_MARKER } from "../routes/scheduleShares";

export type StandaloneCalendarCleanupCounts = {
  standaloneScheduleProjectsDeleted: number;
  standaloneScheduleSharesDeleted: number;
  athleteInvitesDetached: number;
  ambiguousLegacyCardSharesRetained: number;
};

/**
 * One-time, idempotent cleanup for standalone Calendar data.
 * Game On Card rows are retained by the exact marker. Unmarked single-game/practice
 * rows are ambiguous legacy card links and are retained conservatively as well.
 * All non-schedule projects and athlete/tracker/checklist data are outside deletes.
 */
export async function retireStandaloneCalendars(): Promise<StandaloneCalendarCleanupCounts> {
  return db.transaction(async (tx) => {
    const legacyCardCandidate = sql`CASE
      WHEN jsonb_typeof(${scheduleSharesTable.events}) = 'array' THEN CASE
        WHEN jsonb_array_length(${scheduleSharesTable.events}) = 1 THEN COALESCE(
          ${scheduleSharesTable.events}->0->>'type' IN ('game', 'practice'),
          false
        )
        ELSE false
      END
      ELSE false
    END`;
    const deletedShares = await tx
      .delete(scheduleSharesTable)
      .where(and(
        ne(scheduleSharesTable.teamSeason, GAME_ON_CARD_MARKER),
        not(legacyCardCandidate),
      ))
      .returning({ id: scheduleSharesTable.id });

    const deletedProjects = await tx
      .delete(cloudProjectsTable)
      .where(sql`${cloudProjectsTable.project}->>'tool' = 'schedule'`)
      .returning({ id: cloudProjectsTable.id });
    // A historical invite can still expose the Schedule toggle even without
    // a project ID. Retire that setting for every invite, not just linked ones.
    const detachedInvites = await tx
      .update(athleteInvitesTable)
      .set({
        scheduleProjectId: null,
        showSchedule: false,
        updatedAt: new Date(),
      })
      .where(or(
        isNotNull(athleteInvitesTable.scheduleProjectId),
        eq(athleteInvitesTable.showSchedule, true),
      ))
      .returning({ id: athleteInvitesTable.id });
    const [ambiguousShares] = await tx
      .select({ value: count() })
      .from(scheduleSharesTable)
      .where(and(
        ne(scheduleSharesTable.teamSeason, GAME_ON_CARD_MARKER),
        legacyCardCandidate,
      ));

    return {
      standaloneScheduleProjectsDeleted: deletedProjects.length,
      standaloneScheduleSharesDeleted: deletedShares.length,
      athleteInvitesDetached: detachedInvites.length,
      ambiguousLegacyCardSharesRetained: Number(ambiguousShares?.value ?? 0),
    };
  });
}