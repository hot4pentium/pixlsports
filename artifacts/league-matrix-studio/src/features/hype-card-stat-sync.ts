import type { HypeCardProject } from './hype-card-types';

export function applyLatestLinkedStat(project: HypeCardProject, latestStat: string): HypeCardProject {
  const source = project.statSource;
  if (!source || project.stat !== source.lastGeneratedStat || !latestStat) return project;
  if (latestStat === source.lastGeneratedStat) return project;
  return {
    ...project,
    stat: latestStat,
    statSource: { ...source, lastGeneratedStat: latestStat },
  };
}