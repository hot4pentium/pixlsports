import { useId } from 'react';

import { buildHypeCardSvg } from './hype-card-svg';
import { normalizeHypeCardProject } from './hype-card-types';

export function HypeCardThumbnail({ project, name }: { project: unknown; name: string }) {
  const namespace = `recent-${useId().replace(/[^a-z0-9_-]/gi, '')}`;
  const normalizedProject = normalizeHypeCardProject(project);

  return (
    <div
      role="img"
      aria-label={`${name} design preview`}
      className="h-full w-full bg-[#090d14] [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: buildHypeCardSvg(normalizedProject, 'all', namespace) }}
    />
  );
}