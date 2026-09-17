import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  accountAccessTable,
  checklistSharesTable,
  db,
} from "@workspace/db";
import {
  CreateChecklistShareBody,
  CreateChecklistShareResponse,
  UpdateChecklistShareBody,
  UpdateChecklistShareResponse,
} from "@workspace/api-zod";
import checklistSharesRouter from "./routes/checklistShares";

const checklist = {
  title: "Saturday tournament",
  mode: "gameday" as const,
  items: [
    {
      id: "water",
      label: "Bring water",
      completed: false,
      section: "Before leaving",
    },
  ],
};

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
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  userId: string,
  body: unknown,
  parse: (value: unknown) => T,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-test-user": userId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new ApiContractError(response.status, data);
  return parse(data);
}

async function expectApiError(action: () => Promise<unknown>, status: number) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof ApiContractError);
    assert.equal(error.status, status);
    return true;
  });
}

test("collaborators recover stale checklist revisions and owners control link rotation", async () => {
  const ownerId = `checklist-owner-${crypto.randomUUID()}`;
  const collaboratorId = `checklist-collaborator-${crypto.randomUUID()}`;
  const app = express();

  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    const auth = () => ({
      userId: userId || undefined,
      tokenType: "session_token",
    });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined };
    next();
  });
  app.use("/api", checklistSharesRouter);

  const server = app.listen(0);
  try {
    await db.insert(accountAccessTable).values({
      ownerClerkUserId: ownerId,
      role: "coach",
      accessMode: "full",
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const firstShare = await requestJson(
      baseUrl,
      "POST",
      "/api/checklist-shares",
      ownerId,
      CreateChecklistShareBody.parse(checklist),
      CreateChecklistShareResponse.parse,
    );
    assert.match(firstShare.shareToken, /^[0-9a-f-]{36}$/);
    assert.equal(firstShare.revision, 1);
    assert.equal(firstShare.canManage, true);

    const collaboratorView = await requestJson(
      baseUrl,
      "GET",
      `/api/checklist-shares/${firstShare.shareToken}`,
      collaboratorId,
      undefined,
      CreateChecklistShareResponse.parse,
    );
    assert.equal(collaboratorView.canManage, false);
    assert.equal(collaboratorView.revision, 1);

    const ownerUpdate = await requestJson(
      baseUrl,
      "PATCH",
      `/api/checklist-shares/${firstShare.shareToken}`,
      ownerId,
      UpdateChecklistShareBody.parse({
        ...checklist,
        items: [{ ...checklist.items[0], completed: true }],
        expectedRevision: 1,
      }),
      UpdateChecklistShareResponse.parse,
    );
    assert.equal(ownerUpdate.revision, 2);
    assert.equal(ownerUpdate.items[0]?.completed, true);

    await assert.rejects(
      () => requestJson(
        baseUrl,
        "PATCH",
        `/api/checklist-shares/${firstShare.shareToken}`,
        collaboratorId,
        UpdateChecklistShareBody.parse({
          ...checklist,
          title: "Stale collaborator edit",
          expectedRevision: 1,
        }),
        UpdateChecklistShareResponse.parse,
      ),
      (error: unknown) => {
        assert.ok(error instanceof ApiContractError);
        assert.equal(error.status, 409);
        const current = (error.data as { current: typeof firstShare }).current;
        assert.equal(current.revision, 2);
        assert.equal(current.title, "Saturday tournament");
        assert.equal(current.items[0]?.completed, true);
        return true;
      },
    );

    const recovered = await requestJson(
      baseUrl,
      "GET",
      `/api/checklist-shares/${firstShare.shareToken}`,
      collaboratorId,
      undefined,
      CreateChecklistShareResponse.parse,
    );
    assert.equal(recovered.revision, 2);
    assert.equal(recovered.items[0]?.completed, true);

    const rotatedShare = await requestJson(
      baseUrl,
      "POST",
      "/api/checklist-shares",
      ownerId,
      CreateChecklistShareBody.parse({ ...checklist, title: "Rotated Saturday tournament" }),
      CreateChecklistShareResponse.parse,
    );
    assert.notEqual(rotatedShare.shareToken, firstShare.shareToken);
    assert.equal(
      (await requestJson(
        baseUrl,
        "GET",
        `/api/checklist-shares/${rotatedShare.shareToken}`,
        collaboratorId,
        undefined,
        CreateChecklistShareResponse.parse,
      )).canManage,
      false,
    );

    await expectApiError(
      () => requestJson(
        baseUrl,
        "DELETE",
        `/api/checklist-shares/${rotatedShare.shareToken}`,
        collaboratorId,
        undefined,
        () => undefined,
      ),
      404,
    );
    assert.equal(
      (await requestJson(
        baseUrl,
        "GET",
        `/api/checklist-shares/${rotatedShare.shareToken}`,
        ownerId,
        undefined,
        CreateChecklistShareResponse.parse,
      )).title,
      "Rotated Saturday tournament",
    );

    await requestJson(
      baseUrl,
      "DELETE",
      `/api/checklist-shares/${firstShare.shareToken}`,
      ownerId,
      undefined,
      () => undefined,
    );
    await expectApiError(
      () => requestJson(
        baseUrl,
        "GET",
        `/api/checklist-shares/${firstShare.shareToken}`,
        collaboratorId,
        undefined,
        CreateChecklistShareResponse.parse,
      ),
      404,
    );
    assert.equal(
      (await requestJson(
        baseUrl,
        "GET",
        `/api/checklist-shares/${rotatedShare.shareToken}`,
        ownerId,
        undefined,
        CreateChecklistShareResponse.parse,
      )).shareToken,
      rotatedShare.shareToken,
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await db.delete(checklistSharesTable).where(eq(checklistSharesTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
  }
});