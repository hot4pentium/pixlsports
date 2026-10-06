import { zodResolver } from "@hookform/resolvers/zod";
import { useSendSiteFeedback } from "@workspace/api-client-react";
import { CheckCircle2, LoaderCircle, MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const feedbackFormSchema = z.object({
  feedbackType: z.enum(["feature", "problem"]),
  message: z.string().trim().min(10, "Please add at least 10 characters.").max(5000),
  replyEmail: z.union([
    z.literal(""),
    z.string().trim().email("Enter a valid email address.").max(320),
  ]),
  website: z.string().max(200),
});

type FeedbackFormValues = z.infer<typeof feedbackFormSchema>;

export function SiteFeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const sendFeedback = useSendSiteFeedback();
  const form = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackFormSchema),
    defaultValues: {
      feedbackType: "problem",
      message: "",
      replyEmail: "",
      website: "",
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setSubmitError("");
    try {
      await sendFeedback.mutateAsync({
        data: {
          feedbackType: values.feedbackType,
          message: values.message.trim(),
          ...(values.replyEmail.trim() ? { replyEmail: values.replyEmail.trim() } : {}),
          website: values.website,
        },
      });
      setSent(true);
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? error.status
        : undefined;
      setSubmitError(status === 429
        ? "Please wait a few minutes before sending more feedback."
        : "We couldn’t send that yet. Try again, or email support@pixlsports.com.");
    }
  });

  const startAnother = () => {
    form.reset();
    setSent(false);
    setSubmitError("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Send feedback"
          data-testid="button-open-site-feedback"
          className="fixed right-4 z-50 inline-flex min-h-12 items-center gap-2 rounded-full border border-white/20 bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_8px_28px_rgba(0,0,0,0.32)] transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:right-6"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
        >
          <MessageCircle aria-hidden="true" className="h-4 w-4" />
          Feedback
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto border-white/15 bg-[#0B1F3A] p-5 text-white sm:p-6"
        data-testid="dialog-site-feedback"
      >
        {sent ? (
          <div className="space-y-5 pr-5">
            <DialogHeader className="text-left">
              <DialogTitle className="flex items-center gap-2 font-display text-2xl">
                <CheckCircle2 aria-hidden="true" className="h-6 w-6 text-primary" />
                Thanks for the feedback.
              </DialogTitle>
              <DialogDescription className="text-white/70" data-testid="text-site-feedback-success">
                Your message was sent to support@pixlsports.com.
              </DialogDescription>
            </DialogHeader>
            <button
              type="button"
              onClick={startAnother}
              className="min-h-11 w-full bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              data-testid="button-send-another-feedback"
            >
              Send another
            </button>
          </div>
        ) : (
          <div className="space-y-5 pr-5">
            <DialogHeader className="text-left">
              <DialogTitle className="font-display text-2xl">Send feedback</DialogTitle>
              <DialogDescription className="text-white/70">
                Share a feature idea or report a problem. Your message goes directly to Pixl Sports support.
              </DialogDescription>
            </DialogHeader>

            <Form {...form}>
              <form onSubmit={submit} noValidate className="space-y-4" data-testid="form-site-feedback">
                <div
                  aria-hidden="true"
                  className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
                >
                  <input
                    {...form.register("website")}
                    autoComplete="off"
                    tabIndex={-1}
                    data-testid="input-feedback-website"
                  />
                </div>

                <FormField
                  control={form.control}
                  name="feedbackType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold text-white">What is this about?</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          data-testid="select-feedback-type"
                          className="min-h-11 w-full border border-white/20 bg-[#102B4D] px-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <option value="problem">Report a problem</option>
                          <option value="feature">Request a feature</option>
                        </select>
                      </FormControl>
                      <FormMessage className="text-red-200" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold text-white">Your message</FormLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          rows={5}
                          maxLength={5000}
                          placeholder="Tell us what you’d like to see or what went wrong."
                          data-testid="textarea-feedback-message"
                          className="min-h-32 w-full resize-y border border-white/20 bg-[#102B4D] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/45 focus-visible:ring-2 focus-visible:ring-primary"
                        />
                      </FormControl>
                      <FormDescription className="text-xs text-white/55">
                        10–5000 characters. Don’t include passwords or sensitive account details.
                      </FormDescription>
                      <FormMessage className="text-red-200" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="replyEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold text-white">Email for a reply (optional)</FormLabel>
                      <FormControl>
                        <input
                          {...field}
                          type="email"
                          maxLength={320}
                          autoComplete="email"
                          placeholder="you@example.com"
                          data-testid="input-feedback-reply-email"
                          className="min-h-11 w-full border border-white/20 bg-[#102B4D] px-3 text-sm text-white outline-none placeholder:text-white/45 focus-visible:ring-2 focus-visible:ring-primary"
                        />
                      </FormControl>
                      <FormDescription className="text-xs text-white/55">
                        We’ll use this only if we need to reply.
                      </FormDescription>
                      <FormMessage className="text-red-200" />
                    </FormItem>
                  )}
                />

                {submitError && (
                  <p role="alert" className="text-sm text-red-200" data-testid="status-site-feedback-error">
                    {submitError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={sendFeedback.isPending}
                  aria-busy={sendFeedback.isPending}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
                  data-testid="button-submit-site-feedback"
                >
                  {sendFeedback.isPending ? (
                    <>
                      <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send aria-hidden="true" className="h-4 w-4" />
                      Send to support
                    </>
                  )}
                </button>
              </form>
            </Form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
