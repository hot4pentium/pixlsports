import { useEffect, useState, type ReactNode } from 'react';
import { appearanceSwatches, defaultCardAppearance, normalizeCardAppearance, type HypeCardAppearance, type HypeCardDesign } from './hype-card-appearance';

const designs: Array<{ id: HypeCardDesign; name: string; blurb: string }> = [
  { id: 'classic', name: 'Classic', blurb: 'Full-bleed photo with navy identity strip.' },
  { id: 'gallery', name: 'Gallery', blurb: 'Warm ivory paper, recessed photo window, athlete pops out.' },
  { id: 'spotlight', name: 'Spotlight', blurb: 'Night stadium poster, giant number, floating nameplate.' },
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
  return (
    <span aria-hidden="true" className="relative block h-full w-full overflow-hidden rounded-md" style={{ background: 'linear-gradient(160deg,#35618f,#10243D)', boxShadow: 'inset 0 0 0 1px #ffffff40' }}>
      <span className="absolute inset-x-0 bottom-0 h-[26%] bg-[#10243D]/90" />
    </span>
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

export function HypeCardAppearanceControls({ appearance, onChange, disabled = false, placementActions }: { appearance: HypeCardAppearance; onChange: (next: HypeCardAppearance) => void; disabled?: boolean; placementActions?: ReactNode }) {
  const set = (patch: Partial<HypeCardAppearance>) => onChange(normalizeCardAppearance({ ...appearance, ...patch }));
  const setBorder = (c: string) => set(appearance.accentLinked ? { borderColor: c, accentColor: c } : { borderColor: c });
  const swatches = (current: string, apply: (c: string) => void, label: string) => (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {appearanceSwatches.map(([name, color]) => (
        <button key={color} type="button" disabled={disabled} aria-label={name} aria-pressed={current.toUpperCase() === color} title={name}
          onClick={() => apply(color)} className="h-11 w-11 rounded-full border-2 border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-pressed:border-white aria-pressed:ring-2 aria-pressed:ring-white"
          style={{ background: color }} />
      ))}
    </div>
  );
  const colorRow = (current: string, apply: (c: string) => void, label: string) => (
    <div className="mt-3 flex items-center gap-3">
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
      <fieldset disabled={disabled}>
        <legend className="mb-2 text-xs font-bold uppercase tracking-widest text-white/80">Design</legend>
        <div className="grid grid-cols-3 gap-2">
          {designs.map((d) => (
            <button key={d.id} type="button" aria-pressed={appearance.design === d.id} onClick={() => set({ design: d.id })}
              className="flex min-h-11 flex-col gap-2 rounded-lg border border-white/25 p-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white aria-pressed:border-white aria-pressed:bg-white/15" data-testid={`button-design-${d.id}`}>
              <span className="block aspect-[5/7] w-full"><Thumb id={d.id} border={appearance.borderColor} accent={appearance.accentColor} /></span>
              <span className="text-sm font-black">{d.name}</span>
              <span className="text-[11px] leading-snug text-white/65">{d.blurb}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {premium && <>
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
          {swatches(appearance.borderColor, setBorder, 'Border color presets')}
          {colorRow(appearance.borderColor, setBorder, 'Border')}
        </div>
        <div>
          <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
            <input type="checkbox" className="h-5 w-5" checked={appearance.accentLinked} onChange={(e) => set(e.target.checked ? { accentLinked: true, accentColor: appearance.borderColor } : { accentLinked: false })} />
            Accent matches border
          </label>
          {!appearance.accentLinked && <div className="mt-2">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-white/80">Accent color</p>
            {swatches(appearance.accentColor, (c) => set({ accentColor: c }), 'Accent color presets')}
            {colorRow(appearance.accentColor, (c) => set({ accentColor: c }), 'Accent')}
          </div>}
        </div>
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-white/80">Athlete placement</p>
          {placementActions}
          {range('Size', appearance.athleteScale, .65, 1.45, .01, 'athleteScale', (v) => `${Math.round(v * 100)}%`)}
          <button type="button" disabled={disabled} onClick={() => set({ athleteScale: 1, athleteX: 0, athleteY: 0 })} className="min-h-11 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest" data-testid="button-reset-placement">Reset placement</button>
        </div>
        <button type="button" disabled={disabled} onClick={() => onChange({ ...reset, jerseyNumber: appearance.jerseyNumber, position: appearance.position })} className="min-h-11 rounded border border-white/30 px-4 text-xs font-bold uppercase tracking-widest" data-testid="button-reset-appearance">Reset appearance</button>
      </>}
    </div>
  );
}
