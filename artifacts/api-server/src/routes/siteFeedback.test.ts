import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createSiteFeedbackRouter } from "./siteFeedback";

const FEEDBACK = {
  feedbackType: "feature",
  message: "Please add a way to duplicate an event card.",
};

async function startServer(router: ReturnType<typeof createSiteFeedbackRouter>) {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api", router);
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}/api/site-feedback`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

test("valid feedback is passed to the sender and acknowledged", async () => {
  const delivered: Array<{ feedbackType: string; message: string; replyEmail?: string }> = [];
  const server = await startServer(createSiteFeedbackRouter({
    sendEmail: async (feedback) => { delivered.push(feedback); },
  }));

  try {
    const response = await fetch(server.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...FEEDBACK, replyEmail: "tester@example.com" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true });
    assert.deepEqual(delivered, [{
      feedbackType: "feature",
      message: "Please add a way to duplicate an event card.",
      replyEmail: "tester@example.com",
    }]);
  } finally {
    await server.close();
  }
});

test("feedback without a reply address is delivered without one and its message is not returned", async () => {
  const delivered: Array<{ feedbackType: string; message: string; replyEmail?: string }> = [];
  const server = await startServer(createSiteFeedbackRouter({
    sendEmail: async (feedback) => { delivered.push(feedback); },
  }));

  try {
    const response = await fetch(server.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(FEEDBACK),
    });
    const responseBody = await response.text();

    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(responseBody), { accepted: true });
    assert.doesNotMatch(responseBody, /Please add a way to duplicate/);
    assert.deepEqual(delivered, [FEEDBACK]);
  } finally {
    await server.close();
  }
});

test("the honeypot acknowledges bots without sending email", async () => {
  let sends = 0;
  const server = await startServer(createSiteFeedbackRouter({
    sendEmail: async () => { sends += 1; },
  }));

  try {
    const response = await fetch(server.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...FEEDBACK, website: "https://spam.example" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true });
    assert.equal(sends, 0);
  } finally {
    await server.close();
  }
});

test("invalid feedback is rejected before delivery", async () => {
  let sends = 0;
  const server = await startServer(createSiteFeedbackRouter({
    sendEmail: async () => { sends += 1; },
  }));

  try {
    const response = await fetch(server.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedbackType: "feature", message: "too short" }),
    });

    assert.equal(response.status, 400);
    assert.equal(sends, 0);
  } finally {
    await server.close();
  }
});

test("feedback submissions are rate limited by client address", async () => {
  let sends = 0;
  const server = await startServer(createSiteFeedbackRouter({
    sendEmail: async () => { sends += 1; },
    maxRequests: 1,
    now: () => 1_800_000_000_000,
  }));

  try {
    const send = () => fetch(server.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(FEEDBACK),
    });
    assert.equal((await send()).status, 200);
    const limited = await send();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(sends, 1);
  } finally {
    await server.close();
  }
});
