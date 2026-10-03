import { useMemo } from 'react';
import { Check } from 'lucide-react';

import { buildHypeCardSvg } from './hype-card-svg';
import { cardFinishes, type CardFinishId, type HypeCardProject } from './hype-card-types';

function CardFinishOption({
  finish,
  project,
  selected,
  onSelect,
}: {
  finish: (typeof cardFinishes)[number];
  project: HypeCardProject;
  selected: boolean;
  onSelect: () => void;
}) {
  const ns = `finish-preview-${finish.id}`;
  const svg = useMemo(
    () => buildHypeCardSvg({
      ...project,
      format: 'card',
      finish: finish.id,
      mediaType: null,
      photo: null,
      breakoutEnabled: false,
      breakoutCutout: null,
    }, 'all', ns),
    [finish.id, ns, project],
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Choose ${finish.name} card design`}
      className={`group flex min-h-36 gap-4 overflow-hidden border p-3 text-left transition-all clip-angled-sm ${selected ? 'border-primary bg-primary/10 ring-2 ring-primary ring-offset-2 ring-offset-background' : 'border-border bg-background hover:border-foreground'}`}
      data-testid={`button-card-design-${finish.id}`}
    >
      <span className="relative aspect-[5/7] w-20 shrink-0 overflow-hidden bg-muted clip-angled-sm">
        <span className="absolute inset-0 bg-tech-grid opacity-30 pointer-events-none" />
        <span className="hype-svg-preview absolute inset-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        {selected && <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center bg-primary text-primary-foreground shadow-md clip-angled-sm"><Check className="h-3.5 w-3.5" /></span>}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center py-1">
        <span className="text-sm font-bold uppercase tracking-wider">{finish.name}</span>
        <span className="mt-2 block text-xs font-medium leading-relaxed text-muted-foreground">{finish.summary}</span>
        <span className={`mt-3 text-[10px] font-bold uppercase tracking-widest ${selected ? 'text-primary' : 'text-muted-foreground'}`}>
          {selected ? 'Selected design' : 'Choose design'}
        </span>
      </span>
    </button>
  );
}

export function CardFinishOptions({
  project,
  onFinishChange,
}: {
  project: HypeCardProject;
  onFinishChange: (finish: CardFinishId) => void;
}) {
  return (
    <div>
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-foreground">Card designs</h3>
        <p className="mt-1 text-xs font-medium leading-relaxed text-muted-foreground">Choose a visual style. The preview and export update together.</p>
      </div>
      <div className="grid grid-cols-1 gap-3" role="group" aria-label="Card designs" data-testid="group-card-designs">
        {cardFinishes.map((finish) => (
          <CardFinishOption
            key={finish.id}
            finish={finish}
            project={project}
            selected={project.finish === finish.id}
            onSelect={() => onFinishChange(finish.id)}
          />
        ))}
      </div>
    </div>
  );
}