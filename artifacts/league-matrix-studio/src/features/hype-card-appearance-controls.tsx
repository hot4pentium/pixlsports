import { useEffect, useState, type ReactNode } from 'react';
import { appearanceSwatches, defaultCardAppearance, normalizeCardAppearance, type HypeCardAppearance, type HypeCardDesign } from './hype-card-appearance';

const designs: Array<{ id: HypeCardDesign; name: string; blurb: string }> = [
  { id: 'classic', name: 'Classic', blurb: 'Full-bleed photo with navy identity strip.' },
  { id: 'gallery', name: 'Gallery', blurb: 'Warm ivory paper, recessed photo window, athlete pops out.' },
  { id: 'spotlight', name: 'Spotlight', blurb: 'Night stadium poster, giant number, floating nameplate.' },
  { id: 'breakout', name: 'Breakout', blurb: 'Chrome stadium frame, raised athlete, bold nameplate.' },
];

function Thumb({ id, border, accent }: { id: HypeCardDesign; border: string; accent: string }) {
  if (id === 'gallery') return (
    <span aria-hidden="true" className="relative block h-full w-full rounded-md" style={{ background: '#F6EFE2', boxShadow: `inset 0 0 0 1px ${border}` }}>
      <span className="absolute left-[10%] right-[10%] top-[14%] h-[52%] rounded" style={{ background: 'linear-gradient(#8ec1ef,#8dbe5a 65%)', outline: '2px solid #FBF6EB' }} />
      <span className="absolute left-[8%] top-[10%] h-[14%] w-[16%] -rotate-6 rounded-sm" style={{ background: accent }} />
      <span className="absolute bottom-[14%] left-[14%] h-[8%] w-[60%] rounded-sm bg-[#10243D]" />
    </span>
  );
  if (id === 'spotlight') return (
    <span aria-hidden="true" className="relative block h-full w-full overflow-hidden rounded-md" style={{ background: 'linear-gradient(#0A1226,#1E3A2A)', boxShadow: `inset 0 0 0 2px ${border}` }}>
      <span className="absolute inset-x-0 top-[8%] text-center text-[34px] font-black leading-none" style={{ color: accent, opacity: .45 }}>07</span>
      <span className="absolute inset-x-[12%] bottom-[22%] h-[18%] rounded-sm bg-[#F6EFE2]" style={{ boxShadow: `3px 3px 0 ${accent}` }} />
    </span>
  );
  if (id === 'breakout') return (
    <span aria-hidden="true" className="relative block h-full w-full overflow-hidden rounded-md" style={{ background: 'radial-gradient(ellipse at 50% 36%,#35577f,#091527 72%)', boxShadow: `inset 0 0 0 2px ${border}` }}>
      <span className="absolute inset-x-[12%] top-[12%] h-[69%] rounded-md" style={{ border: '4px ridge #B7C4D4', boxShadow: `inset 0 0 0 2px ${accent},0 0 8px ${accent}` }} />
      <span className="absolute inset-x-[12%] bottom-[10%] h-[17%] bg-[#081429]" style={{ clipPath: 'polygon(10% 0,90% 0,100% 20%,100% 85%,90% 100%,10% 100%,0 85%,0 20%)', border: `2px solid ${accent}` }} />
    </span>
  );
  return (
    <span aria-hidden="true" className="relative block h-full w-full overflow-hidden rounded-md" style={{ background: 'linear-gradient(160deg,#35618f,#10243D)', boxShadow: 'inset 0 0 0 1px #ffffff40' }}>
      <span className="absolute inset-x-0 bottom-0 h-[26%] bg-[#10243D]/90" />
    </span>
  );
}

export function HypeCardDesignPicker({ appearance, onChange, disabled = false, variant = 'cards', className = '' }: {
  appearance: HypeCardAppearance;
  onChange: (next: HypeCardAppearance) => void;
  disabled?: boolean;
  variant?: 'cards' | 'compact';
  className?: string;
}) {
  const compact = variant === 'compact';
  const choose = (design: HypeCardDesign) => onChange(
    design === 'breakout' && appearance.design === 'classic'
      ? normalizeCardAppearance({ ...defaultCardAppearance('breakout'), jerseyNumber: appearance.jerseyNumber, position: appearance.position })
      : normalizeCardAppearance({ ...appearance, design }),
  );

  return (
    <fieldset className={className} disabled={disabled} data-testid={compact ? 'card-design-picker-compact' : 'card-design-picker-cards'}>
      <legend className={`${compact ? 'mb-2 text-[10px]' : 'mb-2 text-xs'} font-bold uppercase tracking-widest text-white/80`}>{compact ? 'Choose design' : 'Design'}</legend>
      <div className={`grid grid-cols-2 gap-2 ${compact ? '' : 'sm:grid-cols-4'}`}>
        {designs.map((design) => (
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
            {!compact && <span className="block aspect-[5/7] w-full"><Thumb id={design.id} border={appearance.borderColor} accent={appearance.accentColor} /></span>}
            <span className={compact ? '' : 'text-sm font-black'}>{design.name}</span>
            {!compact && <span className="text-[11px] leading-snug text-white/65">{design.blurb}</span>}
          </button>
        ))}
      </div>
    </fieldset>
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

export function HypeCardAppearanceControls({ appearance, onChange, disabled = false, placementActions, placementLabel = 'Athlete placement', showAthleteSize = true, showResetButton = true, onResetPlacement, canEnableBackgroundRemoval = true, onEnableBackgroundRemoval, designPickerClassName = '' }: { appearance: HypeCardAppearance; onChange: (next: HypeCardAppearance) => void; disabled?: boolean; placementActions?: ReactNode; placementLabel?: string; showAthleteSize?: boolean; showResetButton?: boolean; onResetPlacement?: () => void; canEnableBackgroundRemoval?: boolean; onEnableBackgroundRemoval?: () => void; designPickerClassName?: string }) {
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
  const premium = appearance.design !== 'classic';
  const reset = defaultCardAppearance(appearance.design);
  return (
    <div className="space-y-6 text-white" data-testid="hype-card-appearance-controls">
      <HypeCardDesignPicker appearance={appearance} onChange={onChange} disabled={disabled} className={designPickerClassName} />
      {premium && <>
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-white/80">{placementLabel}</p>
          {placementActions}
          {showAthleteSize && range('Size', appearance.athleteScale, .65, 1.2, .01, 'athleteScale', (v) => `${Math.round(v * 100)}%`)}
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
        <div className="rounded-lg border border-white/15 bg-white/5 p-3">
          <label className="flex min-h-11 items-center gap-3 text-sm font-bold" data-testid="toggle-remove-background">
            <input type="checkbox" className="h-5 w-5" checked={appearance.removeBackground} disabled={disabled || (!appearance.removeBackground && !canEnableBackgroundRemoval)} onChange={(e) => {
              const enabled = e.target.checked;
              set({ removeBackground: enabled });
              if (enabled && !appearance.removeBackground) onEnableBackgroundRemoval?.();
            }} />
            Remove photo background
          </label>
          <p className="text-xs leading-relaxed text-white/65">Checking starts local background removal when a cutout is needed. Turn it off to use the full original photo; the original is always kept.</p>
        </div>
        <button type="button" disabled={disabled} onClick={() => onChange({ ...reset, jerseyNumber: appearance.jerseyNumber, position: appearance.position })} className="min-h-11 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest" data-testid="button-reset-appearance">Reset appearance</button>
      </>}
    </div>
  );
}
