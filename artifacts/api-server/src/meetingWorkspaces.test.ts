import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import { accountAccessTable, db, meetingWorkspacesTable } from "@workspace/db";
import {
  GetMeetingRecapResponse,
  GetMeetingWorkspaceResponse,
  UpsertMeetingWorkspaceBody,
  UpsertMeetingWorkspaceResponse,
} from "@workspace/api-zod";
import meetingWorkspacesRouter from "./routes/meetingWorkspaces";

class ApiContractError extends Error {
  constructor(
    readonly status: number,
    readonly data: unknown,
  ) {
    super(`Expected API request to succeed, got ${status}`);
  }
}

async function requestJson<T>(
  baseUrl: string,
  method: "GET" | "PUT" | "DELETE",
  path: string,
  userId: string | undefined,
  body: unknown,
  parse: (value: unknown) => T,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(userId ? { "x-test-user": userId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new ApiContractError(response.status, data);
  return parse(data);
}

async function expectStatus(action: () => Promise<unknown>, status: number) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof ApiContractError);
    assert.equal(error.status, status);
    return true;
  });
}

test("meeting workspaces persist owner revisions and revoke public recaps", async () => {
  const ownerId = `meeting-owner-${crypto.randomUUID()}`;
  const otherOwnerId = `meeting-other-${crypto.randomUUID()}`;
  const meetingId = `meeting-${crypto.randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({ userId: userId || undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined };
    next();
  });
  app.use("/api", meetingWorkspacesRouter);
  const server = app.listen(0);

  const workspace = {
    notes: "Bring the updated lineup.",
    participants: [{ id: "coach", name: "Coach", role: "Staff", present: true }],
    agenda: [{ id: "agenda-1", label: "Review priorities", completed: false }],
    decisions: [{ id: "decision-1", text: "Keep the press after halftime." }],
    followUps: [{ id: "follow-up-1", task: "Send recap", owner: "Coach", dueDate: "2026-10-01" }],
    startedAt: "2026-09-24T15:00:00.000Z",
    endedAt: null,
    context: {
      id: meetingId,
      date: "2026-09-24",
      time: "15:00",
      location: "Clubhouse",
      title: "Weekly staff meeting",
    },
  };

  try {
    await db.insert(accountAccessTable).values([
      { ownerClerkUserId: ownerId, role: "coach", accessMode: "full" },
      { ownerClerkUserId: otherOwnerId, role: "coach", accessMode: "full" },
    ]);
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const createBody = UpsertMeetingWorkspaceBody.parse({ workspace });

    const created = await requestJson(
      baseUrl,
      "PUT",
      `/api/meeting-workspaces/${meetingId}`,
      ownerId,
      createBody,
      UpsertMeetingWorkspaceResponse.parse,
    );
    assert.equal(created.ownerClerkUserId, ownerId);
    assert.equal(created.ownerMeetingId, meetingId);
    assert.match(created.publicToken, /^[A-Za-z0-9_-]{32,80}$/);
    assert.equal(created.revision, 1);

    const ownerRead = await requestJson(
      baseUrl,
      "GET",
      `/api/meeting-workspaces/${meetingId}`,
      ownerId,
      undefined,
      GetMeetingWorkspaceResponse.parse,
    );
    assert.equal(ownerRead.workspace.notes, workspace.notes);
    assert.equal(ownerRead.publicToken, created.publicToken);

    await expectStatus(
      () => requestJson(baseUrl, "GET", `/api/meeting-workspaces/${meetingId}`, otherOwnerId, undefined, GetMeetingWorkspaceResponse.parse),
      404,
    );

    const publicRecap = await requestJson(
      baseUrl,
      "GET",
      `/api/meeting-recaps/${created.publicToken}`,
      undefined,
      undefined,
      GetMeetingRecapResponse.parse,
    );
    assert.equal(publicRecap.workspace.notes, workspace.notes);
    assert.equal(publicRecap.revision, 1);
    assert.equal("ownerClerkUserId" in publicRecap, false);
    assert.equal("ownerMeetingId" in publicRecap, false);
    assert.equal("publicToken" in publicRecap, false);

    const updated = await requestJson(
      baseUrl,
      "PUT",
      `/api/meeting-workspaces/${meetingId}`,
      ownerId,
      UpsertMeetingWorkspaceBody.parse({
        workspace: { ...workspace, notes: "Bring the final lineup." },
        expectedRevision: 1,
      }),
      UpsertMeetingWorkspaceResponse.parse,
    );
    assert.equal(updated.revision, 2);
    assert.equal(updated.publicToken, created.publicToken);
    assert.equal(updated.workspace.notes, "Bring the final lineup.");

    await assert.rejects(
      () => requestJson(
        baseUrl,
        "PUT",
        `/api/meeting-workspaces/${meetingId}`,
        ownerId,
        UpsertMeetingWorkspaceBody.parse({
          workspace: { ...workspace, notes: "Stale write" },
          expectedRevision: 1,
        }),
        UpsertMeetingWorkspaceResponse.parse,
      ),
      (error: unknown) => {
        assert.ok(error instanceof ApiContractError);
        assert.equal(error.status, 409);
        assert.equal((error.data as { current: { revision: number } }).current.revision, 2);
        return true;
      },
    );

    await expectStatus(
      () => requestJson(baseUrl, "DELETE", `/api/meeting-workspaces/${meetingId}`, otherOwnerId, undefined, () => undefined),
      404,
    );
    const otherWorkspace = await requestJson(
      baseUrl,
      "PUT",
      `/api/meeting-workspaces/${meetingId}`,
      otherOwnerId,
      UpsertMeetingWorkspaceBody.parse({
        workspace: { ...workspace, notes: "Other account workspace" },
      }),
      UpsertMeetingWorkspaceResponse.parse,
    );
    assert.notEqual(otherWorkspace.publicToken, created.publicToken);
    assert.equal(
      (await requestJson(
        baseUrl,
        "GET",
        `/api/meeting-workspaces/${meetingId}`,
        ownerId,
        undefined,
        GetMeetingWorkspaceResponse.parse,
      )).workspace.notes,
      "Bring the final lineup.",
    );
    await requestJson(baseUrl, "DELETE", `/api/meeting-workspaces/${meetingId}`, ownerId, undefined, () => undefined);
    await expectStatus(
      () => requestJson(baseUrl, "GET", `/api/meeting-recaps/${created.publicToken}`, undefined, undefined, GetMeetingRecapResponse.parse),
      404,
    );

    const restored = await requestJson(
      baseUrl,
      "PUT",
      `/api/meeting-workspaces/${meetingId}`,
      ownerId,
      UpsertMeetingWorkspaceBody.parse({
        workspace: { ...workspace, notes: "Restored recap" },
        expectedRevision: 2,
      }),
      UpsertMeetingWorkspaceResponse.parse,
    );
    assert.equal(restored.revision, 3);
    assert.equal(restored.publicToken, created.publicToken);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(meetingWorkspacesTable).where(eq(meetingWorkspacesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, otherOwnerId));
  }
});