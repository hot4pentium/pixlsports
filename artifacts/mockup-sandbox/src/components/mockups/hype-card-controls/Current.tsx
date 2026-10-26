import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { defaultCardAppearance, type HypeCardAppearance } from './_shared/hype-card-appearance';
import { HypeCardAppearanceControls } from './_shared/hype-card-appearance-controls';
import './_group.css';

export function Current() {
  const [appearance, setAppearance] = useState<HypeCardAppearance>(defaultCardAppearance());
  return (
    <main className="min-h-screen bg-[#0B1F3A] p-4 font-['DM_Sans'] text-white sm:p-6">
      <div className="mx-auto max-w-[760px] space-y-5">
        <header className="border-b border-white/15 pb-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#55A4FF]">Hype Card walkthrough</p>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 text-[10px] font-bold uppercase tracking-wider">
            {['1. Moment', '2. Media', '3. Design', '4. Review'].map((step, index) => (
              <span key={step} className={`shrink-0 border px-2 py-2 ${index === 0 ? 'border-[#2878F5] bg-[#2878F5]' : 'border-white/20 text-white/60'}`}>{step}</span>
            ))}
          </div>
        </header>
        <section className="rounded-xl border border-white/15 bg-[#10243D] p-4">
          <h2 className="mb-4 font-['Barlow_Condensed'] text-xl font-extrabold uppercase tracking-wide">Moment</h2>
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-widest">Custom moment</span>
            <Input defaultValue="Big Play!" placeholder="Big Play!" className="h-12 border-white/20 bg-[#0B1F3A] text-white" />
          </label>
          <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-white/60">Type the moment you want on your card. For example: Big Play!</p>
        </section>
        <section className="rounded-xl border border-white/15 bg-[#10243D] p-4">
          <h2 className="mb-1 font-['Barlow_Condensed'] text-xl font-extrabold uppercase tracking-wide">Design</h2>
          <p className="mb-4 text-xs text-white/65">Choose a frame and lower-third style.</p>
          <HypeCardAppearanceControls appearance={appearance} onChange={setAppearance} showAthleteSize={false} showResetButton={false} />
        </section>
      </div>
    </main>
  );
}
