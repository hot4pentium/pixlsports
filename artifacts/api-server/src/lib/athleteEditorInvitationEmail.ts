export async function sendExistingAccountCardInvitation(input: {
  emailAddress: string;
  athleteName: string;
  accessId: string;
  revision: string;
  origin: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Invitation email service is not configured");
  const url = new URL("/card-editor", input.origin).href;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `card-editor-${input.accessId}-${input.revision}`,
    },
    body: JSON.stringify({
      from: "Pixl Sports <support@pixlsports.com>",
      to: [input.emailAddress],
      subject: "You're invited to edit a Pixl Sports HYPE Card",
      text: [
        `You've been invited to edit ${input.athleteName}'s HYPE Card.`,
        "",
        `Sign in with ${input.emailAddress}, then review and accept the invitation:`,
        url,
        "",
        "This grants design and favorite-moment access to this card only.",
        "Your existing account stays unchanged. Publishing, privacy, sharing, and account settings remain with the card owner.",
        "If you were not expecting this invitation, you can ignore it.",
      ].join("\n"),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Invitation email was rejected (${response.status})`);
}
