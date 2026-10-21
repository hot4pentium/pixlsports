import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import athleteInvitesRouter from "./routes/athleteInvites";
import soccerGearRouter from "./routes/soccerGear";
import sportGearRouter from "./routes/sportGear";

test("retired gear API routes point clients to Showcase without mutating data", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", sportGearRouter, soccerGearRouter, athleteInvitesRouter);
  const server = app.listen(0);

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}/api`;
    const requests: Array<{ path: string; method: string; showcaseUrl: string }> = [
      { path: "/athlete-gear/sports?sport=baseball", method: "GET", showcaseUrl: "/studio/player-showcase" },
      { path: "/athlete-gear/sports/baseball", method: "PUT", showcaseUrl: "/studio/player-showcase" },
      { path: "/athlete-gear/soccer", method: "GET", showcaseUrl: "/studio/player-showcase" },
      { path: "/athlete-gear/soccer", method: "PUT", showcaseUrl: "/studio/player-showcase" },
      { path: "/athlete-gear/soccer/activity", method: "POST", showcaseUrl: "/studio/player-showcase" },
      { path: "/athlete-gear/soccer/share-action", method: "POST", showcaseUrl: "/studio/player-showcase" },
      { path: "/athlete-invites/legacy-token/jersey-showcase/gear", method: "GET", showcaseUrl: "/showcase/legacy-token" },
    ];

    for (const request of requests) {
      const response = await fetch(base + request.path, {
        method: request.method,
        headers: { "content-type": "application/json" },
        ...(request.method === "POST" || request.method === "PUT" ? { body: "{}" } : {}),
      });
      assert.equal(response.status, 410, `${request.method} ${request.path} is retired`);
      const body = await response.json() as { error?: string; showcaseUrl?: string };
      assert.match(body.error ?? "", /retired/i);
      assert.equal(body.showcaseUrl, request.showcaseUrl);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
