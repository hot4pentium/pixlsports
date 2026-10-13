import { ArrowUpRight, Check, CircleHelp, LockKeyhole, Shirt } from 'lucide-react';
import type { OwnedAthleteInvite, SoccerGearState } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import { PlayerKit } from './soccer-gear-builder';
import { normalizeCardAppearance } from './hype-card-appearance';
import { canOpenAthleteLockerCard } from './athlete-locker-model';
import type { AthleteLockerCardStatus, AthleteLockerGearStatus } from './athlete-locker-types';
import './athlete-locker.css';

export type { AthleteLockerCardStatus, AthleteLockerGearStatus } from './athlete-locker-types';

export interface AthleteLockerProps {
  athleteName: string;
  teamName: string;
  jerseyNumber: string | number;
  card: OwnedAthleteInvite | null;
  cardHref: string | null;
  cardStatus: AthleteLockerCardStatus;
  gear: SoccerGearState | null;
  gearStatus: AthleteLockerGearStatus;
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
  athleteName,
  teamName,
  jerseyNumber,
  card,
  cardHref,
  cardStatus,
  gear,
  gearStatus,
}: AthleteLockerProps) {
  const canOpenCard = canOpenAthleteLockerCard(cardStatus, card, cardHref);
  const canShowCard = cardStatus === 'ready' && Boolean(card) && !card?.paused && card?.showHypeCard === true;
  const canShowGear = gearStatus === 'ready' && Boolean(gear);
  const appearance = card?.cardAppearance ? normalizeCardAppearance(card.cardAppearance) : null;
  const unlocked = gear?.unlockedGear ?? [];
  const playerName = athleteName.trim() || card?.athleteName || 'your season';

  return (
    <section className="athlete-locker" aria-labelledby="athlete-locker-title" data-testid="athlete-locker">
      <header className="athlete-locker__heading">
        <div>
          <p className="athlete-locker__eyebrow">Your season, your story</p>
          <h2 id="athlete-locker-title">The locker</h2>
          <p className="athlete-locker__welcome" data-testid="text-locker-welcome">
            {`A look at your season, ${titleForAthlete(playerName)}.`}
          </p>
        </div>
        <span className="athlete-locker__number" aria-label={`Jersey number ${jerseyNumber}`} data-testid="text-locker-jersey-number">
          #{jerseyNumber}
        </span>
      </header>

      <div className="athlete-locker__content">
        <section className="athlete-locker__card-area" aria-label={`${playerName}’s HYPE Card`}>
          <div className="athlete-locker__section-heading">
            <span>HYPE Card</span>
            <span className="athlete-locker__read-only">Saved look</span>
          </div>
          {canShowCard && card ? (
            <div className="athlete-locker__card" data-testid="content-locker-hype-card">
              {canOpenCard && cardHref ? (
                <a
                  className="athlete-locker__card-link"
                  href={cardHref}
                  aria-label={`Open ${card.athleteName}’s public HYPE Card`}
                  data-testid="link-locker-public-card"
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
                </a>
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

        <section className="athlete-locker__gear-area" aria-label="Saved soccer gear">
          <div className="athlete-locker__section-heading">
            <span>Match-day kit</span>
            <span className="athlete-locker__section-icon"><Shirt size={15} aria-hidden="true" /></span>
          </div>
          {canShowGear && gear ? (
            <div className="athlete-locker__gear" data-testid="content-locker-soccer-gear">
              <div className="athlete-locker__kit-stage">
                <PlayerKit loadout={gear.loadout} athleteName={athleteName || gear.athleteName} jerseyNumber={jerseyNumber} />
                <span className="athlete-locker__kit-number" data-testid="text-locker-kit-number">#{jerseyNumber}</span>
              </div>
              <div className="athlete-locker__gear-copy">
                <p className="athlete-locker__gear-name" data-testid="text-locker-kit-athlete">{athleteName || gear.athleteName}</p>
                <p className="athlete-locker__gear-team" data-testid="text-locker-kit-team">{teamName || 'Soccer'}{teamName ? ' · Soccer' : ''}</p>
                <div className="athlete-locker__progress" data-testid="content-locker-progress" aria-label="Saved locker progress">
                  <span><strong data-testid="text-locker-active-weeks">{gear.progress.activeWeeks}</strong> active weeks</span>
                  <span><strong data-testid="text-locker-event-cards">{gear.progress.eventCardsCreated}</strong> event cards</span>
                    <span className="athlete-locker__share-progress">
                    {gear.progress.hypeCardShared ? <Check size={13} aria-hidden="true" /> : <CircleHelp size={13} aria-hidden="true" />}
                      Share step {gear.progress.hypeCardShared ? 'done' : 'not done'}
                  </span>
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
              </div>
            </div>
          ) : (
            <GearStatus status={gearStatus} />
          )}
        </section>
      </div>
    </section>
  );
}

export default AthleteLocker;
