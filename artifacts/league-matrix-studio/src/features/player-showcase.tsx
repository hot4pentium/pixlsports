import { ArrowRight, Check, Copy, ExternalLink, ShieldCheck, Zap } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BackNavigationLink } from '@/components/back-navigation-link';
import {
  getListAthleteInvitesQueryKey,
  useListAthleteInvites,
  useGetAthleteEditorAccess,
  useAcceptAthleteEditorAccess,
  getGetAthleteEditorAccessQueryKey,
  getGetAthleteFanCardQueryKey,
  useGetAthleteFanCard,
  useUpdateAthleteEditorFavoriteMoment,
  type OwnedAthleteInvite,
  type PublicAthleteFanCard,
} from '@workspace/api-client-react';
import type { SupporterProfile } from './supporter-dashboard';
import { AthleteEditorInvitationPanel } from './athlete-invite';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import { FanCardAppearanceManager } from './fan-card-appearance-manager';
import { getShowcaseInvite, getShowcaseInviteCandidates } from './player-showcase-model';
import './player-showcase.css';

export interface PlayerShowcaseContentProps {
  profile: SupporterProfile;
  linkedCard?: PublicAthleteFanCard | null;
  cardStatus?: 'loading' | 'ready' | 'unavailable' | 'not-linked' | 'not-shared' | 'ambiguous';
  cardEditHref?: string;
  cardPublicHref?: string;
  cardCandidates?: readonly OwnedAthleteInvite[];
  selectedCardToken?: string;
  onSelectCard?: (inviteToken: string) => void;
  onRetryCard?: () => void;
}

function sportLabel(sport: string | null) {
  return sport ? sport.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Sport';
}

export function PlayerShowcaseContent({ profile, linkedCard, cardStatus = 'not-linked', cardEditHref = '/studio/hype-card', cardPublicHref, cardCandidates = [], selectedCardToken, onSelectCard, onRetryCard }: PlayerShowcaseContentProps) {
  const card = cardStatus === 'ready' ? linkedCard ?? null : null;
  const cardPicker = cardCandidates.length > 1 && onSelectCard ? (
    <label className="ps__card-picker">
      <span>Choose the HYPE Card</span>
      <select
        aria-label={`Choose a HYPE Card for ${profile.athleteName}`}
        value={selectedCardToken ?? ''}
        onChange={(event) => onSelectCard(event.currentTarget.value)}
        data-testid="select-showcase-card"
      >
        <option value="" disabled>Select a HYPE Card</option>
        {cardCandidates.map((candidate) => (
          <option key={candidate.inviteToken} value={candidate.inviteToken}>
            {sportLabel(candidate.sport)} · {candidate.seasonName?.trim() || 'Season not set'}
          </option>
        ))}
      </select>
    </label>
  ) : null;

  return (
    <div className="ps" data-testid="page-player-showcase">
      <section className="ps__stage-wrap ps__stage-wrap--card-only" aria-labelledby="ps-dyn" data-testid="section-dynamic-showcase">
        <h1 id="ps-dyn" className="ps__section-title"><span>Showcase</span></h1>
        <p className="ps__card-only-intro">One athlete. One season. Your HYPE Card.</p>
        <div className="ps__card-only" role="region" aria-label={`${profile.athleteName || 'Athlete'} HYPE Card Showcase`}>
          {cardPicker}
          {card ? (
            <div className="ps__card-only-panel" data-testid="showcase-hype-card-preview">
              <div className="ps__card-only-heading">
                <div>
                  <p className="ps__card-only-kicker">HYPE Card</p>
                  <p className="ps__card-only-team">{card.teamName || sportLabel(card.sport)}</p>
                </div>
                <div className="ps__card-links">
                  <Link href={cardEditHref} className="ps__link ps__link--primary" data-testid="link-showcase-card-edit">
                    <Zap size={16} aria-hidden="true" /> Edit HYPE Card
                  </Link>
                  {cardPublicHref && <Link href={cardPublicHref} className="ps__link ps__link--secondary" data-testid="link-showcase-card-public">
                    <ExternalLink size={16} aria-hidden="true" /> Open public card
                  </Link>}
                </div>
              </div>
              <div className="ps__card-only-art" aria-label={`${card.athleteName} HYPE Card preview`} data-testid="showcase-card-art">
                <LivingAthleteCardFront athleteName={card.athleteName} teamName={card.teamName} photoUrl={card.photoUrl} appearance={card.cardAppearance} sport={card.sport} cutoutUrl={card.cutoutUrl} />
              </div>
            </div>
          ) : (
            <div className="ps__card-unavailable" role="status" data-testid="status-showcase-card-unavailable">
              <Zap size={24} aria-hidden="true" />
              <strong>
                {cardStatus === 'loading' ? 'Loading the saved card…'
                  : cardStatus === 'unavailable' ? 'HYPE Card unavailable'
                    : cardStatus === 'ambiguous' ? 'Choose a HYPE Card'
                      : cardStatus === 'not-linked' ? 'No HYPE Card linked'
                        : cardStatus === 'not-shared' ? 'HYPE Card not shared'
                          : 'HYPE Card unavailable'}
              </strong>
              <span>
                {cardStatus === 'loading' ? 'The saved HYPE Card is on its way.'
                  : cardStatus === 'not-linked' ? 'There is no HYPE Card linked to this athlete yet.'
                    : cardStatus === 'ambiguous' ? 'Several cards match this athlete and team. Compare sport and season, then choose the one for this Showcase.'
                      : cardStatus === 'unavailable' ? 'The linked HYPE Card could not be loaded.'
                        : 'Card details stay private until sharing is active.'}
              </span>
              {(cardStatus === 'ambiguous' || (cardStatus === 'unavailable' && cardCandidates.length > 1)) && cardPicker}
              {cardStatus === 'unavailable' && onRetryCard && <button type="button" onClick={onRetryCard} className="ps__link" data-testid="button-showcase-card-retry">Try again</button>}
              {cardStatus !== 'ambiguous' && <Link href={cardEditHref} className="ps__link" data-testid="link-showcase-card-edit-unavailable">
                {cardStatus === 'not-linked' ? 'Create HYPE Card' : 'Open HYPE Card'}
                <ArrowRight size={15} aria-hidden="true" />
              </Link>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function PlayerShowcasePage({ profile, userId }: { profile: SupporterProfile; userId: string | null }) {
  const [shareStatus, setShareStatus] = useState('');
  const [selectedInviteToken, setSelectedInviteToken] = useState<string | null>(null);
  const invitesQuery = useListAthleteInvites({
    query: {
      enabled: Boolean(userId),
      queryKey: [...getListAthleteInvitesQueryKey(), userId ?? null],
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      retry: false,
    },
  });
  const inviteCandidates = getShowcaseInviteCandidates(invitesQuery.data ?? [], profile);
  const automaticallyMatchedInvite = getShowcaseInvite(invitesQuery.data ?? [], profile);
  const selectedInvite = selectedInviteToken
    ? inviteCandidates.find((invite) => invite.inviteToken === selectedInviteToken) ?? null
    : null;
  const matchedInvite = automaticallyMatchedInvite ?? selectedInvite;
  const hasAmbiguousInvite = !automaticallyMatchedInvite && inviteCandidates.length > 1;
  const cardEnabled = Boolean(matchedInvite && matchedInvite.showHypeCard && !matchedInvite.paused);
  const fanCardQuery = useGetAthleteFanCard(matchedInvite?.inviteToken ?? '', {
    query: {
      enabled: cardEnabled,
      queryKey: getGetAthleteFanCardQueryKey(matchedInvite?.inviteToken ?? ''),
      retry: false,
      refetchOnWindowFocus: true,
    },
  });
  const inviteToken = matchedInvite?.inviteToken;
  const linkedCard = fanCardQuery.data
    && fanCardQuery.data.inviteToken === inviteToken
    && fanCardQuery.data.athleteName.trim().toLocaleLowerCase() === profile.athleteName.trim().toLocaleLowerCase()
    && fanCardQuery.data.teamName.trim().toLocaleLowerCase() === profile.teamName.trim().toLocaleLowerCase()
    && fanCardQuery.data.sport === matchedInvite?.sport
    ? fanCardQuery.data
    : null;
  const cardStatus: PlayerShowcaseContentProps['cardStatus'] = invitesQuery.isLoading
    ? 'loading'
    : invitesQuery.isError ? 'unavailable'
    : !matchedInvite ? hasAmbiguousInvite ? 'ambiguous' : 'not-linked'
    : !matchedInvite.showHypeCard || matchedInvite.paused
      ? 'not-shared'
    : fanCardQuery.isLoading ? 'loading' : linkedCard ? 'ready' : 'unavailable';
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const publicShowcaseUrl = inviteToken
    ? `${window.location.origin}${basePath}/showcase/${encodeURIComponent(inviteToken)}`
    : null;
  const cardSettingsHref = matchedInvite
    ? `/player/${encodeURIComponent(matchedInvite.inviteToken)}/manage#design`
    : '/studio/athlete-page';
  const copyShowcaseUrl = async () => {
    if (!publicShowcaseUrl) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(publicShowcaseUrl);
      setShareStatus('Showcase link copied.');
    } catch {
      setShareStatus('Could not copy the link. Open the showcase and copy its address.');
    }
  };
  return (
    <>
      <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-8">
        <BackNavigationLink
          href="/studio"
          label="Back to Supporter Hub"
          testId="link-back-supporter-dashboard"
        />
      </div>
      <PlayerShowcaseContent profile={profile} linkedCard={linkedCard} cardStatus={cardStatus}
        cardCandidates={hasAmbiguousInvite ? inviteCandidates : undefined}
        selectedCardToken={selectedInvite?.inviteToken}
        onSelectCard={setSelectedInviteToken}
        onRetryCard={() => {
          if (fanCardQuery.isError) void fanCardQuery.refetch();
          else void invitesQuery.refetch();
        }}
        cardEditHref={cardSettingsHref}
        cardPublicHref={inviteToken ? `/fan/${encodeURIComponent(inviteToken)}?from=player-showcase` : undefined} />
      <div className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-8">
        {publicShowcaseUrl && (
          <section className="mb-5 flex flex-col gap-4 border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="share-showcase-title" data-testid="panel-share-public-showcase">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Public recipient view</p>
              <h2 id="share-showcase-title" className="mt-2 font-display text-2xl uppercase">Share the Showcase</h2>
              <p className="mt-1 text-sm text-muted-foreground">Recipients open the HYPE Card and its currently published faces.</p>
              <a href={publicShowcaseUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex max-w-full items-center gap-2 break-all text-xs font-semibold text-primary underline underline-offset-4" data-testid="link-public-showcase-url">
                {publicShowcaseUrl}<ExternalLink size={13} aria-hidden="true" />
              </a>
              {shareStatus && <p className="mt-2 text-xs" role="status" data-testid="status-public-showcase-share">{shareStatus}</p>}
            </div>
            <button type="button" onClick={() => void copyShowcaseUrl()} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 bg-primary px-4 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary/90" data-testid="button-copy-public-showcase">
              {shareStatus === 'Showcase link copied.' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {shareStatus === 'Showcase link copied.' ? 'Copied' : 'Copy link'}
            </button>
          </section>
        )}
        <AthleteEditorInvitationPanel inviteToken={inviteToken ?? null} />
      </div>
    </>
  );
}

export function AthleteShowcaseHome() {
  const acceptInvitation = useAcceptAthleteEditorAccess();
  const [acceptError, setAcceptError] = useState('');
  const accessQuery = useGetAthleteEditorAccess({
    query: {
      queryKey: getGetAthleteEditorAccessQueryKey(),
      refetchOnMount: 'always',
      staleTime: 0,
      retry: false,
      refetchInterval: 30_000,
    },
  });
  const access = accessQuery.data;
  if (accessQuery.isLoading) {
    return <AthleteStudioShell><main className="grid min-h-[70dvh] place-items-center px-5"><div className="w-full max-w-xl space-y-4"><div className="h-4 w-28 animate-pulse bg-primary/20" /><div className="h-14 w-3/4 animate-pulse bg-muted" /><div className="h-36 animate-pulse bg-muted" /></div></main></AthleteStudioShell>;
  }
  if (!accessQuery.isError && access?.status === 'pending') {
    return (
      <AthleteStudioShell><main className="mx-auto w-full max-w-3xl px-5 py-12">
        <section className="border border-border bg-card p-7" data-testid="card-editor-acceptance">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">HYPE Card invitation</p>
          <h1 className="mt-4 font-display text-4xl uppercase">Edit {access.athleteName}’s HYPE Card</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Accept to edit this card’s design and favorite-moment note. Your existing account and permissions will stay unchanged. The owner keeps control of publishing, privacy, sharing, and account settings.</p>
          <button type="button" disabled={acceptInvitation.isPending} onClick={async () => {
            setAcceptError('');
            try {
              await acceptInvitation.mutateAsync();
              await accessQuery.refetch();
            } catch {
              setAcceptError('The invitation could not be accepted. It may have been revoked. Refresh and try again.');
            }
          }} className="mt-6 min-h-11 bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-50" data-testid="button-accept-card-invitation">
            {acceptInvitation.isPending ? 'Accepting…' : 'Accept invitation'}
          </button>
          {acceptError && <p role="alert" className="mt-4 text-sm">{acceptError}</p>}
          <Link href="/studio" className="ml-5 inline-flex min-h-11 items-center text-sm underline">Back to my account</Link>
        </section>
      </main></AthleteStudioShell>
    );
  }
  if (accessQuery.isError || !access) {
    return (
      <AthleteStudioShell><main className="mx-auto grid min-h-[70dvh] w-full max-w-3xl place-items-center px-5 py-12">
        <section className="w-full border-l-4 border-primary bg-card p-7 sm:p-10" role="alert">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Athlete design access</p>
          <h1 className="mt-4 font-display text-4xl uppercase sm:text-6xl">This invite is unavailable.</h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">Ask your parent or guardian to confirm the invitation is active and sent to the email you use to sign in.</p>
          <button type="button" onClick={() => void accessQuery.refetch()} className="mt-6 inline-flex min-h-11 items-center gap-2 bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground">Try again <ArrowRight className="h-4 w-4" /></button>
        </section>
      </main></AthleteStudioShell>
    );
  }
  const profile: SupporterProfile = {
    athleteName: access.athleteName, teamName: access.teamName, seasonName: access.seasonName,
    jerseyNumber: access.jerseyNumber, sport: access.sport, displayName: access.athleteName,
    position: access.position, relationship: 'parent', accessMode: 'full',
  } as SupporterProfile;
  return (
    <AthleteStudioShell><main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8" data-testid="athlete-showcase-home">
      <AthleteShowcaseBody profile={profile} projectId={access.projectId} inviteToken={access.inviteToken} existingAccount={access.existingAccount} />
      {access.existingAccount && <Link href="/studio" className="mt-4 inline-flex min-h-11 items-center text-sm font-bold underline">Back to my account</Link>}
      <AthleteFavoriteMomentEditor inviteToken={access.inviteToken} initialValue={access.favoriteMoment} />
      <section className="mt-4 border border-border bg-primary/5 p-5 sm:p-7">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h2 className="mt-3 font-display text-2xl uppercase">A parent stays in control</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">You can edit your linked HYPE Card and add a favorite-moment note. Your parent or guardian controls the card’s visibility, publishing, privacy, and sharing.</p>
      </section>
    </main></AthleteStudioShell>
  );
}

function AthleteShowcaseBody({ profile, projectId, inviteToken, existingAccount = false }: {
  profile: SupporterProfile;
  projectId: string | null;
  inviteToken: string;
  existingAccount?: boolean;
}) {
  const cardQuery = useGetAthleteFanCard(inviteToken, {
    query: {
      enabled: !projectId,
      queryKey: getGetAthleteFanCardQueryKey(inviteToken),
      retry: false,
      refetchOnWindowFocus: true,
    },
  });
  const linkedCard = !projectId && cardQuery.data?.inviteToken === inviteToken ? cardQuery.data : null;
  const cardStatus: PlayerShowcaseContentProps['cardStatus'] = projectId
    ? 'not-linked'
    : cardQuery.isLoading ? 'loading'
      : cardQuery.isError || !linkedCard ? 'unavailable' : 'ready';
  const cardEditHref = projectId
    ? `/studio/player-showcase/hype-card/${encodeURIComponent(projectId)}`
    : existingAccount
      ? '/card-editor/design'
      : '/studio/player-showcase/hype-card';
  return (
    <PlayerShowcaseContent
      profile={profile}
      linkedCard={linkedCard} cardStatus={cardStatus}
      cardEditHref={cardEditHref}
      cardPublicHref={!projectId ? `/fan/${encodeURIComponent(inviteToken)}` : undefined}
    />
  );
}

function AthleteFavoriteMomentEditor({ inviteToken, initialValue }: {
  inviteToken: string;
  initialValue: string | null;
}) {
  const queryClient = useQueryClient();
  const saveMoment = useUpdateAthleteEditorFavoriteMoment();
  const [draft, setDraft] = useState(initialValue ?? '');
  const [notice, setNotice] = useState('');
  useEffect(() => setDraft(initialValue ?? ''), [initialValue]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    try {
      const saved = await saveMoment.mutateAsync({ data: { favoriteMoment: draft.trim() } });
      setDraft(saved.favoriteMoment ?? '');
      setNotice('Favorite moment saved.');
      await queryClient.invalidateQueries({ queryKey: getGetAthleteEditorAccessQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetAthleteFanCardQueryKey(inviteToken) });
    } catch {
      setNotice('Your favorite moment could not be saved. Try again.');
    }
  };

  return (
    <section className="mt-5 border border-border bg-card p-5 sm:p-7" aria-labelledby="favorite-moment-title" data-testid="athlete-favorite-moment-editor">
      <div className="max-w-2xl">
        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Your HYPE Card</p>
        <h2 id="favorite-moment-title" className="mt-2 font-display text-3xl uppercase">Favorite moment</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Share one short moment you are proud of. Your parent or guardian controls whether the card is visible.</p>
      </div>
      <form onSubmit={(event) => void save(event)} className="mt-5 grid max-w-3xl gap-3">
        <label htmlFor="favorite-moment-input" className="text-xs font-bold uppercase tracking-wider">Your note <span className="font-normal normal-case tracking-normal">(optional)</span></label>
        <textarea
          id="favorite-moment-input"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          maxLength={160}
          rows={3}
          placeholder="A moment from this season I’m proud of…"
          className="min-h-24 resize-y border border-border bg-background px-3 py-3 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary"
          data-testid="input-athlete-favorite-moment"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground" aria-live="polite" data-testid="text-favorite-moment-count">{draft.length}/160 characters</span>
          <button type="submit" disabled={saveMoment.isPending} className="inline-flex min-h-11 items-center gap-2 bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60" data-testid="button-save-athlete-favorite-moment">
            {saveMoment.isPending ? 'Saving…' : 'Save note'}
          </button>
        </div>
        {notice && <p role="status" className="text-sm" data-testid="status-athlete-favorite-moment">{notice}</p>}
      </form>
    </section>
  );
}

export function AthleteFanCardAppearancePage() {
  const accessQuery = useGetAthleteEditorAccess({
    query: {
      queryKey: getGetAthleteEditorAccessQueryKey(),
      refetchOnMount: 'always',
      staleTime: 0,
      retry: false,
    },
  });
  const access = accessQuery.data;
  const cardQuery = useGetAthleteFanCard(access?.inviteToken ?? '', {
    query: {
      enabled: Boolean(access?.inviteToken && !access.projectId),
      queryKey: getGetAthleteFanCardQueryKey(access?.inviteToken ?? ''),
      retry: false,
      refetchOnWindowFocus: true,
    },
  });
  if (accessQuery.isLoading) {
    return <AthleteStudioShell><main className="grid min-h-[70dvh] place-items-center px-5"><div className="h-40 w-full max-w-2xl animate-pulse bg-muted" /></main></AthleteStudioShell>;
  }
  if (accessQuery.isError || !access) {
    return <AthleteStudioShell><main className="mx-auto max-w-3xl px-5 py-14"><section className="border-l-4 border-primary bg-card p-7" role="alert"><h1 className="font-display text-4xl uppercase">This invite is unavailable.</h1><p className="mt-3 text-sm text-muted-foreground">Ask your parent or guardian to confirm your athlete design access.</p></section></main></AthleteStudioShell>;
  }
  if (access.status === 'pending') return <AthleteShowcaseHome />;
  if (access.projectId) {
    return <AthleteStudioShell><main className="mx-auto max-w-3xl px-5 py-14"><section className="border-l-4 border-primary bg-card p-7"><h1 className="font-display text-4xl uppercase">This card uses a legacy editor.</h1><p className="mt-3 text-sm text-muted-foreground">Open the linked HYPE Card from your Showcase home.</p><Link href="/studio/player-showcase" className="mt-5 inline-flex min-h-11 items-center bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground">Back to Showcase</Link></section></main></AthleteStudioShell>;
  }
  if (cardQuery.isLoading) {
    return <AthleteStudioShell><main className="grid min-h-[70dvh] place-items-center px-5"><div className="h-40 w-full max-w-2xl animate-pulse bg-muted" /></main></AthleteStudioShell>;
  }
  if (cardQuery.isError || !cardQuery.data || cardQuery.data.inviteToken !== access.inviteToken) {
    return <AthleteStudioShell><main className="mx-auto max-w-3xl px-5 py-14"><section className="border-l-4 border-primary bg-card p-7" role="alert"><h1 className="font-display text-4xl uppercase">HYPE Card unavailable</h1><p className="mt-3 text-sm text-muted-foreground">Your parent may have paused the public card. Ask them to resume it before editing.</p><Link href={access.existingAccount ? '/card-editor' : '/studio/player-showcase'} className="mt-5 inline-flex min-h-11 items-center bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground">Back to Showcase</Link></section></main></AthleteStudioShell>;
  }
  const profile = {
    athleteName: access.athleteName,
    jerseyNumber: access.jerseyNumber,
    position: access.position,
  };
  return (
    <AthleteStudioShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">
        <Link href={access.existingAccount ? '/card-editor' : '/studio/player-showcase'} className="mb-5 inline-flex min-h-10 items-center border border-border px-4 text-xs font-bold uppercase tracking-widest hover:border-primary hover:text-primary">Back to Showcase</Link>
        <h1 className="mb-6 font-display text-4xl uppercase">Edit your HYPE Card design</h1>
        <FanCardAppearanceManager invite={cardQuery.data} profile={profile} athleteEditor />
      </main>
    </AthleteStudioShell>
  );
}

export function ExistingAccountCardEditorPage({ design = false }: { design?: boolean }) {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return <main className="p-8" role="status">Loading invitation…</main>;
  if (!isSignedIn) {
    const redirect = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/card-editor`;
    return <main className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="font-display text-4xl uppercase">Your HYPE Card invitation</h1>
      <p className="mt-4 text-sm text-muted-foreground">Sign in with the verified email address that received the invitation. Only that account can accept it.</p>
      <Link href={`/sign-in?redirect_url=${encodeURIComponent(redirect)}`} className="mt-6 inline-flex min-h-11 items-center bg-primary px-5 text-sm font-bold text-primary-foreground">Sign in to review invitation</Link>
    </main>;
  }
  return design ? <AthleteFanCardAppearancePage /> : <AthleteShowcaseHome />;
}

export function AthleteStudioShell({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  const [location] = useLocation();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  return (
    <div className="noise min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href={location.startsWith('/card-editor') ? '/card-editor' : '/studio/player-showcase'} className="inline-flex items-center" aria-label="Athlete showcase home">
            <img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-10 w-auto max-w-[160px] object-contain" />
          </Link>
          <button type="button" onClick={() => void signOut({ redirectUrl: basePath || '/' })} className="min-h-10 border border-border px-4 text-[10px] font-bold uppercase tracking-widest hover:border-primary hover:text-primary">Sign out</button>
        </div>
      </header>
      <div className="min-h-[calc(100dvh-68px)]">{children}</div>
    </div>
  );
}

export default PlayerShowcasePage;
