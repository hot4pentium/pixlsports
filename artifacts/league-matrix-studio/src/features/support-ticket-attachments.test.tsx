import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { SupportTicketAttachments } from "./support-ticket-attachments";

test("renders attachment failures and opens authorized image attachments", async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  let requestUrl = "";
  let requestToken = "";
  let renderer: ReactTestRenderer | undefined;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestToken = new Headers(init?.headers).get("X-Support-Ticket-Token") ?? "";
    return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };
  URL.createObjectURL = () => "blob:ticket-screenshot";
  URL.revokeObjectURL = () => undefined;

  try {
    await act(async () => {
      renderer = create(React.createElement(SupportTicketAttachments, {
        token: "guest-ticket-token",
        attachments: [
          {
            id: "unsupported-file",
            filename: "notes.txt",
            contentType: "text/plain",
            size: 50,
            status: "unsupported",
            downloadUrl: null,
          },
          {
            id: "screenshot",
            filename: "sideline.png",
            contentType: "image/png",
            size: 3,
            status: "available",
            downloadUrl: "/api/support/tickets/ticket/messages/message/attachments/screenshot",
          },
        ],
      }));
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    assert.match(rendered, /notes\.txt/);
    assert.match(rendered, /not supported/);
    assert.equal(renderer!.root.findByType("button").props.children, "View attachment");

    await act(async () => {
      await renderer!.root.findByType("button").props.onClick();
    });

    assert.equal(requestUrl, "/api/support/tickets/ticket/messages/message/attachments/screenshot");
    assert.equal(requestToken, "guest-ticket-token");
    assert.equal(renderer!.root.findByType("img").props.alt, "sideline.png");
  } finally {
    renderer?.unmount();
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }
});
