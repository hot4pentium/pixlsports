import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { assertLinkableWebAccount } from "./nativeAccountLink";
import { GAME_ON_CARD_MARKER } from "./gameOnCard";
import { NativeLinkError, type NativeIdentity } from "./nativeIdentity";
import {
  applyNativeTrackerCommand, nativeSportRules,
  type NativeGame, type NativeSport, type WorkspaceCommand,
} from "./nativeEventTracker";

type Item = { id: string; label: string; completed: boolean; section?: string | null };
type Receipt = { id: string; digest: string };
type Payload = { tool: string; version: number; games: NativeGame[]; nativeReceipts?: Receipt[] };
type Project = { id: string; revision: number; project: Payload };
type Prep = { id: string; revision: number; items: Item[]; notes: string; selected_game: Record<string, unknown> };

export function nativePrepTemplate(practice: boolean): Item[] {
  return [
    ["uniform", practice ? "Pack practice gear and shoes" : "Pack the uniform and game shoes"],
    ["equipment", "Pack equipment and team bag"],
    ["water", "Bring water and a quick snack"],
    ["arrival", "Confirm arrival time and location"],
    ["lineup", practice ? "Review the practice plan" : "Check the lineup and player availability"],
    ["schedule", "Review the schedule and field or court"],
  ].map(([id, label]) => ({ id: id!, label: label!, completed: false }));
}

/** Existing PIXL checklist + tracker stores, never a second native history. */
export async function nativeEventWorkspace(
  identity: NativeIdentity, shareToken: string, command?: WorkspaceCommand,
  notifyTrackerShare?: (shareToken: string) => Promise<void>,
) {
  const tx = await pool.connect();
  let changedShares: string[] = [];
  try {
    await tx.query("BEGIN");
    const link = (await tx.query<{ id: string; owner_clerk_user_id: string }>(
      `SELECT id,owner_clerk_user_id FROM native_account_links
       WHERE native_issuer=$1 AND native_subject=$2 FOR SHARE`,
      [identity.issuer, identity.subject],
    )).rows[0];
    if (!link) throw new NativeLinkError(409, "Connect your PIXL account first.");
    if (command && command.linkId !== link.id) throw new NativeLinkError(409, "Your PIXL connection changed. Reopen this Event Card.");
    const owner = link.owner_clerk_user_id;
    await assertLinkableWebAccount(owner, tx);
    // Serializes first saves from two devices without adding a new database table.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`native-event:${owner}`]);
    const share = (await tx.query<{ events: Array<Record<string, unknown>> }>(
      `SELECT events FROM schedule_shares WHERE id=$1 AND owner_clerk_user_id=$2
       AND team_season=$3 FOR UPDATE`, [shareToken, owner, GAME_ON_CARD_MARKER],
    )).rows[0];
    const event = share?.events?.length === 1 ? share.events[0] : null;
    if (!event || typeof event.id !== "string" || !["game", "practice"].includes(String(event.type))) {
      throw new NativeLinkError(404, "This Event Card is not available to your account.");
    }
    const athlete = (await tx.query<{ sport: string }>(
      "SELECT sport FROM athlete_invites WHERE owner_clerk_user_id=$1 LIMIT 1", [owner],
    )).rows[0];
    const projects = (await tx.query<Project>(
      `SELECT id,revision,project FROM cloud_projects
       WHERE owner_clerk_user_id=$1 AND project->>'tool'='stat-tracker'
       ORDER BY updated_at DESC FOR UPDATE`, [owner],
    )).rows;
    const sharedGame = (await tx.query<{ game: NativeGame }>(
      `SELECT game FROM stat_tracker_shares WHERE owner_clerk_user_id=$1
       AND (game_id=$2 OR game->>'sourceEventId'=$2) ORDER BY updated_at DESC LIMIT 1`, [owner, event.id],
    )).rows[0]?.game;
    const matches = (game: NativeGame) => game.sourceEventId === event.id || game.id === event.id || game.id === sharedGame?.id;
    let project = projects.find((p) => Array.isArray(p.project.games) && p.project.games.some(matches)) ?? projects[0];
    if (project && !Array.isArray(project.project.games)) {
      throw new NativeLinkError(409, "The saved tracker needs review before it can be changed.");
    }
    let game = project?.project.games.find(matches) ?? null;
    // Keep already shared legacy games intact even if no cloud project exists yet.
    if (!game) {
      game = sharedGame ? { ...sharedGame, sourceEventId: event.id } : null;
    }
    const sport = (game?.sport ?? athlete?.sport) as NativeSport;
    if (!Object.hasOwn(nativeSportRules, sport)) throw new NativeLinkError(409, "Set a supported athlete sport before opening these tools.");
    let prep = (await tx.query<Prep>(
      `SELECT id,revision,items,notes,selected_game FROM checklist_shares
       WHERE owner_clerk_user_id=$1 AND selected_game->>'id'=$2 ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
      [owner, event.id],
    )).rows[0];
    if (command) {
      const mode = (await tx.query<{ access_mode: string }>(
        "SELECT access_mode FROM account_access WHERE owner_clerk_user_id=$1", [owner],
      )).rows[0]?.access_mode;
      if (mode === "guest") throw new NativeLinkError(403, "Guest accounts cannot change saved event tools.");
      const digest = createHash("sha256").update(JSON.stringify(command)).digest("hex");
      const receipts = command.kind === "prep"
        ? (prep?.selected_game?.nativeReceipts as Receipt[] | undefined) ?? []
        : project?.project.nativeReceipts ?? [];
      const receipt = receipts.find((r) => r.id === command.mutationId);
      if (receipt && receipt.digest !== digest) throw new NativeLinkError(409, "This save identifier was already used for another change.");
      if (!receipt) {
        const revision = command.kind === "prep" ? prep?.revision ?? 0 : project?.revision ?? 0;
        if (revision !== command.expectedRevision) {
          throw new NativeLinkError(409, "This tool changed on another device. Reload before making another change.");
        }
        const nextReceipts = [...receipts.slice(-127), { id: command.mutationId, digest }];
        if (command.kind === "prep") {
          if (!command.items || new Set(command.items.map((i) => i.id)).size !== command.items.length) {
            throw new NativeLinkError(400, "Save a valid checklist with unique items.");
          }
          const selected = { ...event, nativeReceipts: nextReceipts };
          const values = [JSON.stringify(command.items), command.notes ?? "", JSON.stringify(selected)];
          if (prep) {
            prep = (await tx.query<Prep>(
              `UPDATE checklist_shares SET items=$1::jsonb,notes=$2,selected_game=$3::jsonb,
               revision=revision+1,updated_at=NOW() WHERE id=$4
               RETURNING id,revision,items,notes,selected_game`, [...values, prep.id],
            )).rows[0]!;
          } else {
            prep = (await tx.query<Prep>(
              `INSERT INTO checklist_shares(owner_clerk_user_id,title,items,notes,selected_game)
               VALUES ($4,$5,$1::jsonb,$2,$3::jsonb) RETURNING id,revision,items,notes,selected_game`,
              [...values, owner, event.type === "practice" ? "Practice Checklist" : "Gameday Checklist"],
            )).rows[0]!;
          }
        } else {
          if (event.type !== "game") throw new NativeLinkError(409, "Stat tracking is available for game Event Cards, not practices.");
          if ((event.status === "final" || sharedGame?.status === "final") && game?.status !== "final") {
            throw new NativeLinkError(409, "A final result already exists. Review the saved final game before tracking this event again.");
          }
          if (command.kind === "start" && event.status === "final") throw new NativeLinkError(409, "This Event Card is already complete.");
          const games = project?.project.games ?? [];
          if (command.kind === "start" && games.some((g) => !matches(g) && ["live", "paused"].includes(g.status))) {
            throw new NativeLinkError(409, "Finish the other active game before starting this one.");
          }
          game = applyNativeTrackerCommand(game, command, {
            sport, eventId: event.id, date: String(event.date), opponent: String(event.opponent ?? ""),
          });
          if (game.events.length > 20000) throw new NativeLinkError(409, "This game has reached its play limit.");
          const payload: Payload = {
            ...project?.project, tool: "stat-tracker", version: 1,
            games: [...games.filter((g) => !matches(g) && g.id !== game!.id), game],
            nativeReceipts: nextReceipts,
          };
          if (project) {
            project = (await tx.query<Project>(
              `UPDATE cloud_projects SET project=$1::jsonb,revision=revision+1,updated_at=NOW()
               WHERE id=$2 RETURNING id,revision,project`, [JSON.stringify(payload), project.id],
            )).rows[0]!;
          } else {
            const count = Number((await tx.query<{ count: string }>(
              "SELECT COUNT(*) FROM cloud_projects WHERE owner_clerk_user_id=$1", [owner],
            )).rows[0]?.count);
            if (count >= 100) throw new NativeLinkError(409, "Your saved project limit has been reached.");
            project = (await tx.query<Project>(
              `INSERT INTO cloud_projects(owner_clerk_user_id,name,project)
               VALUES ($1,'Stat Tracker',$2::jsonb) RETURNING id,revision,project`, [owner, JSON.stringify(payload)],
            )).rows[0]!;
          }
          // Update an existing spectator share without creating or extending public access.
          changedShares = (await tx.query<{ id: string }>(`UPDATE stat_tracker_shares SET game=$1::jsonb,revision=revision+1,updated_at=NOW()
            WHERE owner_clerk_user_id=$2 AND (game_id=$3 OR game->>'sourceEventId'=$3) RETURNING id`,
          [JSON.stringify(game), owner, event.id])).rows.map((row) => row.id);
          if (game.status === "final" && changedShares.length) {
            await tx.query(`UPDATE athlete_invites SET live_tracker_share_token=NULL
              WHERE owner_clerk_user_id=$1 AND live_tracker_share_token::text=ANY($2::text[])`, [owner, changedShares]);
          }
          await tx.query(`UPDATE schedule_shares SET events=(
            SELECT jsonb_agg(CASE WHEN e->>'id'=$2 THEN e || jsonb_build_object('status',$3::text) ELSE e END)
            FROM jsonb_array_elements(events) e),updated_at=NOW()
            WHERE owner_clerk_user_id=$1 AND events @> $4::jsonb`,
          [owner, event.id, game.status === "final" ? "final" : "live", JSON.stringify([{ id: event.id }])]);
        }
      }
    }
    const response = {
      linkId: link.id, prepRevision: prep?.revision ?? 0, trackerRevision: project?.revision ?? 0,
      prep: { items: prep?.items ?? nativePrepTemplate(event.type === "practice"), notes: prep?.notes ?? "" },
      sport, rules: nativeSportRules[sport], game,
    };
    await tx.query("COMMIT");
    // The data is committed before recipients can fetch the new revision.
    // A notification error must never turn a successful save into a failed save.
    for (const id of changedShares) {
      try { await notifyTrackerShare?.(id); } catch {
        console.error("Native tracker saved, but its spectator notification failed.");
      }
    }
    return response;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally { tx.release(); }
}
