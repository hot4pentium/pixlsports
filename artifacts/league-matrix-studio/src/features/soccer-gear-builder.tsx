import { useEffect, useState } from 'react';
import {
  Activity,
  Check,
  ChevronRight,
  CircleHelp,
  Cloud,
  LockKeyhole,
  RotateCcw,
  Save,
  Shirt,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  Footprints,
} from 'lucide-react';
import {
  useGetSoccerGear,
  useSaveSoccerGear,
} from '@workspace/api-client-react';
import type {
  SoccerGearLoadout,
  SoccerGearState,
  SoccerGearStateUnlockedGearItem,
} from '@workspace/api-client-react';
import './soccer-gear-builder.css';

type GearKey = keyof SoccerGearLoadout;
type GearValue = SoccerGearLoadout[GearKey];

const colorPalette = [
  { label: 'Pixl blue', color: '#2878F5' },
  { label: 'Coral', color: '#F36E4C' },
  { label: 'Lime', color: '#D7EF80' },
  { label: 'Deep navy', color: '#173758' },
  { label: 'Cloud', color: '#F6F5EA' },
  { label: 'Violet', color: '#7455B8' },
];

const gearNames: Record<SoccerGearStateUnlockedItem, string> = {
  'speed-cleats': 'Speed cleats',
  'striped-socks': 'Striped socks',
  'contrast-shorts': 'Contrast shorts',
  'stripe-jersey': 'Stripe jersey',
  sweatbands: 'Sweatbands',
};

type SoccerGearStateUnlockedItem = SoccerGearStateUnlockedGearItem;

const gearGroups: Array<{
  key: GearKey;
  title: string;
  icon: typeof Shirt;
  options?: Array<{ value: string; label: string; unlock?: SoccerGearStateUnlockedItem }>;
  colorKey?: GearKey;
}> = [
  {
    key: 'jerseyStyle',
    title: 'Jersey',
    icon: Shirt,
    options: [
      { value: 'classic', label: 'Classic' },
      { value: 'stripes', label: 'Stripes', unlock: 'stripe-jersey' },
    ],
    colorKey: 'jerseyColor',
  },
  {
    key: 'shortsStyle',
    title: 'Shorts',
    icon: Activity,
    options: [
      { value: 'classic', label: 'Classic' },
      { value: 'contrast', label: 'Contrast', unlock: 'contrast-shorts' },
    ],
    colorKey: 'shortsColor',
  },
  {
    key: 'socksStyle',
    title: 'Socks',
    icon: ShieldCheck,
    options: [
      { value: 'plain', label: 'Plain' },
      { value: 'stripe', label: 'Stripe', unlock: 'striped-socks' },
    ],
    colorKey: 'socksColor',
  },
  {
    key: 'cleatsStyle',
    title: 'Cleats',
    icon: Footprints,
    options: [
      { value: 'classic', label: 'Classic' },
      { value: 'speed', label: 'Speed', unlock: 'speed-cleats' },
    ],
    colorKey: 'cleatsColor',
  },
  {
    key: 'sweatband',
    title: 'Sweatband',
    icon: Sparkles,
    options: [
      { value: 'none', label: 'No band' },
      { value: 'head', label: 'Head', unlock: 'sweatbands' },
      { value: 'wrist', label: 'Wrist', unlock: 'sweatbands' },
    ],
  },
];

function PlayerKit({ loadout, athleteName }: { loadout: SoccerGearLoadout; athleteName: string }) {
  const displayName = athleteName.trim() || 'Your player';
  const shortsColor = loadout.shortsStyle === 'contrast'
    ? loadout.jerseyColor
    : loadout.shortsColor;
  return (
    <svg className="gear-player" viewBox="0 0 360 500" role="img" aria-label={`${displayName}'s soccer kit preview`}>
      <defs>
        <pattern id="gear-jersey-stripes" width="28" height="28" patternUnits="userSpaceOnUse">
          <rect width="11" height="28" fill="rgba(255,255,255,.24)" />
        </pattern>
        <pattern id="gear-sock-stripes" width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="5" fill="rgba(255,255,255,.55)" />
        </pattern>
      </defs>
      <g className="gear-figure">
        <ellipse cx="180" cy="45" rx="35" ry="39" fill="#C98962" />
        <path d="M148 39c3-29 59-39 72-4-10-9-20-15-32-15-13 0-26 8-40 19Z" fill="#382D2A" />
        <path d="M165 79h31v22h-31z" fill="#B97956" />
        <path d="M118 102 151 91h58l35 13 38 68-34 19-16-30v115H127V161l-17 33-35-18 38-69Z" fill={loadout.jerseyColor} />
        {loadout.jerseyStyle === 'stripes' && (
          <path d="M118 102 151 91h58l35 13 38 68-34 19-16-30v115H127V161l-17 33-35-18 38-69Z" fill="url(#gear-jersey-stripes)" />
        )}
        <path d="M151 92c6 19 14 29 29 29s23-10 29-29" fill="none" stroke="rgba(255,255,255,.58)" strokeWidth="5" />
        <path d="M171 114h18v25h-18z" fill="rgba(255,255,255,.82)" />
        <text x="180" y="132" textAnchor="middle" fill="#24405b" fontSize="15" fontWeight="900" fontFamily="sans-serif">10</text>
        <path d="M127 244h106l12 93c-13 14-36 19-66 19s-53-5-66-19l14-93Z" fill={loadout.shortsColor} />
        {loadout.shortsStyle === 'contrast' && (
          <path d="M128 251h51v105c-28 0-50-5-64-19l13-86Z" fill={shortsColor} opacity=".94" />
        )}
        <path d="M180 246v106" stroke="rgba(255,255,255,.22)" strokeWidth="3" />
        <path d="M132 350c10 4 27 7 48 7v80h-39l-13-65 4-22Zm48 7c21 0 38-3 48-7l4 22-13 65h-39v-80Z" fill={loadout.socksColor} />
        {loadout.socksStyle === 'stripe' && (
          <>
            <path d="M132 350c10 4 27 7 48 7v80h-39l-13-65 4-22Zm48 7c21 0 38-3 48-7l4 22-13 65h-39v-80Z" fill="url(#gear-sock-stripes)" />
          </>
        )}
        <path d="M139 433h40v13c-9 7-26 10-50 5l-8-9c3-5 9-8 18-9Zm42 0h40c9 0 15 4 18 9l-8 9c-24 5-41 2-50-5v-13Z" fill={loadout.cleatsColor} />
        {loadout.cleatsStyle === 'speed' && (
          <>
            <path d="m141 438 29 0-12 11h-20l-5-4 8-7Zm49 0h29l8 7-5 4h-20l-12-11Z" fill="rgba(255,255,255,.68)" />
            <path d="m136 457 3 9m18-10-1 9m34-9 1 9m17-9 3 9" stroke="#E9EEDE" strokeWidth="3" strokeLinecap="round" />
          </>
        )}
        {loadout.sweatband === 'head' && <path d="M146 42c8-9 21-15 34-15 13 0 25 5 34 14l-2 9c-17-8-45-8-64 0l-2-8Z" fill="#F36E4C" />}
        {loadout.sweatband === 'wrist' && (
          <>
            <path d="m83 177 18 9-7 15-18-9 7-15Zm185-1 19 10-8 15-18-10 7-15Z" fill="#F36E4C" />
          </>
        )}
        <path d="M147 179h66" stroke="rgba(255,255,255,.15)" strokeWidth="2" />
      </g>
    </svg>
  );
}

function LoadingGear() {
  return (
    <main className="soccer-gear">
      <div className="gear-loading" aria-label="Loading soccer gear" data-testid="status-soccer-gear-loading">
        <div className="gear-skeleton gear-loading-head" />
        <div className="gear-loading-grid">
          <div className="gear-skeleton gear-loading-stage" />
          <div className="gear-skeleton gear-loading-panel" />
        </div>
      </div>
    </main>
  );
}

export function SoccerGearBuilderPage({ athleteName }: { athleteName: string }) {
  const gearQuery = useGetSoccerGear();
  const saveGear = useSaveSoccerGear();
  const [loadout, setLoadout] = useState<SoccerGearLoadout | null>(null);
  const [savedLoadout, setSavedLoadout] = useState<SoccerGearLoadout | null>(null);
  const [saveError, setSaveError] = useState('');
  const [savedPulse, setSavedPulse] = useState(false);

  useEffect(() => {
    if (gearQuery.data && !loadout) {
      setLoadout(gearQuery.data.loadout);
      setSavedLoadout(gearQuery.data.loadout);
    }
  }, [gearQuery.data, loadout]);

  if (gearQuery.isLoading) return <LoadingGear />;

  if (gearQuery.isError) {
    return (
      <main className="soccer-gear">
        <section className="gear-status" role="alert" data-testid="status-soccer-gear-error">
          <CircleHelp size={19} />
          <span>We couldn’t open this kit right now. Your saved look is still safe.</span>
          <button type="button" onClick={() => gearQuery.refetch()} data-testid="button-retry-soccer-gear">Try again</button>
        </section>
      </main>
    );
  }

  if (!gearQuery.data || !loadout || !savedLoadout) {
    return (
      <main className="soccer-gear">
        <section className="gear-empty" data-testid="empty-soccer-gear">
          <div className="gear-empty-mark"><Shirt size={26} /></div>
          <h2>Your locker is ready</h2>
          <p>There isn’t a kit to show yet. Give the page another try to bring your saved gear into the locker.</p>
          <button className="gear-save-button" type="button" onClick={() => gearQuery.refetch()} data-testid="button-reload-soccer-gear">
            <RotateCcw size={16} /> Reload locker
          </button>
        </section>
      </main>
    );
  }

  const state: SoccerGearState = gearQuery.data;
  const unlocked = new Set(state.unlockedGear);
  const dirty = JSON.stringify(loadout) !== JSON.stringify(savedLoadout);
  const updateLoadout = (key: GearKey, value: GearValue) => {
    setLoadout((current) => current ? { ...current, [key]: value } as SoccerGearLoadout : current);
    setSaveError('');
    setSavedPulse(false);
  };
  const save = () => {
    setSaveError('');
    saveGear.mutate({ data: { loadout } }, {
      onSuccess: (nextState) => {
        setLoadout(nextState.loadout);
        setSavedLoadout(nextState.loadout);
        setSavedPulse(true);
      },
      onError: () => setSaveError('That save didn’t stick. Check your connection and try once more.'),
    });
  };

  const colorButtons = (colorKey: GearKey) => {
    const currentColor = String(loadout[colorKey]);
    return (
      <>
        {colorPalette.map((item) => (
          <button
            key={item.color}
            type="button"
            className="gear-color-choice"
            aria-label={`${item.label} color`}
            aria-pressed={currentColor.toLowerCase() === item.color.toLowerCase()}
            onClick={() => updateLoadout(colorKey, item.color as GearValue)}
            data-testid={`button-gear-color-${colorKey}-${item.label.toLowerCase().replaceAll(' ', '-')}`}
          >
            <span className="gear-color-chip" style={{ backgroundColor: item.color }} />
            {item.label}
          </button>
        ))}
        <label className="gear-color-field" data-testid={`control-custom-color-${colorKey}`}>
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(currentColor) ? currentColor : '#2878F5'}
            aria-label={`Choose custom ${colorKey.replace('Color', '').toLowerCase()} color`}
            onChange={(event) => updateLoadout(colorKey, event.target.value.toUpperCase() as GearValue)}
            data-testid={`input-custom-color-${colorKey}`}
          />
          Custom
        </label>
      </>
    );
  };

  const renderOptions = (key: GearKey, options: NonNullable<(typeof gearGroups)[number]['options']>) => {
    const currentValue = String(loadout[key]);
    return options.map((option) => {
      const locked = Boolean(option.unlock && !unlocked.has(option.unlock));
      return (
        <button
          key={option.value}
          type="button"
          className="gear-choice"
          aria-pressed={currentValue === option.value}
          aria-label={locked ? `${option.label}, locked` : option.label}
          title={locked ? `${gearNames[option.unlock!]} is locked. Build progress through your Pixl Sports activity to unlock it.` : option.label}
          disabled={locked}
          onClick={() => updateLoadout(key, option.value as GearValue)}
          data-testid={`button-gear-option-${key}-${option.value}`}
        >
          {option.label}
          {locked && <LockKeyhole size={12} aria-hidden="true" />}
        </button>
      );
    });
  };

  return (
    <main className="soccer-gear">
      <div className="gear-shell">
        <div className="gear-topline">
          <div className="gear-brand" data-testid="text-pixl-sports-brand">
            <span className="gear-brand-mark"><Star size={15} fill="currentColor" /></span>
            Pixl Sports Studio
          </div>
          <div className="gear-private" data-testid="status-private-locker"><LockKeyhole size={13} /> Private locker</div>
        </div>

        <header className="gear-intro">
          <div>
            <p className="gear-kicker">Your player. Your colors. Your call.</p>
            <h1><em>Build</em> the kit.</h1>
            <p className="gear-subtitle">Make a look that feels like yours, {athleteName.trim() || 'champ'}. Pick the pieces, find your colors, and save the kit for next time.</p>
          </div>
          <div className={`gear-save-state ${!dirty ? 'is-saved' : ''}`} role="status" data-testid="status-gear-save-state">
            <span className="gear-save-dot" />
            {saveGear.isPending ? 'Saving your look' : dirty ? 'Unsaved changes' : savedPulse ? 'Look saved' : 'All changes saved'}
          </div>
        </header>

        <div className="gear-workbench">
          <section className="gear-stage" aria-label="Player kit preview" data-testid="panel-soccer-kit-preview">
            <div className={`gear-pitch ${loadout.background === 'goal' ? 'is-goal' : ''}`}>
              {loadout.background === 'field' && <div className="gear-center-circle" />}
            </div>
            <div className="gear-avatar-shadow" />
            <div className="gear-stage-head">
              <div>
                <div className="gear-stage-label">Match day, your way</div>
                <div className="gear-stage-name" data-testid="text-preview-athlete-name">{athleteName.trim() || 'Your player'}</div>
              </div>
              <div className="gear-number" aria-label="Jersey number 10">10</div>
            </div>
            <PlayerKit loadout={loadout} athleteName={athleteName} />
            <div className="gear-stage-footer">
              <div className="gear-stage-hint"><Sparkles size={14} /> Little details. Big player energy.</div>
              <div className="gear-background-toggle" role="group" aria-label="Preview background">
                <button type="button" aria-pressed={loadout.background === 'field'} onClick={() => updateLoadout('background', 'field')} data-testid="button-background-field">Field</button>
                <button type="button" aria-pressed={loadout.background === 'goal'} onClick={() => updateLoadout('background', 'goal')} data-testid="button-background-goal">Goal</button>
              </div>
            </div>
          </section>

          <section className="gear-controls" aria-labelledby="gear-controls-title" data-testid="panel-gear-controls">
            <div className="gear-controls-head">
              <div>
                <h2 id="gear-controls-title">Make it yours</h2>
                <p>Tap a piece, then pick its look.</p>
              </div>
              <span className="gear-selected-count" data-testid="text-kit-customizer-label">Kit customizer</span>
            </div>
            <div className="gear-options">
              {gearGroups.map((group) => {
                const Icon = group.icon;
                return (
                  <div className="gear-option" key={group.key} data-testid={`group-gear-${group.key}`}>
                    <div className="gear-option-top">
                      <div className="gear-option-title"><Icon size={15} /> {group.title}</div>
                      <span className="gear-current">{group.colorKey ? colorPalette.find((color) => color.color.toLowerCase() === String(loadout[group.colorKey!]).toLowerCase())?.label ?? 'Custom shade' : ''}</span>
                    </div>
                    <div className="gear-choice-row">
                      {group.options && renderOptions(group.key, group.options)}
                      {group.colorKey && colorButtons(group.colorKey)}
                    </div>
                    {group.options?.some((option) => option.unlock && !unlocked.has(option.unlock)) && (
                      <div className="gear-locked-note" data-testid={`text-locked-reason-${group.key}`}>
                        <LockKeyhole size={11} /> Locked styles open as Pixl progress builds.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="gear-save-row">
              <div className="gear-save-message" role="status" data-testid="status-gear-save-message">
                {saveError || (dirty ? 'Your edits are on the pitch, not saved yet.' : savedPulse ? 'A fresh look, safely in your locker.' : 'Your latest look is in the locker.')}
              </div>
              <button
                className="gear-save-button"
                type="button"
                onClick={save}
                disabled={!dirty || saveGear.isPending}
                data-testid="button-save-soccer-gear"
              >
                {saveGear.isPending ? <Cloud size={16} /> : <Save size={16} />}
                {saveGear.isPending ? 'Saving…' : 'Save my kit'}
                {!saveGear.isPending && <ChevronRight size={15} />}
              </button>
            </div>
          </section>
        </div>

        <section className="gear-progress" aria-label="Pixl Sports progress and unlocked gear" data-testid="panel-gear-progress">
          <div className="gear-progress-card gear-progress-main">
            <div className="gear-progress-heading">
              <div>
                <h2>Progress, on your time</h2>
                <p>Every bit of Pixl activity makes your locker grow.</p>
              </div>
              <div className="gear-progress-mark"><Trophy size={18} /></div>
            </div>
            <div className="gear-metric-list">
              <div className="gear-metric" data-testid="metric-active-weeks">
                <strong>{state.progress.activeWeeks}</strong><span>Active weeks</span>
              </div>
              <div className="gear-metric" data-testid="metric-event-cards">
                <strong>{Math.min(state.progress.eventCardsCreated, 10)}<small> / 10</small></strong><span>Event cards</span>
              </div>
              <div className="gear-metric" data-testid="metric-hype-card-shared">
                <strong>{state.progress.hypeCardShared ? <Check size={20} /> : '—'}</strong><span>HYPE Card shared</span>
              </div>
            </div>
          </div>
          <div className="gear-progress-card gear-unlock-card">
            <div className="gear-unlock-top">
              <h3>Your gear shelf</h3>
              <span data-testid="text-unlocked-gear-count">{state.unlockedGear.length} of 5 open</span>
            </div>
            <div className="gear-unlock-list">
              {(Object.keys(gearNames) as SoccerGearStateUnlockedItem[]).map((item) => {
                const isUnlocked = unlocked.has(item);
                return (
                  <div className={`gear-unlock-item ${isUnlocked ? 'is-unlocked' : ''}`} key={item} data-testid={`status-unlock-${item}`}>
                    {isUnlocked ? <Check size={12} /> : <LockKeyhole size={12} />}
                    {gearNames[item]}
                    <span className="sr-only">{isUnlocked ? 'unlocked' : 'locked'}</span>
                  </div>
                );
              })}
            </div>
            <p className="gear-unlock-footnote" data-testid="text-unlock-context">
              Locked gear opens through Pixl Sports activity. Your progress above shows what you’ve built so far.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
