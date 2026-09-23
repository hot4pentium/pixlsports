import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export const basePath = import.meta.env.BASE_URL;

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <img
      src={`${basePath}assets/pixlsports-logo.png`}
      alt="Pixl Sports"
      className={small ? 'h-[4.4vh] w-auto object-contain' : 'h-[8vh] w-auto object-contain'}
    />
  );
}

export function TopBar({ label, step }: { label: string; step: string }) {
  return (
    <div className="absolute left-[6vw] right-[6vw] top-[5.5vh] z-30 flex items-center justify-between">
      <Logo small />
      <div className="flex items-center gap-[1.7vw]">
        <span className="font-mono text-[1.35vh] font-bold uppercase tracking-[.22em] text-text-muted">{label}</span>
        <span className="rounded-full border border-primary/45 px-[1.8vw] py-[.7vh] font-mono text-[1.3vh] font-bold text-primary">{step}</span>
      </div>
    </div>
  );
}

export function DotField() {
  return (
    <div className="pointer-events-none absolute inset-0 opacity-30">
      <div className="absolute left-[-10vw] top-[18vh] h-[58vw] w-[58vw] rounded-full border border-primary/20" />
      <div className="absolute right-[-24vw] bottom-[10vh] h-[76vw] w-[76vw] rounded-full border border-accent/10" />
      <div className="absolute inset-x-0 top-0 h-full opacity-40" style={{ backgroundImage: 'radial-gradient(var(--color-primary) 1px, transparent 1px)', backgroundSize: '4.2vw 4.2vw' }} />
    </div>
  );
}

export function TapCue({ x, y, label = 'TAP' }: { x: string; y: string; label?: string }) {
  return (
    <motion.div
      className="pointer-events-none absolute z-50 flex items-center gap-[1.4vw]"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: .65 }}
      animate={{ opacity: [0, 1, 1, 0], scale: [.65, 1, 1.08, 1.18] }}
      transition={{ duration: 1.6, times: [0, .18, .65, 1], repeat: Infinity, repeatDelay: .65 }}
    >
      <span className="relative grid h-[6vw] w-[6vw] place-items-center rounded-full border-[.45vw] border-accent bg-bg-dark/75 shadow-[0_0_0_1vw_rgba(255,100,51,.12)]">
        <span className="h-[1.25vw] w-[1.25vw] rounded-full bg-accent" />
      </span>
      <span className="rounded-full bg-accent px-[1.8vw] py-[.7vh] font-mono text-[1.45vh] font-bold tracking-[.15em] text-bg-dark">{label}</span>
    </motion.div>
  );
}

export function Phone({
  children,
  accent = 'var(--color-primary)',
  className = '',
}: { children: ReactNode; accent?: string; className?: string }) {
  return (
    <div className={`relative h-[68vh] w-[72vw] max-w-[44vh] rounded-[6vw] border-[.55vw] border-secondary/20 bg-bg-muted p-[1.1vw] phone-shadow ${className}`}>
      <div className="absolute left-1/2 top-[1vh] z-20 h-[2.2vh] w-[24vw] max-w-[15vh] -translate-x-1/2 rounded-full bg-bg-dark" />
      <div className="relative h-full w-full overflow-hidden rounded-[5vw] bg-bg-light">
        <div className="absolute left-0 right-0 top-0 z-10 flex h-[4.1vh] items-end justify-between px-[4vw] pb-[.7vh] text-[1.2vh] font-bold text-text-primary">
          <span>9:41</span><span className="tracking-[.2em]">● ● ▮</span>
        </div>
        {children}
        <div className="absolute bottom-[.8vh] left-1/2 z-20 h-[.45vh] w-[26vw] max-w-[15vh] -translate-x-1/2 rounded-full" style={{ backgroundColor: accent }} />
      </div>
    </div>
  );
}

export function MiniHeader({ title, eyebrow = 'PIXl SPORTS' }: { title: string; eyebrow?: string }) {
  return (
    <div className="flex items-end justify-between border-b border-text-secondary/20 px-[4vw] pb-[1.8vh] pt-[6.5vh]">
      <div>
        <div className="font-mono text-[1.2vh] font-bold uppercase tracking-[.17em] text-accent">{eyebrow}</div>
        <div className="mt-[.3vh] font-display text-[4.4vh] leading-[0.9] tracking-wide text-text-primary">{title}</div>
      </div>
      <div className="grid h-[4.4vh] w-[4.4vh] place-items-center rounded-full bg-secondary/10 text-[2.3vh] text-text-primary">+</div>
    </div>
  );
}