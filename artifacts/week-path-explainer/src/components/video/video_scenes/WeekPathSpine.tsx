import React from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, ClipboardCheck, Activity, Zap, Check } from 'lucide-react';

const steps = [
  { id: 0, num: '01', label: 'Plan the week', Icon: CalendarDays, theme: { active: 'text-sky-300 border-sky-300/70 bg-sky-300/10', completed: 'border-emerald-300/25 bg-emerald-300/[0.06] text-white/70', numActive: 'bg-sky-300 text-slate-950', iconActive: 'text-sky-300' } },
  { id: 1, num: '02', label: 'Prep', Icon: ClipboardCheck, theme: { active: 'text-amber-300 border-amber-300/70 bg-amber-300/10', completed: 'border-emerald-300/25 bg-emerald-300/[0.06] text-white/70', numActive: 'bg-amber-300 text-slate-950', iconActive: 'text-amber-300' } },
  { id: 2, num: '03', label: 'Capture the game', Icon: Activity, theme: { active: 'text-emerald-300 border-emerald-300/70 bg-emerald-300/10', completed: 'border-emerald-300/25 bg-emerald-300/[0.06] text-white/70', numActive: 'bg-emerald-300 text-slate-950', iconActive: 'text-emerald-300' } },
  { id: 3, num: '04', label: 'Send the hype', Icon: Zap, theme: { active: 'text-fuchsia-300 border-fuchsia-300/70 bg-fuchsia-300/10', completed: 'border-emerald-300/25 bg-emerald-300/[0.06] text-white/70', numActive: 'bg-fuchsia-300 text-slate-950', iconActive: 'text-fuchsia-300' } }
];

export const WeekPathSpine: React.FC<{ currentScene: number }> = ({ currentScene }) => {
  // We fade out the spine entirely on outro (scene 4)
  const isVisible = currentScene >= 0 && currentScene < 4;
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -50 }}
      animate={{ opacity: isVisible ? 1 : 0, x: isVisible ? 0 : -50 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="absolute top-0 bottom-0 left-0 w-[25vw] flex flex-col justify-center px-[4vw] z-20 pointer-events-none"
    >
      <div className="flex flex-col">
        <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-white/45 mb-4">Your week path</p>
        
        <div className="flex flex-col gap-2">
          {steps.map((step, index) => {
            const isActive = currentScene === step.id;
            const isCompleted = currentScene > step.id;
            
            // Default inactive state
            let containerClass = "border-white/10 bg-white/[0.03] text-white/45";
            let numClass = "bg-white/10 text-white/60";
            let iconClass = "text-white/35";
            
            if (isActive) {
              containerClass = `text-white ${step.theme.active}`;
              numClass = step.theme.numActive;
              iconClass = step.theme.iconActive;
            } else if (isCompleted) {
              containerClass = step.theme.completed;
              numClass = "bg-emerald-300 text-slate-950";
              iconClass = "text-white/35";
            }
            
            return (
              <motion.div
                key={step.id}
                layout
                initial={false}
                animate={{ scale: isActive ? 1.05 : 1, x: isActive ? 10 : 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className={`flex items-center gap-4 border px-4 py-4 text-left rounded-lg overflow-hidden shadow-lg ${containerClass}`}
              >
                <span className={`grid h-10 w-10 shrink-0 place-items-center text-sm font-bold rounded-full ${numClass}`}>
                  {isCompleted ? <Check className="h-5 w-5" /> : step.num}
                </span>
                <span className="min-w-0 text-sm font-bold uppercase tracking-widest">{step.label}</span>
                <step.Icon className={`h-5 w-5 shrink-0 ml-auto ${iconClass}`} />
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};
