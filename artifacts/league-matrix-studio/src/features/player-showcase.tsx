import { ArrowRight, Check, Copy, ExternalLink, Pencil, ShieldCheck, Zap, Share2, Save, WifiOff, Settings2, HeartHandshake } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BackNavigationLink } from '@/components/back-navigation-link';
import { BrandLogo } from './brand-logo';
import {
  getListAthleteInvitesQueryKey,
  useListAthleteInvites,
  useGetAthleteEditorAccess,
  useAcceptAthleteEditorAccess,
  getGetAthleteEditorAccessQueryKey,
  getGetAthleteFanCardQueryKey,
  useGetAthleteFanCard,
  getGetAthleteInviteQueryKey,
  useUpdateAthleteInvite,
  type AthleteInviteInput,
  type OwnedAthleteInvite,
  type PublicAthleteFanCard,
} from '@workspace/api-client-react';
import type { SupporterProfile } from './supporter-dashboard';
import { AthleteEditorInvitationPanel } from './athlete-invite';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import { OwnerHypeCardSurface } from './owner-hype-card-surface';
import { FanCardAppearanceManager } from './fan-card-appearance-manager';
import { FanCheersSummary } from './cheer-celebration';
import { athleteFanCardUrl } from './athlete-fan-card-url';
import { HypeCardShareQr } from './hype-card-share-qr';
import { getShowcaseInvite, getShowcaseInviteCandidates } from './player-showcase-model';
import './player-showcase.css';
import './showcase-desktop-density.css';

export interface PlayerShowcaseContentProps {
  profile: SupporterProfile;
  linkedCard?: PublicAthleteFanCard | null;
  cardStatus?: 'loading' | 'ready' | 'unavailable' | 'not-linked' | 'not-shared' | 'ambiguous';
  cardEditHref?: string;
  profileEditHref?: string;
  cardPublicHref?: string;
  cardCandidates?: readonly OwnedAthleteInvite[];
  ownerInvite?: OwnedAthleteInvite | null;
  ownerExperience?: boolean;
  selectedCardToken?: string;
  onSelectCard?: (inviteToken: string) => void;
  selectionDisabled?: boolean;
  onRetryCard?: () => void;
}

function sportLabel(sport: string | null) {
  return sport ? sport.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Sport';
}

export function PlayerShowcaseContent({ profile, linkedCard, cardStatus = 'not-linked', cardEditHref, profileEditHref, cardPublicHref, cardCandidates = [], ownerInvite, ownerExperience = false, selectedCardToken, onSelectCard, selectionDisabled = false, onRetryCard }: PlayerShowcaseContentProps) {
  const card = cardStatus === 'ready' ? linkedCard ?? null : null;
  const privateCheers = cardCandidates.find(candidate => candidate.inviteToken === selectedCardToken)?.liveTaps;
  const privateFrontPreview = cardStatus === 'not-shared' && ownerInvite;
  const cardPicker = cardCandidates.length > 1 && onSelectCard ? (
    <label className="ps__card-picker">
      <span>Choose the HYPE Card</span>
      <select
        aria-label={`Choose a HYPE Card for ${profile.athleteName}`}
        value={selectedCardToken ?? ''}
        disabled={selectionDisabled}
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
        <p className="ps__eyebrow">Player Showcase</p>
        <h1 id="ps-dyn" className="ps__section-title">HYPE Card</h1>
        <p className="ps__card-only-intro">One athlete. One season. Your HYPE Card.</p>
        {ownerExperience && ownerInvite && (
          <a href="#hype-card-settings" className="ps__owner-settings-shortcut" data-testid="link-showcase-hype-card-settings">
            <Settings2 aria-hidden="true" />
            <span>HYPE Card settings</span>
            <ArrowRight aria-hidden="true" />
          </a>
        )}
        <div className="ps__card-only" role="region" aria-label={`${profile.athleteName || 'Athlete'} HYPE Card Showcase`}>
          {cardPicker}
          {card || privateFrontPreview ? (
            <div className="ps__card-only-panel" data-testid="showcase-hype-card-preview">
              <div className="ps__card-only-heading">
                <div>
                  <p className="ps__card-only-kicker">HYPE Card</p>
                  <p className="ps__card-only-team">{card?.teamName || ownerInvite?.teamName || sportLabel(profile.sport ?? '')}</p>
                </div>
                <div className="ps__card-links">
                  {!ownerExperience && cardEditHref && <Link href={cardEditHref} className="ps__link ps__link--primary" data-testid="link-showcase-card-edit">
                    <Zap size={16} aria-hidden="true" /> Edit HYPE Card
                  </Link>}
                  {cardPublicHref && <Link href={cardPublicHref} className="ps__link ps__link--secondary" data-testid="link-showcase-card-public">
                    <ExternalLink size={16} aria-hidden="true" /> Open public card
                  </Link>}
                </div>
              </div>
              {ownerInvite ? (
                <div className="ps__owner-card-surface-container" aria-label={`${card?.athleteName ?? profile.athleteName} HYPE Card preview`} data-testid="showcase-card-art">
                  <OwnerHypeCardSurface
                    card={card}
                    invite={ownerInvite}
                    athleteName={card?.athleteName ?? ownerInvite.athleteName}
                    teamName={card?.teamName ?? ownerInvite.teamName}
                    sport={card?.sport ?? ownerInvite.sport}
                    privatePreview={!ownerInvite.showHypeCard || ownerInvite.paused}
                  />
                </div>
              ) : card ? (
                <div className="ps__card-only-art" aria-label={`${card.athleteName} HYPE Card preview`} data-testid="showcase-card-art">
                  <LivingAthleteCardFront athleteName={card.athleteName} teamName={card.teamName} photoUrl={card.photoUrl} appearance={card.cardAppearance} sport={card.sport} cutoutUrl={card.cutoutUrl} />
                </div>
              ) : null}
              {!ownerExperience && card && <FanCheersSummary liveTaps={card.liveTaps} />}
            </div>
          ) : (
            <div
              className="ps__card-unavailable"
              role="status"
              aria-labelledby="showcase-card-status-title"
              aria-describedby="showcase-card-status-context"
              data-testid="status-showcase-card-unavailable"
            >
              <Zap size={24} aria-hidden="true" />
              <h2 id="showcase-card-status-title">
                {cardStatus === 'loading' ? 'Loading the saved card…'
                  : cardStatus === 'unavailable' ? 'HYPE Card unavailable'
                    : cardStatus === 'ambiguous' ? 'Choose a HYPE Card'
                      : cardStatus === 'not-linked' ? 'No HYPE Card linked'
                        : cardStatus === 'not-shared' ? 'HYPE Card not shared'
                          : 'HYPE Card unavailable'}
              </h2>
              <span id="showcase-card-status-context">
                {cardStatus === 'loading' ? 'The saved HYPE Card is on its way.'
                  : cardStatus === 'not-linked' ? 'There is no HYPE Card linked to this athlete yet.'
                    : cardStatus === 'ambiguous' ? 'Several cards match this athlete and team. Compare sport and season, then choose the one for this Showcase.'
                      : cardStatus === 'unavailable' ? 'The linked HYPE Card could not be loaded.'
                        : 'Card details stay private until sharing is active.'}
              </span>
              {(cardStatus === 'ambiguous' || (cardStatus === 'unavailable' && cardCandidates.length > 1)) && cardPicker}
              {cardStatus === 'unavailable' && onRetryCard && <button type="button" onClick={onRetryCard} className="ps__link" aria-label={`Try again to load ${profile.athleteName}'s HYPE Card`} data-testid="button-showcase-card-retry">Try again</button>}
              {!ownerExperience && cardStatus !== 'ambiguous' && cardEditHref && (
                <Link href={cardEditHref} className="ps__link" data-testid="link-showcase-card-edit-unavailable">
                  {cardStatus === 'not-linked' ? 'Create HYPE Card' : 'Open HYPE Card'}
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              )}
            </div>
          )}
          {!ownerExperience && !card && privateCheers && cardStatus === 'not-shared' && <FanCheersSummary liveTaps={privateCheers} />}
        </div>
        {!ownerExperience && profileEditHref && <Link href={profileEditHref} className="ps__profile-edit" data-testid="link-showcase-athlete-details">
          <Pencil size={16} aria-hidden="true" /> Edit Athlete Details
        </Link>}
      </section>
    </div>
  );
}

export function PlayerShowcasePage({ profile, userId }: { profile: SupporterProfile; userId: string | null }) {
  const [shareStatus, setShareStatus] = useState('');
  const [selectedInviteToken, setSelectedInviteToken] = useState<string | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsMessageKind, setSettingsMessageKind] = useState<'success' | 'error' | 'info'>('info');
  const [draftShowHypeCard, setDraftShowHypeCard] = useState(false);
  const [draftShowStats, setDraftShowStats] = useState(false);
  const [draftShowEvents, setDraftShowEvents] = useState(false);
  const [draftPaused, setDraftPaused] = useState(false);
  const shareInputRef = useRef<HTMLInputElement>(null);
  const selectedTokenRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const updateInvite = useUpdateAthleteInvite();
  const invitesQuery = useListAthleteInvites({
    query: {
      enabled: Boolean(userId),
      refetchInterval: 5000,
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
  useEffect(() => {
    if (selectedTokenRef.current !== matchedInvite?.inviteToken) {
      selectedTokenRef.current = matchedInvite?.inviteToken ?? null;
      setSettingsDirty(false);
      setSettingsMessage('');
    }
    if (!settingsDirty && matchedInvite) {
      setDraftShowHypeCard(matchedInvite.showHypeCard);
      setDraftShowStats(matchedInvite.showStats);
      setDraftShowEvents(matchedInvite.showEvents);
      setDraftPaused(matchedInvite.paused);
    }
  }, [matchedInvite?.inviteToken, matchedInvite?.showHypeCard, matchedInvite?.showStats, matchedInvite?.showEvents, matchedInvite?.paused, settingsDirty]);
  const cardStatus: PlayerShowcaseContentProps['cardStatus'] = invitesQuery.isLoading
    ? 'loading'
    : invitesQuery.isError ? 'unavailable'
    : !matchedInvite ? hasAmbiguousInvite ? 'ambiguous' : 'not-linked'
    : !matchedInvite.showHypeCard || matchedInvite.paused
      ? 'not-shared'
    : fanCardQuery.isLoading ? 'loading' : linkedCard ? 'ready' : 'unavailable';
  const publicHypeCardUrl = inviteToken ? athleteFanCardUrl(inviteToken) : null;
  const athleteDetailsHref = `/studio/profile?section=athlete&returnTo=showcase${matchedInvite
    ? `&inviteToken=${encodeURIComponent(matchedInvite.inviteToken)}`
    : ''}`;
  const copyHypeCardUrl = async () => {
    if (!publicHypeCardUrl) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(publicHypeCardUrl);
      setShareStatus('HYPE Card link copied.');
    } catch {
      const input = shareInputRef.current;
      if (input) {
        input.focus();
        input.select();
        try {
          if (document.execCommand('copy')) {
            setShareStatus('HYPE Card link copied.');
            return;
          }
        } catch {
          // Keep the link selected so it can be copied manually.
        }
      }
      setShareStatus('Copy was unavailable. The HYPE Card link is selected so you can copy it.');
    }
  };
  const shareHypeCard = async () => {
    if (!publicHypeCardUrl) return;
    setShareStatus('');
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${matchedInvite?.athleteName ?? profile.athleteName} HYPE Card`,
          text: `Follow ${matchedInvite?.athleteName ?? profile.athleteName}’s season.`,
          url: publicHypeCardUrl,
        });
        setShareStatus('HYPE Card share completed.');
      } catch (error) {
        setShareStatus(error instanceof DOMException && error.name === 'AbortError'
          ? 'Share menu closed.'
          : 'Could not open the share menu. Copy the link instead.');
      }
    } else {
      await copyHypeCardUrl();
    }
  };
  const settingsPayload = (invite: OwnedAthleteInvite): AthleteInviteInput => ({
    athleteName: invite.athleteName,
    teamName: invite.teamName,
    seasonName: invite.seasonName,
    seasonEndsAt: invite.seasonEndsAt,
    timezone: invite.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    sport: invite.sport,
    trackerProjectId: invite.trackerProjectId,
    scheduleProjectId: invite.scheduleProjectId,
    showHypeCard: draftShowHypeCard,
    showStats: draftShowStats,
    showSchedule: invite.showSchedule,
    showEvents: draftShowEvents,
    hypesEnabled: invite.hypesEnabled,
    paused: draftPaused,
  });
  const saveSettings = async () => {
    if (!matchedInvite || updateInvite.isPending) return;
    setSettingsMessage('');
    if (!navigator.onLine) {
      setSettingsMessageKind('error');
      setSettingsMessage('You’re offline. Your changes have not been saved; reconnect and try again.');
      return;
    }
    if (!matchedInvite.showHypeCard && draftShowHypeCard
      && !window.confirm('Make this HYPE Card public? Anyone with its link will be able to view the sections you enable.')) return;
    try {
      const updatedInvite = await updateInvite.mutateAsync({
        inviteToken: matchedInvite.inviteToken,
        data: settingsPayload(matchedInvite),
      });
      queryClient.setQueriesData<OwnedAthleteInvite[]>(
        { queryKey: getListAthleteInvitesQueryKey() },
        (current) => current?.map((invite) =>
          invite.inviteToken === updatedInvite.inviteToken ? updatedInvite : invite,
        ),
      );
      setSettingsDirty(false);
      setSettingsMessageKind('success');
      setSettingsMessage(draftPaused
        ? 'HYPE Card settings saved. The public page is paused.'
        : draftShowHypeCard ? 'HYPE Card settings saved.'
          : 'HYPE Card settings saved. The public card is hidden.');
      try {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetAthleteInviteQueryKey(matchedInvite.inviteToken) }),
          queryClient.invalidateQueries({ queryKey: getGetAthleteFanCardQueryKey(matchedInvite.inviteToken) }),
        ]);
      } catch {
        setSettingsMessageKind('info');
        setSettingsMessage('Settings were saved, but the latest card status could not be refreshed. Try again when you’re online.');
      }
    } catch {
      setSettingsMessageKind('error');
      setSettingsMessage('HYPE Card settings could not be saved. Check your connection and try again.');
    }
  };
  const setSetting = (setter: (value: boolean) => void, value: boolean) => {
    setter(value);
    setSettingsDirty(true);
    setSettingsMessage('');
  };
  const isShareable = Boolean(matchedInvite?.showHypeCard && !matchedInvite.paused && publicHypeCardUrl);
  const cheers = linkedCard?.liveTaps ?? matchedInvite?.liveTaps;
  const settingsDescription = draftPaused
    ? 'Paused. Public access is suspended until you resume the page.'
    : draftShowHypeCard
      ? 'The HYPE Card can be shared while the public page is active.'
      : 'The public HYPE Card is hidden; you can still review its owner preview.';
  return (
    <div className="ps-owner-canvas">
      <div className="ps-desktop-bounded mx-auto w-full max-w-6xl px-4 pt-5 sm:px-8">
        <BackNavigationLink
          href="/studio"
          label="Back to Supporter Hub"
          testId="link-back-supporter-dashboard"
        />
      </div>
      <PlayerShowcaseContent profile={profile} linkedCard={linkedCard} cardStatus={cardStatus}
        ownerInvite={matchedInvite}
        ownerExperience
        cardCandidates={hasAmbiguousInvite ? inviteCandidates : undefined}
        selectedCardToken={selectedInvite?.inviteToken}
        onSelectCard={setSelectedInviteToken}
        selectionDisabled={updateInvite.isPending}
        onRetryCard={() => {
          if (fanCardQuery.isError) void fanCardQuery.refetch();
          else void invitesQuery.refetch();
        }}
        cardPublicHref={isShareable ? `/fan/${encodeURIComponent(inviteToken!)}?from=player-showcase` : undefined} />
      <div className="ps-desktop-bounded mx-auto w-full max-w-6xl px-4 pb-12 sm:px-8">
        <section className="hype-owner-item" aria-labelledby="edit-athlete-details-title" data-testid="owner-item-athlete-details">
          <div className="hype-owner-item__icon"><Pencil aria-hidden="true" /></div>
          <div className="hype-owner-item__copy">
            <p className="hype-owner-item__eyebrow">Athlete profile</p>
            <h2 id="edit-athlete-details-title">Edit Athlete Details</h2>
            <p>Update the athlete identity linked to this season. HYPE Card privacy stays unchanged.</p>
          </div>
          <Link href={athleteDetailsHref} aria-label="Edit Athlete Details" className="hype-owner-item__action" data-testid="link-showcase-athlete-details">Edit details <ArrowRight aria-hidden="true" /></Link>
        </section>
        <section className="hype-owner-item hype-owner-item--cheers" aria-labelledby="owner-fan-cheers-title" data-testid="owner-item-fan-cheers">
          <div className="hype-owner-item__icon"><HeartHandshake aria-hidden="true" /></div>
          <div className="hype-owner-item__copy">
            <p className="hype-owner-item__eyebrow">From your Fan Base</p>
            <h2 id="owner-fan-cheers-title">Fan Cheers</h2>
            <p>See the live and season cheer totals shared for this athlete.</p>
          </div>
          {cheers
            ? <div className="hype-owner-cheers"><FanCheersSummary liveTaps={cheers} /></div>
            : <p className="hype-owner-empty-cheers" role="status">Cheer totals will appear here when fans have sent cheers.</p>}
        </section>
        <section className="hype-owner-item hype-owner-item--share" aria-labelledby="share-hype-card-title" data-testid="owner-item-share-hype-card">
          <div className="hype-owner-item__icon"><Share2 aria-hidden="true" /></div>
          <div className="hype-owner-item__copy">
            <p className="hype-owner-item__eyebrow">One link for family and friends</p>
            <h2 id="share-hype-card-title">Share HYPE Card</h2>
            <p>{isShareable ? 'Share the direct HYPE Card link. Fans will only see the sections you have published.' : 'Sharing is unavailable while the card is hidden or the public page is paused.'}</p>
          </div>
          {isShareable && publicHypeCardUrl ? (
            <div className="hype-owner-share-controls">
              <label className="sr-only" htmlFor="owner-hype-card-url">Direct HYPE Card URL</label>
              <input ref={shareInputRef} id="owner-hype-card-url" readOnly value={publicHypeCardUrl} onFocus={(event) => event.currentTarget.select()} data-testid="input-owner-hype-card-url" />
              <div className="hype-owner-share-buttons">
                <button type="button" onClick={() => void shareHypeCard()} data-testid="button-share-hype-card"><Share2 aria-hidden="true" />Share</button>
                <button type="button" onClick={() => void copyHypeCardUrl()} data-testid="button-copy-hype-card"><Copy aria-hidden="true" />Copy link</button>
                <Link href={`/fan/${encodeURIComponent(inviteToken ?? '')}`} target="_blank" rel="noreferrer" data-testid="link-open-owner-hype-card">Open card <ExternalLink aria-hidden="true" /></Link>
              </div>
              <HypeCardShareQr key={publicHypeCardUrl} url={publicHypeCardUrl} athleteName={matchedInvite?.athleteName ?? profile.athleteName} />
              <p className="hype-owner-status" role="status" aria-live="polite" data-testid="status-hype-card-share">{shareStatus}</p>
            </div>
          ) : (
            <div className="hype-owner-private-share" role="status"><WifiOff aria-hidden="true" />The direct link is not active right now.</div>
          )}
        </section>
        {matchedInvite && (
          <section id="hype-card-settings" className="hype-owner-settings" aria-labelledby="hype-card-settings-title" data-testid="owner-item-hype-card-settings">
            <div className="hype-owner-settings__heading">
              <span className="hype-owner-item__icon"><Settings2 aria-hidden="true" /></span>
              <div>
                <p className="hype-owner-item__eyebrow">Owner controls</p>
                <h2 id="hype-card-settings-title">HYPE Card settings</h2>
                <p>{settingsDescription}</p>
              </div>
            </div>
            <div className="hype-owner-setting-list">
              {[
                { id: 'show-hype-card', title: 'Show HYPE Card', detail: 'Let anyone with the direct link view your published card.', value: draftShowHypeCard, setter: setDraftShowHypeCard },
                { id: 'share-finalized-stats', title: 'Share finalized stats', detail: 'Include season totals from finalized games on the Stats side.', value: draftShowStats, setter: setDraftShowStats },
                { id: 'share-event-cards', title: 'Share Event Cards', detail: 'Show eligible saved Event Cards on the Events side.', value: draftShowEvents, setter: setDraftShowEvents },
                { id: 'pause-public-page', title: 'Pause public page', detail: 'Temporarily suspend public access without changing the card link.', value: draftPaused, setter: setDraftPaused },
              ].map((item) => (
                <label className="hype-owner-setting" key={item.id} htmlFor={item.id}>
                  <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                  <input id={item.id} type="checkbox" checked={item.value} disabled={updateInvite.isPending} onChange={(event) => setSetting(item.setter, event.currentTarget.checked)} data-testid={`toggle-${item.id}`} />
                </label>
              ))}
            </div>
            {settingsMessage && <p className={`hype-owner-settings__message hype-owner-settings__message--${settingsMessageKind}`} role={settingsMessageKind === 'error' ? 'alert' : 'status'} data-testid="status-hype-card-settings">{settingsMessage}</p>}
            <button type="button" className="hype-owner-save" onClick={() => void saveSettings()} disabled={!settingsDirty || updateInvite.isPending} data-testid="button-save-hype-card-settings">
              <Save aria-hidden="true" />{updateInvite.isPending ? 'Saving…' : 'Save HYPE Card settings'}
            </button>
          </section>
        )}
        <AthleteEditorInvitationPanel inviteToken={inviteToken ?? null} />
      </div>
    </div>
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
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Accept to customize this card’s design. Your existing account and permissions will stay unchanged. The owner keeps control of publishing, privacy, sharing, and account settings.</p>
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
      <section className="mt-4 border border-border bg-primary/5 p-5 sm:p-7">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h2 className="mt-3 font-display text-2xl uppercase">A parent stays in control</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">You can customize your linked HYPE Card’s appearance. Your parent or guardian controls the card’s visibility, publishing, privacy, and sharing.</p>
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
    return <AthleteStudioShell><main className="mx-auto max-w-3xl px-5 py-14"><section className="border-l-4 border-primary bg-card p-7"><h1 className="font-display text-4xl uppercase">This card uses a legacy editor.</h1><p className="mt-3 text-sm text-muted-foreground">Open the linked HYPE Card from your Player Showcase home.</p><Link href="/studio/player-showcase" className="mt-5 inline-flex min-h-11 items-center bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground">Back to Player Showcase</Link></section></main></AthleteStudioShell>;
  }
  if (cardQuery.isLoading) {
    return <AthleteStudioShell><main className="grid min-h-[70dvh] place-items-center px-5"><div className="h-40 w-full max-w-2xl animate-pulse bg-muted" /></main></AthleteStudioShell>;
  }
  if (cardQuery.isError || !cardQuery.data || cardQuery.data.inviteToken !== access.inviteToken) {
    return <AthleteStudioShell><main className="mx-auto max-w-3xl px-5 py-14"><section className="border-l-4 border-primary bg-card p-7" role="alert"><h1 className="font-display text-4xl uppercase">HYPE Card unavailable</h1><p className="mt-3 text-sm text-muted-foreground">Your parent may have paused the public card. Ask them to resume it before editing.</p><Link href={access.existingAccount ? '/card-editor' : '/studio/player-showcase'} className="mt-5 inline-flex min-h-11 items-center bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground">Back to Player Showcase</Link></section></main></AthleteStudioShell>;
  }
  const profile = {
    athleteName: access.athleteName,
    jerseyNumber: access.jerseyNumber,
    position: access.position,
  };
  return (
    <AthleteStudioShell>
      <main className="ps-card-editor-route mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">
        <Link href={access.existingAccount ? '/card-editor' : '/studio/player-showcase'} className="mb-5 inline-flex min-h-10 items-center border border-border px-4 text-xs font-bold uppercase tracking-widest hover:border-primary hover:text-primary">Back to Player Showcase</Link>
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
            <BrandLogo variant="on-dark" className="h-10 w-auto max-w-[160px] object-contain" />
          </Link>
          <button type="button" onClick={() => void signOut({ redirectUrl: basePath || '/' })} className="min-h-10 border border-border px-4 text-[10px] font-bold uppercase tracking-widest hover:border-primary hover:text-primary">Sign out</button>
        </div>
      </header>
      <div className="min-h-[calc(100dvh-68px)]">{children}</div>
    </div>
  );
}

export default PlayerShowcasePage;
