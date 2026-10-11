import React, { useState } from 'react';
import { healthCheck, sendSiteFeedback } from '@workspace/api-client-react';
import { Check, Clipboard, Send, ShieldCheck, Wifi } from 'lucide-react';

import {
  buildSupportDiagnosticReport,
  createSupportReference,
  EMPTY_SUPPORT_DIAGNOSTICS,
  getSupportIssue,
  getSupportReportShareActions,
  probeBrowserStorage,
  SUPPORT_ISSUES,
  type SupportDiagnostics,
  type SupportIssueId,
} from './support-center-model';

function diagnosticText(value: string) {
  switch (value) {
    case 'online':
      return 'Online';
    case 'offline':
      return 'Offline';
    case 'available':
      return 'Available';
    case 'unavailable':
      return 'Could not confirm';
    default:
      return 'Not checked';
  }
}

export function SupportCenter() {
  const [issueId, setIssueId] = useState<SupportIssueId>('account');
  const [diagnostics, setDiagnostics] = useState<SupportDiagnostics>(EMPTY_SUPPORT_DIAGNOSTICS);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<{ reference: string; text: string } | null>(null);
  const [shareConsent, setShareConsent] = useState(false);
  const [replyEmail, setReplyEmail] = useState('');
  const [replyEmailConsent, setReplyEmailConsent] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');

  const selectedIssue = getSupportIssue(issueId);
  const sharing = report ? getSupportReportShareActions(report.text, shareConsent) : null;

  const chooseIssue = (value: string) => {
    setIssueId(value as SupportIssueId);
    setReport(null);
    setShareConsent(false);
    setReplyEmail('');
    setReplyEmailConsent(false);
    setCopyMessage('');
    setSendMessage('');
  };

  const runChecks = async () => {
    setChecking(true);
    setCheckMessage('');
    setReport(null);
    setShareConsent(false);
    setReplyEmail('');
    setReplyEmailConsent(false);
    setCopyMessage('');
    setSendMessage('');

    const connection = navigator.onLine ? 'online' : 'offline';
    let browserStorage: SupportDiagnostics['browserStorage'] = 'unavailable';
    try {
      const probeId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : String(Date.now());
      browserStorage = probeBrowserStorage(window.localStorage, probeId) ? 'available' : 'unavailable';
    } catch {
      browserStorage = 'unavailable';
    }
    let service: SupportDiagnostics['service'] = 'not-run';

    if (connection === 'online') {
      try {
        const result = await healthCheck({ credentials: 'omit' });
        service = result.status === 'ok' ? 'available' : 'unavailable';
      } catch {
        service = 'unavailable';
      }
    } else {
      setCheckMessage('The service check was skipped because this browser reports that it is offline.');
    }

    setDiagnostics({ connection, browserStorage, service });
    setChecking(false);
  };

  const prepareReport = () => {
    const reference = createSupportReference();
    const text = buildSupportDiagnosticReport({
      reference,
      issueId,
      createdAt: new Date().toISOString(),
      diagnostics,
    });
    setReport({ reference, text });
    setShareConsent(false);
    setReplyEmail('');
    setReplyEmailConsent(false);
    setCopyMessage('');
    setSendMessage('');
  };

  const copyReport = async () => {
    if (!report || !sharing) return;
    try {
      await navigator.clipboard.writeText(sharing.copyText);
      setCopyMessage('Report copied. It has not been sent to Pixl Sports.');
    } catch {
      setCopyMessage('Copy is unavailable in this browser. Select the report text above to copy it manually.');
    }
  };

  const sendReport = async () => {
    if (!report || !sharing || sending) return;
    const includedReplyEmail = replyEmailConsent ? replyEmail.trim() : '';
    setSending(true);
    setSendMessage('');
    try {
      const result = await sendSiteFeedback(
        {
          feedbackType: 'problem',
          message: report.text,
          ...(includedReplyEmail ? { replyEmail: includedReplyEmail } : {}),
        },
        { credentials: 'omit' },
      );
      setSendMessage(result.accepted
        ? `Report sent to support@pixlsports.com. Keep reference ${report.reference} if you contact support again.`
        : 'The report was not accepted. You can copy it and send it another way.');
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? error.status
        : undefined;
      setSendMessage(status === 429
        ? 'Please wait a few minutes before trying to send again. You can still copy the report.'
        : 'The report could not be sent. You can copy it and send it another way.');
    } finally {
      setSending(false);
    }
  };

  const cancelReport = () => {
    setReport(null);
    setShareConsent(false);
    setReplyEmail('');
    setReplyEmailConsent(false);
    setCopyMessage('');
    setSendMessage('');
  };

  return (
    <section className="mt-14 border border-border bg-card p-5 shadow-sm sm:p-8" aria-labelledby="support-center-heading" data-testid="support-center">
      <div className="flex items-start gap-3">
        <div className="mt-1 grid h-10 w-10 shrink-0 place-items-center bg-primary/10 text-primary">
          <ShieldCheck aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[.16em] text-primary">Private troubleshooting</p>
          <h2 id="support-center-heading" className="mt-1 font-display text-3xl uppercase tracking-wide text-foreground">
            Get help without sharing your dashboard
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Choose what is going wrong and try guided steps first. Checks run only when you ask. No AI, dashboard records, account identifiers, messages, photos, or files are collected.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-foreground">What do you need help with?</span>
            <select
              value={issueId}
              onChange={(event) => chooseIssue(event.target.value)}
              className="min-h-11 w-full border border-border bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              data-testid="select-support-issue"
            >
              {SUPPORT_ISSUES.map((issue) => (
                <option key={issue.id} value={issue.id}>{issue.label}</option>
              ))}
            </select>
          </label>

          <div className="border-l-2 border-primary bg-muted/40 p-4">
            <h3 className="font-bold text-foreground">Try these steps</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground" data-testid="support-guidance">
              {selectedIssue.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>
        </div>

        <div className="border border-border bg-background p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-xl uppercase text-foreground">Quick checks</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Browser connection and storage are checked on this device. The service check sends only a basic health request; it includes no account or dashboard data.
              </p>
            </div>
            <Wifi className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3" aria-live="polite" data-testid="support-check-results">
            <div className="border border-border p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Connection</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{diagnosticText(diagnostics.connection)}</p>
            </div>
            <div className="border border-border p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Browser storage</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{diagnosticText(diagnostics.browserStorage)}</p>
            </div>
            <div className="border border-border p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pixl service</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{diagnosticText(diagnostics.service)}</p>
            </div>
          </div>
          {checkMessage && <p className="mt-3 text-xs text-muted-foreground" role="status">{checkMessage}</p>}
          <button
            type="button"
            onClick={() => void runChecks()}
            disabled={checking}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
            data-testid="button-run-support-checks"
          >
            <Wifi aria-hidden="true" className="h-4 w-4" />
            {checking ? 'Checking…' : 'Run quick checks'}
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-border pt-5">
        {!report ? (
          <button
            type="button"
            onClick={prepareReport}
            className="inline-flex min-h-11 items-center justify-center gap-2 border border-primary px-4 text-sm font-bold text-primary transition hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            data-testid="button-prepare-support-report"
          >
            Prepare optional report
          </button>
        ) : (
          <div className="space-y-4" data-testid="support-report">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-2xl uppercase text-foreground">Review before sharing</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Reference <span className="font-mono font-bold text-foreground">{report.reference}</span>
                </p>
              </div>
              <button type="button" onClick={cancelReport} className="min-h-10 px-3 text-sm font-semibold text-muted-foreground underline underline-offset-4" data-testid="button-cancel-support-report">
                Close report
              </button>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              This report contains only its reference, issue category, creation time, and the three quick-check results. It stays in this page’s memory until you close or reload it.
            </p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed text-foreground" data-testid="support-report-preview">
              {report.text}
            </pre>
            <div className="space-y-3 border border-border p-3">
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-foreground">Optional reply email</span>
                <span className="mb-2 block text-xs leading-relaxed text-muted-foreground">
                  Leave blank to omit a reply address. This is never filled from your account and is not part of the copied report.
                </span>
                <input
                  type="email"
                  autoComplete="off"
                  value={replyEmail}
                  onChange={(event) => {
                    setReplyEmail(event.target.value);
                    setReplyEmailConsent(false);
                    setSendMessage('');
                  }}
                  placeholder="you@example.com"
                  className="min-h-11 w-full border border-border bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  data-testid="input-support-reply-email"
                />
              </label>
              <p className="text-sm text-foreground" data-testid="preview-support-reply-email">
                Reply address for email: <span className="font-semibold">{replyEmail.trim() || 'Not provided'}</span>
              </p>
              {replyEmail.trim() && (
                <label className="flex cursor-pointer items-start gap-3 border border-border p-3 text-sm leading-relaxed text-foreground">
                  <input
                    type="checkbox"
                    checked={replyEmailConsent}
                    onChange={(event) => setReplyEmailConsent(event.target.checked)}
                    className="mt-1 h-4 w-4 accent-primary"
                    data-testid="checkbox-share-support-reply-email"
                  />
                  <span>I consent to sending this reply address to support with my report.</span>
                </label>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Pixl Sports does not save an in-app copy. If you choose Send, this report is emailed to support@pixlsports.com. The reply address is included only if you enter it and check its consent box. Sent email follows the support mailbox’s retention practices; this feature does not set or display a deletion date.
            </p>
            <label className="flex cursor-pointer items-start gap-3 border border-border p-3 text-sm leading-relaxed text-foreground">
              <input
                type="checkbox"
                checked={shareConsent}
                onChange={(event) => {
                  setShareConsent(event.target.checked);
                  setCopyMessage('');
                }}
                className="mt-1 h-4 w-4 accent-primary"
                data-testid="checkbox-share-support-report"
              />
              <span>I reviewed the report and choose to share it using one of the options below. Copying includes only the report text.</span>
            </label>
            {sharing && (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void sendReport()}
                  disabled={sending || sendMessage.startsWith('Report sent')}
                  aria-busy={sending}
                  className="inline-flex min-h-11 items-center justify-center gap-2 bg-primary px-4 text-sm font-bold text-primary-foreground hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  data-testid="button-send-support-report"
                >
                  <Send aria-hidden="true" className="h-4 w-4" />
                  {sending ? 'Sending…' : sendMessage.startsWith('Report sent') ? 'Sent to support' : 'Send report to support'}
                </button>
                <button
                  type="button"
                  onClick={() => void copyReport()}
                  className="inline-flex min-h-11 items-center justify-center gap-2 border border-border px-4 text-sm font-bold text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  data-testid="button-copy-support-report"
                >
                  {copyMessage.startsWith('Report copied') ? <Check aria-hidden="true" className="h-4 w-4" /> : <Clipboard aria-hidden="true" className="h-4 w-4" />}
                  Copy report
                </button>
              </div>
            )}
            {sendMessage && <p className="text-sm text-muted-foreground" role={sendMessage.startsWith('Report sent') ? 'status' : 'alert'} data-testid="status-send-support-report">{sendMessage}</p>}
            {copyMessage && <p className="text-sm text-muted-foreground" role="status" data-testid="status-copy-support-report">{copyMessage}</p>}
            <p className="text-xs text-muted-foreground">
              Sharing is optional. No AI processes this report. For more complex issues, you can review and share the redacted report separately with a support person.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
