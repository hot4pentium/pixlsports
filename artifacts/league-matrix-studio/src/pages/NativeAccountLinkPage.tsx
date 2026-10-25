import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { SignIn, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetWebNativeAccountLinkQueryKey,
  useDecideWebNativeAccountLink,
  useDisconnectWebNativeAccountLink,
  useGetWebNativeAccountLink,
  usePreviewWebNativeAccountLink,
  type NativeLinkState,
} from '@workspace/api-client-react';

const intent = { request: { headers: { 'X-PIXL-Link-Intent': '1' } } };

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16);
}
function codeLength(value: string) {
  return value.replace(/-/g, '').length;
}
function errMessage(e: unknown, fallback: string) {
  const d = (e as { data?: { error?: string }; message?: string } | null);
  return d?.data?.error || fallback;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-2xl px-5 py-10 sm:py-16" data-testid="native-link-page">
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">PIXL Sports for iPhone</p>
      <h1 className="mt-2 font-display text-4xl uppercase tracking-wide sm:text-5xl">Connect your iPhone</h1>
      {children}
      <nav className="mt-10 flex flex-wrap gap-5 border-t border-border pt-5 text-sm font-bold" aria-label="Account navigation">
        <Link href="/studio/profile" className="text-primary underline" data-testid="link-profile">Back to profile</Link>
        <Link href="/studio" className="text-primary underline" data-testid="link-studio">Go to studio</Link>
      </nav>
    </main>
  );
}

export default function NativeAccountLinkPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  if (!isLoaded) {
    return <main className="mx-auto min-h-[100dvh] max-w-2xl px-5 py-16" aria-busy="true"><div className="h-10 w-2/3 animate-pulse bg-muted" /><div className="mt-6 h-40 animate-pulse bg-muted" /></main>;
  }
  if (!isSignedIn || !user) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col items-center px-5 py-12" data-testid="native-link-signin">
        <h1 className="font-display text-4xl uppercase tracking-wide">Sign in to connect your iPhone</h1>
        <p className="mb-8 mt-3 max-w-md text-center text-sm text-muted-foreground">Sign in to the web account you want your iPhone to use.</p>
        <SignIn routing="hash" signUpUrl={undefined} fallbackRedirectUrl={window.location.pathname} forceRedirectUrl={window.location.pathname} oidcPrompt="select_account" />
      </main>
    );
  }
  return <NativeAccountLinkSignedIn key={user.id} userId={user.id} email={user.primaryEmailAddress?.emailAddress ?? 'No primary email available'} name={user.fullName || ''} />;
}

export function NativeAccountLinkSignedIn({ userId, email, name }: { userId: string; email: string; name: string }) {
  const qc = useQueryClient();
  const key = [...getGetWebNativeAccountLinkQueryKey(), userId];
  const state = useGetWebNativeAccountLink({ query: { enabled: !!userId, queryKey: key, refetchInterval: 5000 }, ...intent });
  const preview = usePreviewWebNativeAccountLink(intent);
  const decide = useDecideWebNativeAccountLink(intent);
  const disconnect = useDisconnectWebNativeAccountLink(intent);

  const [code, setCode] = useState('');
  const [reviewed, setReviewed] = useState<{ code: string; state: NativeLinkState } | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const busy = useRef(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!reviewed) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [reviewed]);

  useEffect(() => {
    setCode(''); setReviewed(null); setError(''); setResult(''); setConfirmDisconnect(false);
  }, [userId]);

  const current = state.data;
  const linked = current?.status === 'linked' || current?.status === 'completed';
  const approvedPending = !linked && current?.status === 'approved';
  const ready = codeLength(code) === 8;
  const expired = reviewed?.state.expiresAt ? new Date(reviewed.state.expiresAt).getTime() <= now : false;

  const onPreview = () => {
    if (!ready || busy.current) return;
    busy.current = true; setError(''); setResult('');
    preview.mutate({ data: { userCode: code } }, {
      onSuccess: (s) => {
        if ((s.status === 'pending' || s.status === 'approved') && s.requestId) { setNow(Date.now()); setReviewed({ code, state: s }); }
        else { setReviewed(null); setError(`This code cannot be used (${s.status}). Start again in the iPhone app.`); }
      },
      onError: (e) => { setReviewed(null); setError(errMessage(e, 'We could not check that code. Try again.')); },
      onSettled: () => { busy.current = false; },
    });
  };

  const onDecide = (decision: 'approve' | 'deny') => {
    if (!reviewed?.state.requestId || busy.current) return;
    busy.current = true; setError('');
    decide.mutate({ data: { requestId: reviewed.state.requestId, userCode: reviewed.code, decision } }, {
      onSuccess: () => {
        setResult(decision === 'approve'
          ? 'Approved. Your iPhone is not connected yet. Confirm on the iPhone to finish.'
          : 'Request denied. Nothing was connected.');
        setReviewed(null); setCode('');
        void qc.invalidateQueries({ queryKey: key });
      },
      onError: (e) => setError(errMessage(e, 'We could not record your decision. Try again.')),
      onSettled: () => { busy.current = false; },
    });
  };

  const onDisconnect = () => {
    if (busy.current) return;
    busy.current = true; setError('');
    disconnect.mutate(undefined, {
      onSuccess: () => {
        setConfirmDisconnect(false); setResult('iPhone disconnected. Your web account was not deleted.');
        void qc.invalidateQueries({ queryKey: key });
      },
      onError: (e) => setError(errMessage(e, 'We could not disconnect. Try again.')),
      onSettled: () => { busy.current = false; },
    });
  };

  const pending = preview.isPending || decide.isPending || disconnect.isPending;

  return (
    <Shell>
      <section className="mt-6 border-l-4 border-primary bg-muted/40 p-5" aria-labelledby="nl-account" data-testid="native-link-account">
        <p id="nl-account" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Web account you are signed in to</p>
        {name && <p className="mt-2 text-lg font-bold">{name}</p>}
        <p className="break-all text-sm font-semibold" data-testid="text-account-email">{email}</p>
      </section>

      <div role="status" aria-live="polite" className="mt-4 min-h-6 text-sm font-semibold" data-testid="status-message">{result}</div>
      {error && <div role="alert" className="mt-2 border-l-4 border-destructive bg-destructive/5 p-4 text-sm" data-testid="error-message">{error}</div>}

      {state.isLoading && <div className="mt-6 h-32 animate-pulse bg-muted" aria-busy="true" data-testid="loading-state" />}
      {state.isError && (
        <div role="alert" className="mt-6 border-l-4 border-destructive bg-destructive/5 p-4 text-sm" data-testid="state-error">
          <p>{errMessage(state.error, 'We could not load your iPhone connection.')}</p>
          <button type="button" onClick={() => void state.refetch()} className="mt-3 font-bold text-primary underline" data-testid="button-retry">Retry</button>
        </div>
      )}

      {(linked || approvedPending) && (
        <section className="mt-6" aria-labelledby="nl-linked" data-testid="native-link-linked">
          <h2 id="nl-linked" className="font-display text-3xl uppercase tracking-wide">{approvedPending ? 'Waiting for iPhone confirmation' : 'iPhone connected'}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{approvedPending
            ? 'You approved this request, but the iPhone must still confirm. You can withdraw approval now.'
            : `${current?.accountLabel ?? 'An iPhone account'} is connected. Disconnecting removes this link, not the separate iPhone sign-in.`} Neither account is deleted.</p>
          {!confirmDisconnect ? (
            <button type="button" onClick={() => setConfirmDisconnect(true)} className="mt-4 min-h-11 border border-foreground px-5 py-3 text-xs font-bold uppercase tracking-widest" data-testid="button-disconnect">{approvedPending ? 'Withdraw approval' : 'Disconnect iPhone'}</button>
          ) : (
            <div className="mt-4 border-l-4 border-destructive bg-destructive/5 p-4" role="alertdialog" aria-label="Confirm disconnect" data-testid="disconnect-confirm">
              <p className="text-sm font-bold">{approvedPending ? 'Withdraw this approval?' : 'Disconnect this iPhone?'}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" disabled={pending} onClick={onDisconnect} className="min-h-11 bg-destructive px-5 py-3 text-xs font-bold uppercase tracking-widest text-destructive-foreground disabled:opacity-50" data-testid="button-confirm-disconnect">{disconnect.isPending ? 'Disconnecting…' : 'Yes, disconnect'}</button>
                <button type="button" disabled={pending} onClick={() => setConfirmDisconnect(false)} className="min-h-11 border border-border px-5 py-3 text-xs font-bold uppercase tracking-widest" data-testid="button-keep">Keep connected</button>
              </div>
            </div>
          )}
        </section>
      )}

      {!linked && !approvedPending && !state.isLoading && (
        <section className="mt-6" aria-labelledby="nl-code" data-testid="native-link-connect">
          <h2 id="nl-code" className="font-display text-3xl uppercase tracking-wide">Enter the code from your iPhone</h2>
          <p className="mt-2 border-l-4 border-destructive bg-destructive/5 p-3 text-sm" data-testid="text-warning">
            Only enter a code you typed from your own PIXL Sports app. Never enter a code someone else sends you. It would give them access to your account.
          </p>
          {current && ['approved'].includes(current.status) && <p className="mt-3 text-sm font-semibold">Approved. Waiting for confirmation on your iPhone.</p>}
          {current && ['expired', 'denied', 'cancelled'].includes(current.status) && <p className="mt-3 text-sm text-muted-foreground">The last request was {current.status}. Start a new one in the iPhone app.</p>}

          <form className="mt-5" onSubmit={(e) => { e.preventDefault(); onPreview(); }}>
            <label htmlFor="native-code" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Code from the app</label>
            <input
              id="native-code" value={code} disabled={pending} autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text"
              onChange={(e) => { setCode(normalizeCode(e.target.value)); setReviewed(null); setError(''); setResult(''); }}
              className="mt-2 block w-full border border-border bg-background px-4 py-3 font-mono text-2xl uppercase tracking-[0.3em]"
              data-testid="input-code"
            />
            <button type="submit" disabled={!ready || pending} className="mt-4 min-h-11 bg-primary px-6 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-50" data-testid="button-review">{preview.isPending ? 'Checking…' : 'Review request'}</button>
          </form>

          {reviewed && (
            <div className="mt-6 border border-foreground p-5" data-testid="review-panel">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Reviewing request</p>
              <p className="mt-2 font-mono text-3xl tracking-[0.25em]" data-testid="text-reviewed-code">{reviewed.code}</p>
              {reviewed.state.expiresAt && <p className="mt-2 text-sm" data-testid="text-expiry">{expired ? 'This request has expired.' : `Expires ${new Date(reviewed.state.expiresAt).toLocaleTimeString()}`}</p>}
              <p className="mt-3 text-sm">Approve to let the iPhone app use <strong className="break-all">{email}</strong>. You will still confirm on the iPhone before anything connects.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" disabled={pending || expired} onClick={() => onDecide('approve')} className="min-h-11 bg-primary px-6 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-50" data-testid="button-approve">{decide.isPending ? 'Saving…' : 'Approve'}</button>
                <button type="button" disabled={pending} onClick={() => onDecide('deny')} className="min-h-11 border border-foreground px-6 py-3 text-xs font-bold uppercase tracking-widest disabled:opacity-50" data-testid="button-deny">Deny</button>
              </div>
            </div>
          )}
        </section>
      )}
    </Shell>
  );
}
