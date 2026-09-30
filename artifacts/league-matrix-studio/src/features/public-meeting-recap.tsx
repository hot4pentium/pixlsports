import { Copy, Download, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import { useGetMeetingRecap } from '@workspace/api-client-react';

import { recapText } from './meeting-capture';
import { downloadMeetingRecapPdf } from './meeting-recap-pdf';
import type { MeetingContext, MeetingState } from './meeting-capture-model';
import { BackNavigationLink } from '@/components/back-navigation-link';

export function PublicMeetingRecapPage({ params }: { params: { shareToken?: string } }) {
  const shareToken = params.shareToken ?? '';
  const recap = useGetMeetingRecap(shareToken, {
    query: { enabled: Boolean(shareToken), queryKey: ['/api/meeting-recaps', shareToken], retry: false },
  });
  const [status, setStatus] = useState('');

  if (recap.isLoading) {
    return <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[#0b2039] px-5 text-sm font-bold uppercase tracking-widest text-[#f7c97a]" data-testid="status-public-meeting-recap"><BackNavigationLink href="/" label="Back to Pixl Sports" testId="link-back-public-home" variant="public" />Loading shared meeting recap…</div>;
  }
  if (recap.isError || !recap.data) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#0b2039] px-5 text-center text-[#f6f2e9]" data-testid="status-public-meeting-recap">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#f7c97a]">Shared meeting recap</p>
          <h1 className="mt-4 font-display text-5xl uppercase">Recap unavailable</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-[#aec5d3]">This link may have been revoked or is no longer available.</p>
          <BackNavigationLink href="/" label="Back to Pixl Sports" testId="link-back-public-home" variant="public" className="mx-auto mt-7" />
        </div>
      </main>
    );
  }

  const context = recap.data.workspace.context as MeetingContext;
  const state = recap.data.workspace as MeetingState;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recapText(context, state));
      setStatus('Recap copied.');
    } catch {
      setStatus('Copy was not available. Select the recap text manually.');
    }
  };
  const download = () => {
    try {
      downloadMeetingRecapPdf(context, state);
      setStatus('PDF downloaded.');
    } catch {
      setStatus('PDF could not be created on this device.');
    }
  };

  return (
    <div className="min-h-dvh bg-[#0b2039] text-[#f6f2e9]">
      <header className="border-b border-white/10 bg-[#102b4d]/90">
        <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
          <BackNavigationLink href="/" label="Back to Pixl Sports" testId="link-back-public-home" variant="public" className="mb-6" />
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#8fb9d8]"><LockKeyhole className="h-4 w-4 text-[#e8a45c]" /> Shared meeting recap · read-only</p>
          <h1 className="mt-4 font-display text-5xl uppercase leading-[0.86] sm:text-7xl" data-testid="text-public-meeting-title">{context.title}</h1>
          <p className="mt-5 text-sm text-[#aec5d3]" data-testid="text-public-meeting-ownership">A durable recap link shared by the meeting owner.</p>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
        <div className="border border-[#426481] bg-[#102b4d] shadow-[10px_10px_0_rgba(232,164,92,0.18)]">
          <pre className="whitespace-pre-wrap px-5 py-6 font-sans text-sm leading-7 text-[#edf2f1] sm:px-7 sm:py-8" data-testid="text-public-meeting-recap">{recapText(context, state)}</pre>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => void copy()} className="inline-flex min-h-11 items-center justify-center gap-2 bg-[#e8a45c] px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-[#18263a]" data-testid="button-copy-public-meeting-recap"><Copy className="h-4 w-4" /> Copy recap</button>
          <button type="button" onClick={download} className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#e8a45c] px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-[#f7c97a]" data-testid="button-download-public-meeting-recap"><Download className="h-4 w-4" /> Download PDF</button>
        </div>
        <p className="mt-4 min-h-6 text-sm text-[#f7c97a]" aria-live="polite" data-testid="status-public-meeting-actions">{status}</p>
      </main>
    </div>
  );
}
