import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { accountAccessTable, accountEntitlementEventsTable, db } from "@workspace/db";
import { CreateAthleteInviteBody } from "@workspace/api-zod";
import { createAccountAccessRouter } from "./routes/accountAccess";
import lifecycleRouter from "./routes/accountLifecycle";
import {
  createAccountProvisioning,
  type AccountProvisioningClerkClient,
} from "./lib/accountProvisioning";

const owner = `lifecycle-browser-first-${randomUUID()}`;
const other = `lifecycle-browser-second-${randomUUID()}`;
const firstSaveOwner = "first-save-supporter";
const users = new Set([owner, other, firstSaveOwner]);
let failNextFirstSaveClerkRead = false;
let firstSavePublicMetadata: Record<string, unknown> = {};
let firstSaveUnsafeMetadata: Record<string, unknown> = {};
let firstSaveAthleteInvites: Record<string, unknown>[] = [];
const fixtureErrors: string[] = [];
const firstSaveClerk = {
  users: {
    async getUser(userId: string) {
      if (userId !== firstSaveOwner) throw { status: 404 };
      if (failNextFirstSaveClerkRead) {
        failNextFirstSaveClerkRead = false;
        throw new Error("Simulated temporary Clerk failure");
      }
      return {
        createdAt: Date.now() - 60_000,
        publicMetadata: { ...firstSavePublicMetadata },
        unsafeMetadata: {},
        emailAddresses: [{
          emailAddress: "morgan@example.test",
          verification: { status: "verified" },
        }],
      };
    },
    async updateUserMetadata(userId: string, metadata: { publicMetadata?: Record<string, unknown> }) {
      if (userId !== firstSaveOwner) throw { status: 404 };
      firstSavePublicMetadata = { ...firstSavePublicMetadata, ...metadata.publicMetadata };
      return { publicMetadata: { ...firstSavePublicMetadata } };
    },
    async getUserList({ emailAddress }: { emailAddress?: string[] }) {
      const verifiedEmail = "morgan@example.test";
      const matches = emailAddress?.some((address) => address.trim().toLowerCase() === verifiedEmail)
        ? [{
          id: firstSaveOwner,
          emailAddresses: [{
            emailAddress: verifiedEmail,
            verification: { status: "verified" },
          }],
        }]
        : [];
      return { data: matches, totalCount: matches.length };
    },
  },
} as unknown as AccountProvisioningClerkClient;
const firstSaveProvisioning = createAccountProvisioning(() => firstSaveClerk);
let failure: { viewer: string; method: string; path: string } | null = null;

async function main() {
  await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, firstSaveOwner));
  await db.insert(accountAccessTable).values([
    { ownerClerkUserId: owner, role: "fan", accessMode: "full" },
    { ownerClerkUserId: other, role: "fan", accessMode: "full" },
  ]);
  await db.insert(accountEntitlementEventsTable).values({
    ownerClerkUserId: owner,
    providerEventId: `lifecycle-browser-${randomUUID()}`,
    planTier: "pro",
    entitlementExpiresAt: new Date(Date.now() + 86_400_000),
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Test-User");
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });
  app.get("/__fixture/health", (_req, res) => res.json({ owner, other }));
  app.get("/__fixture/errors", (_req, res) => res.json(fixtureErrors));
  app.post("/__fixture/fail-clerk-once", (req, res) => {
    if (req.body?.viewer !== firstSaveOwner) { res.status(400).end(); return; }
    failNextFirstSaveClerkRead = true;
    res.status(204).end();
  });
  app.get("/__fixture/profile", (req, res) => {
    if (req.query.viewer !== firstSaveOwner) { res.status(400).end(); return; }
    res.json({ unsafeMetadata: firstSaveUnsafeMetadata });
  });
  app.get("/__fixture/athlete-invites", (req, res) => {
    if (req.query.viewer !== firstSaveOwner) { res.status(400).end(); return; }
    res.json(firstSaveAthleteInvites);
  });
  app.post("/__fixture/profile", (req, res) => {
    if (req.body?.viewer !== firstSaveOwner || typeof req.body?.unsafeMetadata !== "object" || !req.body.unsafeMetadata) {
      res.status(400).end();
      return;
    }
    firstSaveUnsafeMetadata = { ...req.body.unsafeMetadata };
    res.status(204).end();
  });
  app.post("/__fixture/fail", (req, res) => {
    failure = req.body as typeof failure;
    res.status(204).end();
  });
  app.post("/__fixture/expire", async (req, res) => {
    const viewer = req.body?.viewer;
    if (!users.has(viewer)) { res.status(400).end(); return; }
    await db.update(accountAccessTable).set({ pauseEndsAt: new Date(Date.now() - 1_000) })
      .where(eq(accountAccessTable.ownerClerkUserId, viewer));
    res.status(204).end();
  });
  app.post("/__fixture/delete-account", async (req, res) => {
    const viewer = req.body?.viewer;
    if (!users.has(viewer)) { res.status(400).end(); return; }
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, viewer));
    res.status(204).end();
  });
  app.get("/__fixture/state", async (req, res) => {
    const viewer = String(req.query.viewer);
    if (!users.has(viewer)) { res.status(400).end(); return; }
    const [record] = await db.select().from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, viewer));
    res.json({
      status: record?.lifecycleStatus ?? "not_provisioned",
      pauseEndsAt: record?.pauseEndsAt ?? null,
      provisionedMarker: viewer === firstSaveOwner
        ? firstSavePublicMetadata.pixlSportsAccountProvisioned === true
        : null,
    });
  });
  app.use("/api", (req, res, next) => {
    const viewer = req.get("x-test-user");
    if (!viewer || !users.has(viewer)) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (failure && failure.viewer === viewer && failure.method === req.method && failure.path === req.path) {
      failure = null;
      res.status(503).json({ error: "Simulated temporary failure" });
      return;
    }
    const auth = () => ({ userId: viewer, tokenType: "session_token" });
    (auth as typeof auth & { [key: symbol]: boolean })[Symbol.for("@clerk/express.auth")] = true;
    (req as typeof req & { auth: typeof auth; log: { error: () => void; warn: () => void } }).auth = auth;
    req.log = {
      error: (details: { err?: unknown }) => {
        fixtureErrors.push(details.err instanceof Error ? details.err.message : JSON.stringify(details));
      },
      warn: () => {},
    } as unknown as typeof req.log;
    next();
  });
  app.use("/api", (req, res, next) => {
    if (req.path !== "/athlete-invites") { next(); return; }
    const isFirstSaveOwner = req.get("x-test-user") === firstSaveOwner;
    if (req.method === "GET") {
      res.json(isFirstSaveOwner ? firstSaveAthleteInvites : []);
      return;
    }
    if (req.method !== "POST" || !isFirstSaveOwner) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (firstSaveAthleteInvites.length) {
      res.status(409).json({ error: "This account already has an athlete invite." });
      return;
    }
    const parsed = CreateAthleteInviteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid starter HYPE Card" });
      return;
    }
    const invite = {
      ...parsed.data,
      inviteToken: randomUUID().replaceAll("-", ""),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    firstSaveAthleteInvites = [invite];
    res.status(201).json(invite);
  });
  app.use("/api", createAccountAccessRouter(firstSaveProvisioning, async () => false));
  app.use("/api", lifecycleRouter);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  const server = app.listen(Number(process.env.PORT), "127.0.0.1");

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await new Promise<void>((done) => server.close(() => done()));
    await db.delete(accountEntitlementEventsTable).where(eq(accountEntitlementEventsTable.ownerClerkUserId, owner));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, owner));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, other));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, firstSaveOwner));
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});