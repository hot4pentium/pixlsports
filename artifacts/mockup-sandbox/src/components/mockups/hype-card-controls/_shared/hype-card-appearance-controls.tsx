import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { appearanceSwatches, defaultCardAppearance, normalizeCardAppearance, switchCardAppearanceDesign, type HypeCardAppearance, type HypeCardDesign } from './hype-card-appearance';
import { buildHypeCardTemplateArtwork, HYPE_CARD_TEMPLATES, isHypeCardTemplate, type HypeCardTemplateId } from './hype-card-template-artwork';

function Thumb({ frame, lowerThird, border, accent }: { frame: HypeCardTemplateId; lowerThird: HypeCardTemplateId; border: string; accent: string }) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const svg = buildHypeCardTemplateArtwork({
    frameTemplate: frame,
    lowerThirdTemplate: lowerThird,
    athleteName: 'Jordan Lee',
    teamName: 'River FC',
    jerseyNumber: '17',
    position: 'Forward',
    borderColor: border,
    accentColor: accent,
  }, 'all', `template-thumb-${uid}`);
  return <span aria-hidden="true" className="block aspect-[3/4] w-full overflow-hidden rounded-md bg-[#071A30]" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function HypeCardDesignPicker({ appearance, onChange, disabled = false, variant = 'cards', className = '' }: {
  appearance: HypeCardAppearance;
  onChange: (next: HypeCardAppearance) => void;
  disabled?: boolean;
  variant?: 'cards' | 'compact';
  className?: string;
}) {
  const compact = variant === 'compact';
  const choose = (design: HypeCardDesign) => onChange(switchCardAppearanceDesign(appearance, design));

  return (
    <fieldset className={className} disabled={disabled} data-testid={compact ? 'card-design-picker-compact' : 'card-design-picker-cards'}>
      <legend className={`${compact ? 'mb-2 text-[10px]' : 'mb-2 text-xs'} font-bold uppercase tracking-widest text-white/80`}>{compact ? 'Choose frame' : 'Frame template'}</legend>
      <div className={`grid grid-cols-2 gap-2 ${compact ? '' : 'lg:grid-cols-3'}`}>
        {HYPE_CARD_TEMPLATES.map((design) => (
          <button
            key={design.id}
            type="button"
            aria-pressed={appearance.design === design.id}
            onClick={() => choose(design.id)}
            className={compact
              ? 'flex min-h-11 w-full items-center justify-center rounded-lg border border-white/25 px-2 py-2 text-center text-[11px] font-bold leading-tight text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white aria-pressed:border-white aria-pressed:bg-white/15 aria-pressed:text-white'
              : 'flex min-h-11 flex-col gap-2 rounded-lg border border-white/25 p-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white aria-pressed:border-white aria-pressed:bg-white/15'}
            data-testid={`button-design-${compact ? 'compact-' : ''}${design.id}`}
          >
            {!compact && <span className="block w-full"><Thumb frame={design.id} lowerThird={appearance.lowerThirdTemplate} border={appearance.borderColor} accent={appearance.accentColor} /></span>}
            <span className={compact ? '' : 'text-sm font-black'}>{design.name}</span>
            {!compact && <span className="text-[11px] leading-snug text-white/65">{design.description}</span>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function HypeCardLowerThirdPicker({ appearance, onChange, disabled = false }: {
  appearance: HypeCardAppearance;
  onChange: (next: HypeCardAppearance) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} data-testid="lower-third-template-picker">
      <legend className="mb-2 text-xs font-bold uppercase tracking-widest text-white/80">Lower-third template</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {HYPE_CARD_TEMPLATES.map((template) => (
          <button key={template.id} type="button"
            aria-pressed={appearance.lowerThirdTemplate === template.id}
            onClick={() => onChange(normalizeCardAppearance({ ...appearance, lowerThirdTemplate: template.id }))}
            className="flex min-h-11 flex-col gap-2 rounded-lg border border-white/25 p-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white aria-pressed:border-white aria-pressed:bg-white/15"
            data-testid={`button-lower-third-template-${template.id}`}>
            <span className="block w-full"><Thumb frame={isHypeCardTemplate(appearance.design) ? appearance.design : 'velocity'} lowerThird={template.id} border={appearance.borderColor} accent={appearance.accentColor} /></span>
            <span className="text-sm font-black">{template.name}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function adjacentTemplate(current: HypeCardTemplateId, direction: -1 | 1): HypeCardTemplateId {
  const currentIndex = HYPE_CARD_TEMPLATES.findIndex((template) => template.id === current);
  const index = currentIndex < 0 ? 0 : currentIndex;
  return HYPE_CARD_TEMPLATES[(index + direction + HYPE_CARD_TEMPLATES.length) % HYPE_CARD_TEMPLATES.length].id;
}

function TemplateCycler({ label, selectedName, testId, previousLabel, nextLabel, onPrevious, onNext, disabled }: {
  label: string;
  selectedName: string;
  testId: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 rounded-xl border border-white/15 bg-white/[0.04] px-2 pb-2 pt-1" data-testid={testId}>
      <legend className="px-1 text-[10px] font-bold uppercase tracking-widest text-white/65">{label}</legend>
      <div className="flex items-center justify-center gap-2">
        <button type="button" aria-label={previousLabel} onClick={onPrevious}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/25 text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-45"
          data-testid={`${testId}-previous`}>
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
        </button>
        <button type="button" aria-label={nextLabel} onClick={onNext}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/25 text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-45"
          data-testid={`${testId}-next`}>
          <ChevronRight aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <p aria-live="polite" aria-atomic="true" className="mt-1 min-h-5 break-words text-center text-xs font-bold text-white" data-testid={`${testId}-selected`}>
        {selectedName}
      </p>
    </fieldset>
  );
}

export function HypeCardTemplateCyclers({ appearance, onChange, disabled = false }: {
  appearance: HypeCardAppearance;
  onChange: (next: HypeCardAppearance) => void;
  disabled?: boolean;
}) {
  const frameId: HypeCardTemplateId = isHypeCardTemplate(appearance.design) ? appearance.design : 'velocity';
  const frame = HYPE_CARD_TEMPLATES.find((template) => template.id === frameId) ?? HYPE_CARD_TEMPLATES[0];
  const lowerThird = HYPE_CARD_TEMPLATES.find((template) => template.id === appearance.lowerThirdTemplate) ?? HYPE_CARD_TEMPLATES[0];
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="hype-card-template-cyclers">
      <TemplateCycler label="Frame" selectedName={frame.name} testId="frame-template-cycler"
        previousLabel="Previous frame" nextLabel="Next frame" disabled={disabled}
        onPrevious={() => onChange(normalizeCardAppearance({ ...appearance, design: adjacentTemplate(frame.id, -1) }))}
        onNext={() => onChange(normalizeCardAppearance({ ...appearance, design: adjacentTemplate(frame.id, 1) }))} />
      <TemplateCycler label="Lower third" selectedName={lowerThird.name} testId="lower-third-template-cycler"
        previousLabel="Previous lower third" nextLabel="Next lower third" disabled={disabled}
        onPrevious={() => onChange(normalizeCardAppearance({ ...appearance, lowerThirdTemplate: adjacentTemplate(lowerThird.id, -1) }))}
        onNext={() => onChange(normalizeCardAppearance({ ...appearance, lowerThirdTemplate: adjacentTemplate(lowerThird.id, 1) }))} />
    </div>
  );
}

function HexField({ value, label, disabled, onValid }: { value: string; label: string; disabled: boolean; onValid: (c: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText((t) => (t.toUpperCase() === value.toUpperCase() || !/^#?[0-9a-f]{0,6}$/i.test(t) || t.replace('#', '').length === 6 ? value : t)); }, [value]);
  return (
    <input aria-label={`${label} hex`} value={text} disabled={disabled} maxLength={7} spellCheck={false} autoCapitalize="characters"
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const v = t.startsWith('#') ? t : `#${t}`;
        if (/^#[0-9a-f]{6}$/i.test(v)) onValid(v.toUpperCase());
      }}
      onBlur={() => setText(value)}
      className="h-11 w-28 rounded border border-white/30 bg-white/10 px-3 font-mono text-sm uppercase text-white" />
  );
}

const slider = 'w-full accent-[#EF3996] min-h-11';

export function HypeCardAppearanceControls({ appearance, onChange, disabled = false, placementActions, placementLabel = 'Photo placement', showAthleteSize = true, showResetButton = true, onResetPlacement, designPickerClassName = '', pickerMode = 'grid' }: { appearance: HypeCardAppearance; onChange: (next: HypeCardAppearance) => void; disabled?: boolean; placementActions?: ReactNode; placementLabel?: string; showAthleteSize?: boolean; showResetButton?: boolean; onResetPlacement?: () => void; designPickerClassName?: string; pickerMode?: 'grid' | 'arrows' }) {
  const set = (patch: Partial<HypeCardAppearance>) => onChange(normalizeCardAppearance({ ...appearance, ...patch }));
  const setBorder = (c: string) => set({ borderColor: c, accentColor: c, accentLinked: true });
  const swatches = (current: string, apply: (c: string) => void, label: string, trailingControl?: ReactNode) => (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      {appearanceSwatches.map(([name, color]) => (
        <button key={color} type="button" disabled={disabled} aria-label={name} aria-pressed={current.toUpperCase() === color} title={name}
          onClick={() => apply(color)} className="h-11 w-11 rounded-full border-2 border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-pressed:border-white aria-pressed:ring-2 aria-pressed:ring-white"
          style={{ background: color }} />
      ))}
      {trailingControl}
    </div>
  );
  const colorRow = (current: string, apply: (c: string) => void, label: string) => (
    <div className="flex shrink-0 items-center gap-2">
      <input type="color" aria-label={`${label} custom color`} value={current} disabled={disabled} onChange={(e) => apply(e.target.value.toUpperCase())} className="h-11 w-14 cursor-pointer rounded border border-white/30 bg-transparent p-0.5" />
      <HexField value={current} label={label} disabled={disabled} onValid={apply} />
    </div>
  );
  const range = (label: string, value: number, min: number, max: number, step: number, key: 'athleteScale' | 'athleteX' | 'athleteY', fmt: (v: number) => string) => (
    <label className="block text-xs font-bold uppercase tracking-widest text-white/80">
      <span className="flex justify-between"><span>{label}</span><span className="font-mono normal-case tracking-normal text-white/60">{fmt(value)}</span></span>
      <input type="range" className={slider} min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => set({ [key]: Number(e.target.value) })} />
    </label>
  );
  const reset = defaultCardAppearance(appearance.design);
  return (
    <div className="space-y-6 text-white" data-testid="hype-card-appearance-controls">
      {pickerMode === 'arrows'
        ? <HypeCardTemplateCyclers appearance={appearance} onChange={onChange} disabled={disabled} />
        : <>
          <HypeCardDesignPicker appearance={appearance} onChange={onChange} disabled={disabled} className={designPickerClassName} />
          <HypeCardLowerThirdPicker appearance={appearance} onChange={onChange} disabled={disabled} />
        </>}
      <>
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-white/80">{placementLabel}</p>
          {placementActions}
          {showAthleteSize && range('Photo zoom', appearance.athleteScale, 1, 1.6, .01, 'athleteScale', (v) => `${Math.round(v * 100)}%`)}
          {showResetButton && onResetPlacement && <button type="button" disabled={disabled} onClick={onResetPlacement} className="min-h-11 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest" data-testid="button-reset-placement">Reset layer position</button>}
          {showResetButton && !onResetPlacement && <button type="button" disabled={disabled} onClick={() => set({ athleteScale: 1, athleteX: 0, athleteY: 0 })} className="min-h-11 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest" data-testid="button-reset-placement">Reset placement</button>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-bold uppercase tracking-widest text-white/80">Jersey number
            <input value={appearance.jerseyNumber} maxLength={12} disabled={disabled} onChange={(e) => set({ jerseyNumber: e.target.value })} className="mt-1 h-11 w-full rounded border border-white/30 bg-white/10 px-3 text-sm normal-case tracking-normal text-white" data-testid="input-card-jersey" />
          </label>
          <label className="block text-xs font-bold uppercase tracking-widest text-white/80">Position
            <input value={appearance.position} maxLength={80} disabled={disabled} onChange={(e) => set({ position: e.target.value })} className="mt-1 h-11 w-full rounded border border-white/30 bg-white/10 px-3 text-sm normal-case tracking-normal text-white" data-testid="input-card-position" />
          </label>
        </div>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-white/80">Border color</p>
          {swatches(appearance.borderColor, setBorder, 'Border color presets and custom color', colorRow(appearance.borderColor, setBorder, 'Border'))}
        </div>
        <button type="button" disabled={disabled} onClick={() => onChange({ ...reset, jerseyNumber: appearance.jerseyNumber, position: appearance.position })} className="min-h-11 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest" data-testid="button-reset-appearance">Reset appearance</button>
      </>
    </div>
  );
}
