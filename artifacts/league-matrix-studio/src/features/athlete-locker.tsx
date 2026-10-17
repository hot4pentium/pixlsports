import { useState, type ReactElement } from 'react';
import { ArrowUpRight, BookOpen, CalendarDays, ClipboardCheck, Activity, LockKeyhole, Palette, Link2, Eye, Shirt, Trophy, UserRound } from 'lucide-react';
import type { OwnedAthleteInvite, SoccerGearState } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import { PlayerKit } from './soccer-gear-builder';
import { normalizeCardAppearance } from './hype-card-appearance';
import { canOpenAthleteLockerCard, getAthleteLockerRewards, type AthleteLockerRewardId } from './athlete-locker-model';
import type { AthleteLockerCardStatus, AthleteLockerGearStatus } from './athlete-locker-types';
import './athlete-locker.css';

export type { AthleteLockerCardStatus, AthleteLockerGearStatus } from './athlete-locker-types';

export interface AthleteLockerProps {
  placement: 'mobile' | 'desktop';
  athleteName: string;
  teamName: string;
  jerseyNumber: string | number;
  card: OwnedAthleteInvite | null;
  cardHref: string | null;
  cardStatus: AthleteLockerCardStatus;
  gear: SoccerGearState | null;
  gearStatus: AthleteLockerGearStatus;
  sport?: string | null;
}

const unlockLabels: Record<string, string> = {
  'speed-cleats': 'Speed cleats',
  'striped-socks': 'Striped socks',
  'contrast-shorts': 'Contrast shorts',
  'stripe-jersey': 'Stripe jersey',
  sweatbands: 'Sweatbands',
};

function titleForAthlete(name: string) {
  return name.trim().split(/\s+/)[0] || 'player';
}

const rewardArt: Record<AthleteLockerRewardId, ReactElement> = {
  'match-ball': <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="#f3f6fa"/><path d="M24 14l9 6-3 10H18l-3-10z" fill="#0b1f3a"/><path d="M24 3v11M33 20l11-4M30 30l7 9M18 30l-7 9M15 20L4 16" stroke="#0b1f3a" strokeWidth="2" fill="none"/></svg>,
  'event-bag': <svg viewBox="0 0 56 44" aria-hidden="true"><path d="M13 13h30l8 23a4 4 0 0 1-4 5H9a4 4 0 0 1-4-5z" fill="#2878f5"/><path d="M20 14V9c0-4 3-6 8-6s8 2 8 6v5M17 24h22M28 18v19" fill="none" stroke="#f3f6fa" strokeWidth="3"/><circle cx="28" cy="29" r="4" fill="#ff6433"/></svg>,
  'tactics-board': <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="5" width="38" height="38" rx="4" fill="#f3f6fa" stroke="#55a4ff" strokeWidth="2"/><path d="M24 7v34M7 24h34" stroke="#2878f5" strokeWidth="1.5"/><circle cx="24" cy="24" r="7" fill="none" stroke="#2878f5" strokeWidth="1.5"/><path d="M13 14l5 4m0-4-5 4m17 12l5 5m0-5-5 5" stroke="#ff6433" strokeWidth="2"/></svg>,
  'stripe-jersey': <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 5l9 4 9-4 11 8-6 9-5-3v24H15V19l-5 3-6-9z" fill="#f3f6fa" stroke="#55a4ff" strokeWidth="2"/><path d="M20 8v35m8-35v35" stroke="#ff6433" strokeWidth="4"/></svg>,
  'speed-cleats': <svg viewBox="0 0 64 40" aria-hidden="true"><path d="M3 30c0-9 3-16 8-16 8 0 10 6 22 8 14 2 28 3 28 10 0 3-3 4-6 4H8c-3 0-5-2-5-6z" fill="#2878f5"/><path d="M12 36v4M26 36v4M44 36v4M56 36v4" stroke="#f3f6fa" strokeWidth="3"/><path d="M20 20l4 4M26 22l4 4" stroke="#f3f6fa" strokeWidth="2"/></svg>,
};

function CardState({ status, card }: { status: AthleteLockerCardStatus; card: OwnedAthleteInvite | null }) {
  if (status === 'loading') {
    return <div className="athlete-locker__card-state athlete-locker__skeleton" role="status" data-testid="status-locker-card-loading">Loading your card…</div>;
  }
  if (status === 'error') {
    return <div className="athlete-locker__card-state" role="alert" data-testid="status-locker-card-error">Your HYPE Card couldn’t load right now.</div>;
  }
  if (status === 'unavailable' || card?.paused || card?.showHypeCard === false) {
    const message = card?.paused
      ? 'Your HYPE Card is paused.'
      : card && !card.showHypeCard
        ? 'Your HYPE Card is hidden right now.'
        : 'Your HYPE Card isn’t available right now.';
    const testId = card?.paused
      ? 'status-locker-card-paused'
      : card?.showHypeCard === false
        ? 'status-locker-card-hidden'
        : 'status-locker-card-unavailable';
    return <div className="athlete-locker__card-state" data-testid={testId}>{message}</div>;
  }
  if (status === 'missing' || !card) {
    return <div className="athlete-locker__card-state" data-testid="status-locker-card-missing">Your HYPE Card will show up here when it’s ready.</div>;
  }
  return null;
}

function GearStatus({ status }: { status: AthleteLockerGearStatus }) {
  if (status === 'loading') {
    return <div className="athlete-locker__gear-state athlete-locker__skeleton" role="status" data-testid="status-locker-gear-loading">Loading your saved kit…</div>;
  }
  if (status === 'error') {
    return <div className="athlete-locker__gear-state" role="alert" data-testid="status-locker-gear-error">Saved gear couldn’t load right now.</div>;
  }
  return <div className="athlete-locker__gear-state" data-testid="status-locker-gear-unavailable">No saved soccer kit to show yet.</div>;
}

export function AthleteLocker({
  placement,
  athleteName,
  teamName,
  jerseyNumber,
  card,
  cardHref,
  cardStatus,
  gear,
  gearStatus,
  sport = null,
}: AthleteLockerProps) {
  const [shareFeedback, setShareFeedback] = useState<{ path: string; text: string } | null>(null);
  const isSoccer = (sport ?? card?.sport) === 'soccer';
  const titleId = `athlete-locker-title-${placement}`;
  const canOpenCard = canOpenAthleteLockerCard(cardStatus, card, cardHref);
  const canShowCard = cardStatus === 'ready' && Boolean(card) && !card?.paused && card?.showHypeCard === true;
  const canShowGear = gearStatus === 'ready' && Boolean(gear);
  const appearance = card?.cardAppearance ? normalizeCardAppearance(card.cardAppearance) : null;
  const unlocked = gear?.unlockedGear ?? [];
  const playerName = athleteName.trim() || card?.athleteName || 'your season';

  const eventCount = canShowGear && gear ? gear.progress.eventCardsCreated : 0;
  const shelf = getAthleteLockerRewards(canShowGear ? gear?.progress : null);
  const lockerPath = canOpenCard && card ? `/locker/${encodeURIComponent(card.inviteToken)}` : null;
  const copyLockerLink = async () => {
    if (!lockerPath) return;
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${base}${lockerPath}`);
      setShareFeedback({ path: lockerPath, text: 'Locker link copied.' });
    } catch {
      setShareFeedback({ path: lockerPath, text: 'Could not copy the link. Open the preview and copy it from the address bar.' });
    }
  };
  const eventsHref = `#event-cards-${placement}`;
  const primary = [
    { id: 'events', label: 'Event Cards', hint: eventCount ? `${eventCount} made` : 'Plan the day', href: eventsHref, hash: true, Icon: CalendarDays },
    { id: 'stat-tracker', label: 'Stat Tracker', hint: 'Tap live plays', href: '/studio/stat-tracker', hash: false, Icon: Activity },
    { id: 'prep', label: 'Prep', hint: 'Pack the bag', href: '/studio/checklist', hash: false, Icon: ClipboardCheck },
  ];
  const secondary = [
    { id: 'profile-stats', label: 'Profile & Stats', href: '/studio/season-stats', Icon: UserRound },
    { id: 'gear-milestones', label: 'Gear & Milestones', href: '/studio/soccer-gear', Icon: Trophy },
    { id: 'playbook', label: 'Playbook', href: '/supporter-guide', Icon: BookOpen },
  ];

  return (
    <section className="athlete-locker" aria-labelledby={titleId} data-testid={`athlete-locker-${placement}`}>
      <header className="athlete-locker__heading">
        <div>
          <p className="athlete-locker__eyebrow">Your season, your story</p>
          <h2 id={titleId}>The locker</h2>
          <p className="athlete-locker__welcome" data-testid="text-locker-welcome">
            {`A look at your season, ${titleForAthlete(playerName)}.`}
          </p>
        </div>
        <span className="athlete-locker__number" aria-label={`Jersey number ${jerseyNumber}`} data-testid="text-locker-jersey-number">
          #{jerseyNumber}
        </span>
      </header>

      <div className="athlete-locker__cabinet">
        <div className="athlete-locker__interior">
          <div className="athlete-locker__rod" aria-hidden="true" />
          <section className="athlete-locker__gear-area" aria-label="Saved soccer gear">
            <div className="athlete-locker__section-heading">
              <span>Match-day kit</span>
              <span className="athlete-locker__section-icon"><Shirt size={15} aria-hidden="true" /></span>
            </div>
            {canShowGear && gear ? (
              <div className="athlete-locker__gear" data-testid="content-locker-soccer-gear">
                <div className="athlete-locker__kit-stage">
                  <span className="athlete-locker__beam" aria-hidden="true" />
                  <span className="athlete-locker__ring" aria-hidden="true" />
                  <span className="athlete-locker__big-number" aria-hidden="true">{jerseyNumber}</span>
                  <PlayerKit loadout={gear.loadout} athleteName={athleteName || gear.athleteName} jerseyNumber={jerseyNumber} />
                  <span className="athlete-locker__podium" aria-hidden="true" />
                  <span className="athlete-locker__kit-number" data-testid="text-locker-kit-number">#{jerseyNumber} · {teamName || 'Soccer'}</span>
                </div>
                <div className="athlete-locker__gear-copy">
                  <p className="athlete-locker__gear-name" data-testid="text-locker-kit-athlete">{athleteName || gear.athleteName}</p>
                  <p className="athlete-locker__gear-team" data-testid="text-locker-kit-team">{teamName || 'Soccer'}{teamName ? ' · Soccer' : ''}</p>
                  <div className="athlete-locker__progress" data-testid="content-locker-progress" aria-label="Saved locker progress">
                    <span><strong data-testid="text-locker-active-weeks">{gear.progress.activeWeeks}</strong> active weeks</span>
                    <span><strong data-testid="text-locker-event-cards">{gear.progress.eventCardsCreated}</strong> event cards</span>
                    <span><strong data-testid="text-locker-tracker-games">{gear.progress.trackerGamesCompleted}</strong> tracker games</span>
                  </div>
                  <div className="athlete-locker__unlocks" data-testid="content-locker-unlocks">
                    <span className="athlete-locker__unlocks-title"><LockKeyhole size={12} aria-hidden="true" /> Unlocked</span>
                    {unlocked.length ? (
                      <ul>
                        {unlocked.map((item) => (
                          <li key={item} data-testid={`text-locker-unlock-${item}`}>{unlockLabels[item] ?? item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p data-testid="text-locker-no-unlocks">Nothing unlocked yet.</p>
                    )}
                  </div>
                  <Link className="athlete-locker__cocreate" href="/studio/soccer-gear" data-testid={`link-locker-cocreate-${placement}`}>
                    <Palette size={16} aria-hidden="true" />
                    <span>Design this kit together<small>Parent-guided, with {titleForAthlete(playerName)} choosing the look</small></span>
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <GearStatus status={gearStatus} />
                {isSoccer && (
                  <Link className="athlete-locker__cocreate" href="/studio/soccer-gear" data-testid={`link-locker-cocreate-empty-${placement}`}>
                    <Palette size={16} aria-hidden="true" />
                    <span>Start designing the kit<small>Parent-guided, with {titleForAthlete(playerName)} choosing the look</small></span>
                  </Link>
                )}
              </>
            )}
          </section>

          <nav className="athlete-locker__primary" aria-label="Locker tools">
            {primary.map(({ id, label, hint, href, hash, Icon }) => {
              const inner = (<><Icon size={18} aria-hidden="true" /><span><strong>{label}</strong><em>{hint}</em></span><ArrowUpRight size={14} aria-hidden="true" className="athlete-locker__go" /></>);
              return hash ? (
                <a key={id} className="athlete-locker__tool" href={href} data-testid={`link-locker-${id}-${placement}`}>{inner}</a>
              ) : (
                <Link key={id} className="athlete-locker__tool" href={href} data-testid={`link-locker-${id}-${placement}`}>{inner}</Link>
              );
            })}
          </nav>

          <ul className="athlete-locker__shelf" aria-label="Equipment on the bench" data-testid="content-locker-shelf">
            {shelf.map((item) => (
              <li
                key={item.id}
                className={`athlete-locker__item${item.earned ? ' is-earned' : ''}`}
                data-testid={`item-locker-shelf-${item.id}`}
                aria-label={`${item.label}: ${item.earned ? 'earned' : `locked — ${item.requirement}`}`}
                title={item.earned ? 'Earned' : item.requirement}
              >
                <span className="athlete-locker__art">{rewardArt[item.id]}</span>
                <span className="athlete-locker__item-label">{item.earned ? item.label : `${item.label} (locked)`}</span>
              </li>
            ))}
          </ul>
        </div>

        <aside className="athlete-locker__side">
          <section className="athlete-locker__card-area" aria-label={`${playerName}’s HYPE Card`}>
            <div className="athlete-locker__section-heading">
              <span>HYPE Card</span>
              <span className="athlete-locker__read-only">Saved look</span>
            </div>
            {canShowCard && card ? (
              <div className="athlete-locker__card" data-testid="content-locker-hype-card">
                {canOpenCard && cardHref ? (
                  <Link
                    className="athlete-locker__card-link"
                    href={cardHref}
                    aria-label={`Open ${card.athleteName}’s public HYPE Card`}
                    data-testid={`link-locker-public-card-${placement}`}
                  >
                    <LivingAthleteCardFront
                      athleteName={card.athleteName || athleteName}
                      teamName={card.teamName || teamName}
                      sport={card.sport}
                      appearance={appearance}
                      photoUrl={card.photoUrl}
                      cutoutUrl={card.cutoutUrl}
                      photoAlt={`${card.athleteName || athleteName} on their HYPE Card`}
                    />
                    <span className="athlete-locker__open-hint">View card <ArrowUpRight size={14} aria-hidden="true" /></span>
                  </Link>
                ) : (
                  <div className="athlete-locker__card-static" data-testid="content-locker-card-static">
                    <LivingAthleteCardFront
                      athleteName={card.athleteName || athleteName}
                      teamName={card.teamName || teamName}
                      sport={card.sport}
                      appearance={appearance}
                      photoUrl={card.photoUrl}
                      cutoutUrl={card.cutoutUrl}
                      photoAlt={`${card.athleteName || athleteName} on their HYPE Card`}
                    />
                  </div>
                )}
              </div>
            ) : (
              <CardState status={cardStatus} card={card} />
            )}
          </section>
          <nav className="athlete-locker__secondary" aria-label="More from the locker">
            {secondary.map(({ id, label, href, Icon }) => (
              <Link key={id} className="athlete-locker__tag" href={href} data-testid={`link-locker-${id}-${placement}`}>
                <Icon size={15} aria-hidden="true" /> {label}
              </Link>
            ))}
          </nav>
        </aside>
      </div>
      {lockerPath && (
        <div className="athlete-locker__share" data-testid={`section-locker-share-${placement}`}>
          <p><strong>Parent management.</strong> The shared Locker is a read-only public view of the same card link.</p>
          <div className="athlete-locker__share-row">
            <Link href={lockerPath} data-testid={`link-locker-preview-${placement}`}><Eye size={13} aria-hidden="true" /> Preview shared Locker</Link>
            <button type="button" onClick={() => void copyLockerLink()} data-testid={`button-locker-copy-${placement}`}><Link2 size={13} aria-hidden="true" /> Copy Locker link</button>
          </div>
          {shareFeedback?.path === lockerPath && <p className="athlete-locker__share-feedback" role="status" data-testid={`status-locker-copy-${placement}`}>{shareFeedback.text}</p>}
        </div>
      )}
    </section>
  );
}

export default AthleteLocker;
