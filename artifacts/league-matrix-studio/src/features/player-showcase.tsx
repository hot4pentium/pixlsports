import { ArrowRight, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Footprints, MessageCircle, ShieldCheck, Zap } from 'lucide-react';
import { Link } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { useState, type ReactNode } from 'react';
import {
  getListAthleteInvitesQueryKey,
  useListAthleteInvites,
  useGetAthleteEditorAccess,
  getGetAthleteEditorAccessQueryKey,
  getGetAthleteFanCardQueryKey,
  useGetAthleteFanCard,
  type OwnedAthleteInvite,
  type PublicAthleteFanCard,
  type SoccerGearState,
  type SportGearState,
} from '@workspace/api-client-react';
import type { SupporterProfile } from './supporter-dashboard';
import { isSoccerGearForAthlete } from './athlete-locker-model';
import type { AthleteLockerGearStatus } from './athlete-locker-types';
import { AthleteEditorInvitationPanel } from './athlete-invite';
import { JerseyLayerStage } from './jersey-layers';
import { FootballJerseyPreview } from './football-jersey-preview';
import { useKitGear } from './use-kit-gear';
import { isGearSport, matchingSportGear, useSportGear } from './use-sport-gear';
import { SportGearCollection } from './sport-gear-collection';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import { FanCardAppearanceManager } from './fan-card-appearance-manager';
import { useShowcaseSwipe } from './use-showcase-swipe';
import { getShowcaseInvite, getShowcaseInviteCandidates } from './player-showcase-model';
import './player-showcase.css';

export interface PlayerShowcaseContentProps {
  profile: SupporterProfile;
  selectedSlide?: 'jersey' | 'card';
  onSlideChange?: (slide: 'jersey' | 'card') => void;
  gear: SoccerGearState | null;
  gearStatus: AthleteLockerGearStatus;
  onRetry?: () => void;
  /** Athlete mode: own-gear link, no parent-only links. */
  athleteRestricted?: boolean;
  hypeHref?: string;
  sportGear?: SportGearState | null;
  sportGearStatus?: AthleteLockerGearStatus;
  onRetrySportGear?: () => void;
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

export function PlayerShowcaseContent({ profile, selectedSlide: controlledSlide, onSlideChange, gear, gearStatus, onRetry, athleteRestricted = false, hypeHref = '/studio/hype-card', sportGear, sportGearStatus, onRetrySportGear, linkedCard, cardStatus = 'not-linked', cardEditHref = hypeHref, cardPublicHref, cardCandidates = [], selectedCardToken, onSelectCard, onRetryCard }: PlayerShowcaseContentProps) {
  const [uncontrolledSlide, setUncontrolledSlide] = useState<'jersey' | 'card'>('jersey');
  const selectedSlide = controlledSlide ?? uncontrolledSlide;
  const selectSlide = onSlideChange ?? setUncontrolledSlide;
  const swipeHandlers = useShowcaseSwipe(selectSlide);
  const isSoccer = profile.sport === 'soccer';
  const isFootball = profile.sport === 'football';
  const first = profile.athleteName.trim().split(/\s+/)[0] || 'Player';
  const number = profile.jerseyNumber.trim().replace(/^#/, '') || '—';
  const loadout = isSoccer && gearStatus === 'ready' && gear ? gear.loadout : null;
  const showcaseGear = sportGear?.sport === profile.sport ? {
    sport: sportGear.sport,
    earnedGear: sportGear.items.filter((item) => item.earned).map((item) => item.id),
    equippedGear: sportGear.loadout.equippedGear,
  } : null;
  const label = `${profile.athleteName || 'Player'} number ${number} ${sportLabel(profile.sport)} jersey`;
  const showError = isSoccer && gearStatus === 'error';
  const canPreviewCard = cardStatus === 'ready' && Boolean(linkedCard);
  const showCardSlide = !athleteRestricted || Boolean(linkedCard);
  const card = canPreviewCard ? linkedCard : null;
  const activeSlide = selectedSlide === 'card' && showCardSlide ? 'card' : 'jersey';
  const cardPicker = cardCandidates.length > 1 && onSelectCard ? (
    <label className="ps__card-picker">
      <span>Choose the card to show</span>
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
      <section className="ps__stage-wrap" aria-labelledby="ps-dyn" data-testid="section-dynamic-showcase" style={{ minWidth: 0 }}>
        <h1 id="ps-dyn" className="ps__section-title">Dynamic <span>Showcase</span></h1>
        <div className="ps__carousel" data-testid="showcase-carousel">
          <div
            className="ps__rotor-viewport"
            role="region"
            aria-roledescription="carousel"
            aria-label={`${profile.athleteName || 'Player'} showcase. Use the arrow controls or swipe to rotate between the jersey and HYPE Card.`}
            data-testid="showcase-rotor-viewport"
            {...swipeHandlers}
          >
            {showCardSlide && <div className="ps__carousel-controls" role="group" aria-label="Showcase carousel controls" data-testid="showcase-carousel-controls">
              <button type="button" aria-label="Show Jersey" aria-pressed={activeSlide === 'jersey'} onClick={() => selectSlide('jersey')} className="ps__carousel-arrow ps__carousel-arrow--previous" data-testid="button-showcase-slide-jersey">
                <ChevronLeft size={23} aria-hidden="true" />
              </button>
              <button type="button" aria-label="Show HYPE Card" aria-pressed={activeSlide === 'card'} onClick={() => selectSlide('card')} className="ps__carousel-arrow ps__carousel-arrow--next" data-testid="button-showcase-slide-card">
                <ChevronRight size={23} aria-hidden="true" />
              </button>
            </div>}
            <div className="ps__rotor" data-testid="showcase-rotor" data-active-slide={activeSlide}>
              <div
                className="ps__rotor-face ps__rotor-face--jersey"
                role="group"
                aria-roledescription="slide"
                aria-label={`${profile.athleteName || 'Player'} jersey`}
                aria-hidden={activeSlide !== 'jersey'}
                inert={activeSlide !== 'jersey'}
                data-active={activeSlide === 'jersey'}
                data-testid="showcase-slide-jersey"
              >
                <div className="ps__stage" data-testid="showcase-jersey-stage">
                  <p className="ps__team">{profile.teamName || 'Your team'}<br />{sportLabel(profile.sport)}</p>
                  {isFootball ? (
                    <FootballJerseyPreview
                      name={first}
                      number={number}
                      label={label}
                      accent={sportGear?.loadout.jerseyColor}
                      showcaseGear={showcaseGear}
                    />
                  ) : (
                    <JerseyLayerStage
                      loadout={loadout}
                      unlockedGear={isSoccer ? gear?.unlockedGear : undefined}
                      name={first}
                      number={number}
                      label={label}
                      showcaseGear={showcaseGear}
                    />
                  )}
                  {isSoccer && gearStatus === 'loading' && (
                    <p className="ps__loading" role="status" data-testid="status-showcase-gear-loading">Loading your saved kit…</p>
                  )}
                  <div className="ps__links">
                    {isGearSport(profile.sport) && (
                      <Link href={athleteRestricted ? '/studio/player-showcase/gear' : '/studio/gear'} className="ps__link" data-testid="link-showcase-gear">
                        <Footprints size={18} aria-hidden="true" /> Gear
                      </Link>
                    )}
                    {!athleteRestricted && (
                      <Link href="/studio/athlete-page#owner-fan-hypes" className="ps__link" data-testid="link-showcase-shoutouts">
                        <MessageCircle size={18} aria-hidden="true" /> Shoutouts
                      </Link>
                    )}
                  </div>
                  {isSoccer && gearStatus === 'unavailable' && <p className="ps__note" data-testid="status-showcase-gear-empty">No saved kit for {first} yet, so the default blue shows. {athleteRestricted ? 'Open Gear to build it.' : 'Start in Gear.'}</p>}
                </div>
              </div>
              {showCardSlide && <div
                className="ps__rotor-face ps__rotor-face--card"
                role="group"
                aria-roledescription="slide"
                aria-label={`${profile.athleteName || 'Player'} HYPE Card`}
                aria-hidden={activeSlide !== 'card'}
                inert={activeSlide !== 'card'}
                data-active={activeSlide === 'card'}
                data-testid="showcase-slide-card"
              >
                <div className="ps__card-slide" data-testid="showcase-hype-card-preview">
                  {card ? <>
                    <div className="ps__card-caption">{cardPicker}<span>Saved front · {card.teamName || sportLabel(card.sport)}</span><div className="ps__card-links">
                      <Link href={cardEditHref} className="ps__link ps__link--primary" data-testid="link-showcase-card-edit"><Zap size={16} aria-hidden="true" /> Edit HYPE Card design</Link>
                      {cardPublicHref && <Link href={cardPublicHref} className="ps__link ps__link--secondary" data-testid="link-showcase-card-public"><ExternalLink size={16} aria-hidden="true" /> Open public card</Link>}
                    </div></div>
                    <div className="ps__card-art" aria-label={`${card.athleteName} HYPE Card preview`} data-testid="showcase-card-art">
                      <LivingAthleteCardFront athleteName={card.athleteName} teamName={card.teamName} photoUrl={card.photoUrl} appearance={card.cardAppearance} sport={card.sport} cutoutUrl={card.cutoutUrl} />
                    </div>
                  </> : <div className="ps__card-unavailable" role="status" data-testid="status-showcase-card-unavailable">
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
                      {cardStatus === 'loading' ? 'The saved front is on its way.'
                        : cardStatus === 'not-linked' ? 'There is no HYPE Card linked to this athlete yet.'
                          : cardStatus === 'ambiguous' ? 'Several cards match this athlete and team. Compare sport and season, then choose the card for this Showcase.'
                          : cardStatus === 'unavailable' ? 'The linked HYPE Card could not be loaded.'
                          : 'The jersey stays here. Card details stay private until sharing is active.'}
                    </span>
                    {(cardStatus === 'ambiguous' || (cardStatus === 'unavailable' && cardCandidates.length > 1)) && cardPicker}
                    {cardStatus === 'unavailable' && onRetryCard && <button type="button" onClick={onRetryCard} className="ps__link" data-testid="button-showcase-card-retry">Try again</button>}
                    {cardStatus !== 'ambiguous' && <Link href={cardEditHref} className="ps__link" data-testid="link-showcase-card-edit-unavailable">
                      {cardStatus === 'not-linked' ? 'Create HYPE Card' : 'Open HYPE Card design'}
                      <ArrowRight size={15} aria-hidden="true" />
                    </Link>}
                  </div>}
                </div>
              </div>}
            </div>
          </div>
        </div>
        {activeSlide === 'jersey' && showError && (
          <p className="ps__state" role="alert" data-testid="status-showcase-error" style={{ marginTop: 12 }}>
            Your saved kit couldn&rsquo;t load.
            {onRetry && <button type="button" onClick={onRetry} data-testid="button-showcase-retry">Try again</button>}
          </p>
        )}
        {activeSlide === 'jersey' && sportGearStatus === 'loading' && <p role="status" className="ps__state">Loading earned equipment…</p>}
        {activeSlide === 'jersey' && sportGearStatus === 'error' && <p role="alert" className="ps__state">Your equipment couldn’t load. <button type="button" onClick={onRetrySportGear}>Try again</button></p>}
        {activeSlide === 'jersey' && sportGear && <div className="ps__gear-collection"><SportGearCollection sport={sportGear.sport} items={sportGear.items} earnedGear={sportGear.items.filter((item) => item.earned).map((item) => item.id)} equippedGear={sportGear.loadout.equippedGear} /></div>}
      </section>
    </div>
  );
}

export function PlayerShowcasePage({ profile, userId }: { profile: SupporterProfile; userId: string | null }) {
  const [shareStatus, setShareStatus] = useState('');
  const [selectedSlide, setSelectedSlide] = useState<'jersey' | 'card'>('jersey');
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
  const gearQuery = useKitGear(userId, profile.sport === 'soccer');
  const sportGearQuery = useSportGear(userId, profile.sport, profile.athleteName);
  const sportGear = matchingSportGear(sportGearQuery.data, profile.athleteName, profile.sport);
  const gear = isSoccerGearForAthlete(gearQuery.data, profile.athleteName, profile.sport) ? gearQuery.data : null;
  const gearStatus: AthleteLockerGearStatus = profile.sport !== 'soccer' || !userId ? 'unavailable'
    : gearQuery.isLoading ? 'loading'
      : gearQuery.isError ? 'error'
        : gear ? 'ready' : 'unavailable';
  const retry = () => {
    if (gearQuery.isError) void gearQuery.refetch();
  };
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
      <PlayerShowcaseContent profile={profile} selectedSlide={selectedSlide} onSlideChange={setSelectedSlide} gear={gear} gearStatus={gearStatus} onRetry={retry}
        sportGear={sportGear} sportGearStatus={sportGearQuery.isLoading ? 'loading' : sportGearQuery.isError ? 'error' : sportGear ? 'ready' : 'unavailable'}
        onRetrySportGear={() => void sportGearQuery.refetch()}
        linkedCard={linkedCard} cardStatus={cardStatus}
        cardCandidates={hasAmbiguousInvite ? inviteCandidates : undefined}
        selectedCardToken={selectedInvite?.inviteToken}
        onSelectCard={setSelectedInviteToken}
        hypeHref={cardSettingsHref}
        onRetryCard={() => {
          if (fanCardQuery.isError) void fanCardQuery.refetch();
          else void invitesQuery.refetch();
        }}
        cardEditHref={cardSettingsHref}
        cardPublicHref={inviteToken ? `/fan/${encodeURIComponent(inviteToken)}` : undefined} />
      {selectedSlide === 'jersey' && <div className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-8">
        {publicShowcaseUrl && (
          <section className="mb-5 flex flex-col gap-4 border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="share-showcase-title" data-testid="panel-share-public-showcase">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Public recipient view</p>
              <h2 id="share-showcase-title" className="mt-2 font-display text-2xl uppercase">Share the Showcase</h2>
              <p className="mt-1 text-sm text-muted-foreground">Recipients can see the jersey, shared Event Cards, and open the public HYPE Card.</p>
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
      </div>}
    </>
  );
}

export function AthleteShowcaseHome() {
  const { user } = useUser();
  const accessQuery = useGetAthleteEditorAccess({
    query: {
      queryKey: getGetAthleteEditorAccessQueryKey(),
      refetchOnMount: 'always',
      staleTime: 0,
      retry: false,
    },
  });
  const access = accessQuery.data;
  if (accessQuery.isLoading) {
    return <AthleteStudioShell><main className="grid min-h-[70dvh] place-items-center px-5"><div className="w-full max-w-xl space-y-4"><div className="h-4 w-28 animate-pulse bg-primary/20" /><div className="h-14 w-3/4 animate-pulse bg-muted" /><div className="h-36 animate-pulse bg-muted" /></div></main></AthleteStudioShell>;
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
      <AthleteShowcaseBody profile={profile} accountId={user?.id ?? null} projectId={access.projectId} inviteToken={access.inviteToken} />
      <section className="mt-2 grid gap-4 sm:grid-cols-[1.1fr_.9fr]">
        <div className="border border-border bg-card p-5 sm:p-7">
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Your profile</p>
          <h2 className="mt-3 font-display text-3xl uppercase">{access.teamName}</h2>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wider">
            {[access.sport, access.position, access.jerseyNumber ? `#${access.jerseyNumber.replace(/^#/, '')}` : ''].filter(Boolean).map((item) => <span key={item} className="border border-border bg-muted px-3 py-2">{item}</span>)}
          </div>
        </div>
        <div className="border border-border bg-primary/5 p-5 sm:p-7">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="mt-3 font-display text-2xl uppercase">A parent stays in control</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">You can design your kit and your linked HYPE Card. Page settings, visibility, and sharing stay with your parent or guardian.</p>
        </div>
      </section>
    </main></AthleteStudioShell>
  );
}

function AthleteShowcaseBody({ profile, accountId, projectId, inviteToken }: {
  profile: SupporterProfile;
  accountId: string | null;
  projectId: string | null;
  inviteToken: string;
}) {
  const gearQuery = useKitGear(accountId, profile.sport === 'soccer');
  const sportGearQuery = useSportGear(accountId, profile.sport, profile.athleteName);
  const sportGear = matchingSportGear(sportGearQuery.data, profile.athleteName, profile.sport);
  const gear = isSoccerGearForAthlete(gearQuery.data, profile.athleteName, profile.sport) ? gearQuery.data : null;
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
    : '/studio/player-showcase/hype-card';
  const gearStatus: AthleteLockerGearStatus = profile.sport !== 'soccer' || !accountId ? 'unavailable'
    : gearQuery.isLoading ? 'loading' : gearQuery.isError ? 'error' : gear ? 'ready' : 'unavailable';
  return (
    <PlayerShowcaseContent
      profile={profile} gear={gear} gearStatus={gearStatus} athleteRestricted
      linkedCard={linkedCard} cardStatus={cardStatus}
      hypeHref={cardEditHref} cardEditHref={cardEditHref}
      cardPublicHref={!projectId ? `/fan/${encodeURIComponent(inviteToken)}` : undefined}
      onRetry={() => void gearQuery.refetch()}
      sportGear={sportGear} sportGearStatus={sportGearQuery.isLoading ? 'loading' : sportGearQuery.isError ? 'error' : sportGear ? 'ready' : 'unavailable'}
      onRetrySportGear={() => void sportGearQuery.refetch()}
    />
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
  if (access.projectId) {
    return <AthleteStudioShell><main className="mx-auto max-w-3xl px-5 py-14"><section className="border-l-4 border-primary bg-card p-7"><h1 className="font-display text-4xl uppercase">This card uses a legacy editor.</h1><p className="mt-3 text-sm text-muted-foreground">Open the linked HYPE Card from your Showcase home.</p><Link href="/studio/player-showcase" className="mt-5 inline-flex min-h-11 items-center bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground">Back to Showcase</Link></section></main></AthleteStudioShell>;
  }
  if (cardQuery.isLoading) {
    return <AthleteStudioShell><main className="grid min-h-[70dvh] place-items-center px-5"><div className="h-40 w-full max-w-2xl animate-pulse bg-muted" /></main></AthleteStudioShell>;
  }
  if (cardQuery.isError || !cardQuery.data || cardQuery.data.inviteToken !== access.inviteToken) {
    return <AthleteStudioShell><main className="mx-auto max-w-3xl px-5 py-14"><section className="border-l-4 border-primary bg-card p-7" role="alert"><h1 className="font-display text-4xl uppercase">HYPE Card unavailable</h1><p className="mt-3 text-sm text-muted-foreground">Your parent may have paused the public card. Ask them to resume it before editing.</p><Link href="/studio/player-showcase" className="mt-5 inline-flex min-h-11 items-center bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground">Back to Showcase</Link></section></main></AthleteStudioShell>;
  }
  const profile = {
    athleteName: access.athleteName,
    jerseyNumber: access.jerseyNumber,
    position: access.position,
  };
  return (
    <AthleteStudioShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">
        <Link href="/studio/player-showcase" className="mb-5 inline-flex min-h-10 items-center border border-border px-4 text-xs font-bold uppercase tracking-widest hover:border-primary hover:text-primary">Back to Showcase</Link>
        <h1 className="mb-6 font-display text-4xl uppercase">Edit your HYPE Card design</h1>
        <FanCardAppearanceManager invite={cardQuery.data} profile={profile} athleteEditor />
      </main>
    </AthleteStudioShell>
  );
}

export function AthleteStudioShell({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  return (
    <div className="noise min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/studio/player-showcase" className="inline-flex items-center" aria-label="Athlete showcase home">
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
