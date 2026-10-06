import { Router, type IRouter } from "express";
import {
  SendSiteFeedbackBody,
  SendSiteFeedbackResponse,
  type SiteFeedbackInput,
} from "@workspace/api-zod";

type FeedbackMessage = Pick<SiteFeedbackInput, "feedbackType" | "message" | "replyEmail">;

type SiteFeedbackDependencies = {
  sendEmail?: (feedback: FeedbackMessage) => Promise<void>;
  now?: () => number;
  maxRequests?: number;
  windowMs?: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

class EmailProviderNotConfiguredError extends Error {
  constructor() {
    super("The Resend API key is not configured.");
    this.name = "EmailProviderNotConfiguredError";
  }
}

class EmailProviderRejectedError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super(`Resend rejected the feedback message with status ${statusCode}.`);
    this.name = "EmailProviderRejectedError";
    this.statusCode = statusCode;
  }
}

async function sendFeedbackWithResend(feedback: FeedbackMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new EmailProviderNotConfiguredError();

  const feedbackLabel = feedback.feedbackType === "feature" ? "Feature request" : "Problem report";
  const replyEmail = feedback.replyEmail?.trim();
  const text = [
    "New feedback from Pixl Sports",
    `Type: ${feedbackLabel}`,
    `Reply email: ${replyEmail || "Not provided"}`,
    "",
    "Message:",
    feedback.message.trim(),
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Pixl Sports Feedback <support@pixlsports.com>",
      to: ["support@pixlsports.com"],
      subject: `Pixl Sports feedback: ${feedbackLabel}`,
      text,
      ...(replyEmail ? { reply_to: replyEmail } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new EmailProviderRejectedError(response.status);
}

export function createSiteFeedbackRouter(dependencies: SiteFeedbackDependencies = {}) {
  const router: IRouter = Router();
  const sendEmail = dependencies.sendEmail ?? sendFeedbackWithResend;
  const now = dependencies.now ?? Date.now;
  const maxRequests = dependencies.maxRequests ?? 5;
  const windowMs = dependencies.windowMs ?? 10 * 60 * 1000;
  const attempts = new Map<string, RateLimitEntry>();

  router.post("/site-feedback", async (req, res): Promise<void> => {
    const parsed = SendSiteFeedbackBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a feedback message of 10 to 5000 characters." });
      return;
    }

    if (parsed.data.website?.trim()) {
      res.status(200).json(SendSiteFeedbackResponse.parse({ accepted: true }));
      return;
    }

    const message = parsed.data.message.trim();
    if (message.length < 10) {
      res.status(400).json({ error: "Enter a feedback message of at least 10 characters." });
      return;
    }

    const timestamp = now();
    const ip = req.ip || "unknown";
    const current = attempts.get(ip);
    if (current && current.resetAt > timestamp && current.count >= maxRequests) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((current.resetAt - timestamp) / 1000))));
      res.status(429).json({ error: "Please wait before sending more feedback." });
      return;
    }

    if (!current || current.resetAt <= timestamp) {
      attempts.set(ip, { count: 1, resetAt: timestamp + windowMs });
    } else {
      current.count += 1;
    }

    if (attempts.size > 1000) {
      for (const [key, entry] of attempts) {
        if (entry.resetAt <= timestamp) attempts.delete(key);
      }
    }

    const feedback: FeedbackMessage = {
      feedbackType: parsed.data.feedbackType,
      message,
      ...(parsed.data.replyEmail?.trim() ? { replyEmail: parsed.data.replyEmail.trim() } : {}),
    };

    try {
      await sendEmail(feedback);
      res.status(200).json(SendSiteFeedbackResponse.parse({ accepted: true }));
    } catch (error) {
      if (error instanceof EmailProviderNotConfiguredError) {
        req.log.error("Site feedback delivery is not configured.");
        res.status(503).json({ error: "Feedback email is not configured yet." });
        return;
      }

      req.log.error(
        {
          providerStatus: error instanceof EmailProviderRejectedError ? error.statusCode : undefined,
          err: error,
        },
        "Unable to deliver site feedback.",
      );
      res.status(502).json({ error: "Feedback could not be delivered right now. Please try again later." });
    }
  });

  return router;
}

export default createSiteFeedbackRouter();
