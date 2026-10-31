import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { NativeLinkError } from "./nativeIdentity";

const definition = (id: string, label: string, points = 0) => ({ id, label, points });
// These IDs and point values match the existing PIXL tracker payload contract.
export const nativeSportRules = {
  basketball: { phaseLabel: "Quarter", stats: [
    definition("one-point", "Free throw", 1), definition("two-point", "Two-point field goal", 2),
    definition("three-point", "Three-pointer", 3), definition("rebound", "Rebound"),
    definition("assist", "Assist"), definition("steal", "Steal"), definition("block", "Block"),
    definition("turnover", "Turnover"), definition("foul", "Foul"),
  ] },
  soccer: { phaseLabel: "Half", stats: [
    definition("goal", "Goal", 1), definition("assist", "Assist"), definition("shot", "Shot"),
    definition("shot-on-target", "Shot on target"), definition("pass", "Pass"), definition("header", "Header"),
    definition("clearance", "Clearance"), definition("corner-kick", "Corner kick"),
    definition("penalty-kick", "Penalty kick"), definition("save", "Save"),
    definition("yellow-card", "Yellow card"), definition("red-card", "Red card"),
  ] },
  football: { phaseLabel: "Quarter", stats: [
    definition("touchdown", "Touchdown", 6), definition("field-goal", "Field goal", 3),
    definition("extra-point", "Extra point", 1), definition("two-point-conversion", "Two-point conversion", 2),
    definition("pass-yard", "Passing play"), definition("rush-yard", "Rushing play"),
    definition("interception", "Interception"), definition("tackle", "Tackle"), definition("reception", "Reception"),
    definition("first-down", "First down"), definition("sack", "Sack"),
  ] },
  baseball: { phaseLabel: "Inning", stats: [
    definition("run", "Run", 1), definition("hit", "Hit"), definition("single", "Single"),
    definition("double", "Double"), definition("triple", "Triple"), definition("rbi", "RBI", 1),
    definition("home-run", "Home run", 4), definition("strikeout", "Strikeout"), definition("walk", "Walk"),
    definition("stolen-base", "Stolen base"), definition("pitch", "Pitch"), definition("fastball", "Fastball"),
    definition("changeup", "Changeup"), definition("slider", "Slider"), definition("curveball", "Curveball"),
  ] },
  softball: { phaseLabel: "Inning", stats: [
    definition("run", "Run", 1), definition("hit", "Hit"), definition("rbi", "RBI", 1),
    definition("home-run", "Home run", 4), definition("strikeout", "Strikeout"), definition("walk", "Walk"),
    definition("stolen-base", "Stolen base"), definition("pitch", "Pitch"),
  ] },
  volleyball: { phaseLabel: "Set", stats: [
    definition("kill", "Kill", 1), definition("ace", "Ace", 1), definition("block", "Block", 1),
    definition("dig", "Dig"), definition("assist", "Assist"), definition("service-error", "Service error"),
    definition("reception", "Reception"),
  ] },
};
export type NativeSport = keyof typeof nativeSportRules;
export interface NativePlay {
  id: string; statId: string; attribution?: string; possessionSide?: string;
  period: number; createdAt: string; yards?: number; playId?: string;
}
export interface NativeGame {
  [key: string]: unknown;
  id: string; sourceEventId?: string; sport: NativeSport; status: string;
  date: string; opponent: string; period: number; score: number; opponentScore: number;
  scoreRecorded?: boolean; soccerPeriodFormat?: string; outcome?: string;
  stats: Record<string, number>; opponentStats?: Record<string, number>;
  yardStats?: Record<string, number>; opponentYardStats?: Record<string, number>;
  events: NativePlay[]; startedAt: string; endedAt?: string;
}
export const nativeWorkspaceCommand = z.object({
  shareToken: z.uuid(),
  mutationId: z.uuid(),
  linkId: z.uuid(),
  expectedRevision: z.number().int().min(0),
  kind: z.enum(["prep", "start", "stat", "undo", "score", "period", "pause", "resume", "finish"]),
  statId: z.string().max(60).optional(),
  athlete: z.boolean().optional(),
  opponent: z.boolean().optional(),
  yards: z.number().int().min(0).max(100).optional(),
  delta: z.union([z.literal(-1), z.literal(1)]).optional(),
  soccerFormat: z.enum(["halves", "quarters"]).optional(),
  recordScore: z.boolean().optional(),
  outcome: z.enum(["win", "loss", "tie"]).optional(),
  items: z.array(z.object({
    id: z.string().min(1).max(100), label: z.string().trim().min(1).max(200),
    completed: z.boolean(), section: z.string().max(100).nullish(),
  }).strict()).max(100).optional(),
  notes: z.string().max(4000).optional(),
}).strict();
export type WorkspaceCommand = z.infer<typeof nativeWorkspaceCommand>;
const fail = (message: string): never => { throw new NativeLinkError(409, message); };
const yardMetric = (statId: string) => statId === "pass-yard" || statId === "rush-yard" ? statId
  : statId === "reception" ? "receiving-yard" : null;

export function applyNativeTrackerCommand(
  current: NativeGame | null, command: WorkspaceCommand,
  context: { sport: NativeSport; eventId: string; date: string; opponent: string },
): NativeGame {
  if (command.kind === "start") {
    if (current) return fail("This event already has a tracker. Reload to continue it.");
    if (context.sport === "soccer" && !command.soccerFormat) return fail("Choose halves or quarters before starting soccer.");
    return {
      id: `tracker-game-${randomUUID()}`, sourceEventId: context.eventId,
      sport: context.sport, date: context.date, opponent: context.opponent,
      status: "live", period: 1, score: 0, opponentScore: 0, scoreRecorded: false,
      notes: "", stats: {}, events: [], startedAt: new Date().toISOString(),
      trackYards: context.sport === "football", yardStats: {}, opponentStats: {}, opponentYardStats: {},
      ...(context.sport === "soccer" ? { soccerPeriodFormat: command.soccerFormat } : {}),
    };
  }
  if (!current) return fail("Start this event’s tracker first.");
  const game = structuredClone(current);
  if (game.status === "final") return fail("This game is final. Its saved stats are read-only here.");
  if (command.kind === "resume") { game.status = "live"; delete game.pauseReason; return game; }
  if (command.kind === "finish") {
    if (command.recordScore === undefined) return fail("Choose whether to record a final score.");
    game.status = "final";
    game.endedAt = new Date().toISOString();
    game.scoreRecorded = command.recordScore;
    delete game.pauseReason;
    delete game.outcome;
    if (command.recordScore) game.outcome = game.score > game.opponentScore ? "win" : game.score < game.opponentScore ? "loss" : "tie";
    else if (command.outcome) game.outcome = command.outcome;
    return game;
  }
  if (game.status !== "live") return fail("Resume tracking before making changes.");
  if (command.kind === "pause") { game.status = "paused"; return game; }
  if (command.kind === "period") { game.period += 1; return game; }
  if (command.kind === "score") {
    if (!command.delta) return fail("Choose a score adjustment.");
    const side = command.opponent ? "opponentScore" : "score";
    game[side] = Math.max(0, game[side] + command.delta);
    game.scoreRecorded = true;
    return game;
  }
  const rules = nativeSportRules[game.sport];
  if (!rules) return fail("This saved sport is not supported by the native tracker.");
  if (command.kind === "stat") {
    const stat = rules.stats.find((item) => item.id === command.statId);
    if (!stat) return fail("Choose a valid stat for this sport.");
    const otherTeam = game.sport === "football" && command.opponent === true;
    const target = otherTeam ? (game.opponentStats ??= {}) : game.stats;
    target[stat.id] = (target[stat.id] ?? 0) + 1;
    const teamPoints = otherTeam || !command.athlete ? stat.points : 0;
    game[otherTeam ? "opponentScore" : "score"] += teamPoints;
    game.scoreRecorded = game.scoreRecorded === true || teamPoints > 0;
    const yards = game.sport === "football" ? command.yards ?? 0 : 0;
    const metric = yardMetric(stat.id);
    if (game.sport === "football" && metric && yards) {
      const totals = otherTeam ? (game.opponentYardStats ??= {}) : (game.yardStats ??= {});
      totals[metric] = (totals[metric] ?? 0) + yards;
    }
    game.events.push({
      id: randomUUID(), statId: stat.id, period: game.period, createdAt: new Date().toISOString(),
      attribution: otherTeam ? "team" : command.athlete ? "athlete" : "team",
      ...(game.sport === "football" ? { possessionSide: otherTeam ? "opponent" : "athlete", yards } : {}),
    });
    return game;
  }
  if (command.kind === "undo") {
    const last = game.events.at(-1);
    if (!last) return fail("There is no stat to undo.");
    const removed = game.events.filter((item) => last.playId ? item.playId === last.playId : item.id === last.id);
    for (const play of removed) {
      const otherTeam = game.sport === "football" && play.possessionSide === "opponent";
      const target = otherTeam ? (game.opponentStats ??= {}) : game.stats;
      target[play.statId] = Math.max(0, (target[play.statId] ?? 0) - 1);
      const side = otherTeam ? "opponentScore" : "score";
      const points = otherTeam || play.attribution !== "athlete"
        ? rules.stats.find((s) => s.id === play.statId)?.points ?? 0 : 0;
      game[side] = Math.max(0, game[side] - points);
      const metric = yardMetric(play.statId);
      if (game.sport === "football" && metric) {
        const totals = otherTeam ? (game.opponentYardStats ??= {}) : (game.yardStats ??= {});
        totals[metric] = Math.max(0, (totals[metric] ?? 0) - (play.yards ?? 0));
      }
    }
    game.events = game.events.filter((play) => !removed.includes(play));
    return game;
  }
  return fail("Unknown tracker action.");
}
