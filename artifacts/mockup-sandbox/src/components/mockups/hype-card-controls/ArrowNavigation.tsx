import { useMemo, useState } from 'react';
import { defaultCardAppearance, type HypeCardAppearance } from './_shared/hype-card-appearance';
import { buildHypeCardTemplateArtwork, isHypeCardTemplate } from './_shared/hype-card-template-artwork';
import { HypeCardAppearanceControls } from './_shared/hype-card-appearance-controls';
import './_group.css';

export function ArrowNavigation() {
  const [appearance, setAppearance] = useState<HypeCardAppearance>(defaultCardAppearance());
  const artwork = useMemo(() => buildHypeCardTemplateArtwork({
    frameTemplate: isHypeCardTemplate(appearance.design) ? appearance.design : 'velocity',
    lowerThirdTemplate: appearance.lowerThirdTemplate,
    athleteName: 'Jordan Lee',
    teamName: 'River FC',
    jerseyNumber: '17',
    position: 'Forward',
    borderColor: appearance.borderColor,
    accentColor: appearance.accentColor,
  }, 'all', 'hype-card-arrow-preview'), [appearance]);

  return (
    <main className="min-h-screen bg-[#0B1F3A] p-4 font-['DM_Sans'] text-white sm:p-6">
      <div className="mx-auto max-w-[760px] space-y-5">
        <header className="border-b border-white/15 pb-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#55A4FF]">Hype Card walkthrough</p>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 text-[10px] font-bold uppercase tracking-wider">
            {['1. Media', '2. Design', '3. Review'].map((step, index) => (
              <span key={step} className={`shrink-0 border px-2 py-2 ${index === 0 ? 'border-[#2878F5] bg-[#2878F5]' : 'border-white/20 text-white/60'}`}>{step}</span>
            ))}
          </div>
        </header>
        <section className="grid gap-5 rounded-xl border border-white/15 bg-[#10243D] p-4 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div>
            <h2 className="mb-1 font-['Barlow_Condensed'] text-xl font-extrabold uppercase tracking-wide">Design</h2>
            <p className="mb-4 text-xs text-white/65">Move through frame and lower-third designs with the arrows.</p>
            <HypeCardAppearanceControls appearance={appearance} onChange={setAppearance} showAthleteSize={false} showResetButton={false} pickerMode="arrows" />
          </div>
          <div className="mx-auto w-full max-w-[180px] overflow-hidden rounded-lg border border-white/20 bg-[#071A30]" aria-label="Live HYPE Card preview">
            <div className="aspect-[3/4] [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: artwork }} />
          </div>
        </section>
      </div>
    </main>
  );
}
