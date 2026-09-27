import { useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getListProjectsQueryKey,
  useCreateProject,
  useListProjects,
  useUpdateProject,
} from '@workspace/api-client-react';
import { getGuestUsageKey } from './guest-access';
import { getUserProfile } from './supporter-dashboard-model';
import {
  applyFinalGameCorrection,
  combineTrackerReviewHistory,
  getTrackerStorageKeys,
  normalizeTrackerData,
  readStoredTrackerConflict,
  readStoredTrackerData,
  trackerPayload,
  type FinalGameCorrectionInput,
  type StatTrackerData,
} from './stat-tracker';
import { SeasonStatsView } from './season-stats-view';

function gameSnapshot(game: unknown) {
  return JSON.stringify(game, (_key, value) => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value
  ));
}

export function SeasonStatsPage() {
  const { user, isLoaded } = useUser();
  const accountId = user?.id;
  const profile = getUserProfile(user);
  const queryClient = useQueryClient();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const [localData, setLocalData] = useState<StatTrackerData>({ version: 1, games: [] });
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null);
  const activeAccountId = useRef(accountId);
  activeAccountId.current = accountId;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(() => (
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('gameId')
  ));
  const { data: projects, isLoading, isError, refetch } = useListProjects({
    query: {
      enabled: Boolean(accountId),
      queryKey: [...getListProjectsQueryKey(), accountId],
      staleTime: 0,
    },
  });

  useEffect(() => {
    setLocalData(accountId ? readStoredTrackerData(window.localStorage, accountId) : { version: 1, games: [] });
    setLoadedAccountId(accountId ?? null);
    setSaveError('');
    setSaveMessage('');
    setSaving(false);
  }, [accountId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedGameId) url.searchParams.set('gameId', selectedGameId);
    else url.searchParams.delete('gameId');
    window.history.replaceState(window.history.state, '', url);
  }, [selectedGameId]);

  const cloudProject = projects
    ?.filter((item) => item.project.tool === 'stat-tracker')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  const cloudData = useMemo(() => normalizeTrackerData(cloudProject?.project), [cloudProject]);
  const games = useMemo(() => (
    accountId && loadedAccountId === accountId ? combineTrackerReviewHistory(localData, cloudData).games : []
  ), [accountId, loadedAccountId, localData, cloudData]);

  const onSaveCorrection = async (gameId: string, input: FinalGameCorrectionInput) => {
    setSaveError('');
    setSaveMessage('');
    if (!accountId) throw new Error('Sign in to edit final stats.');
    if (readStoredTrackerConflict(window.localStorage, accountId)) {
      const message = 'Resolve the pending tracker history conflict before editing final stats.';
      setSaveError(message);
      throw new Error(message);
    }
    const selected = games.find((game) => game.id === gameId && game.status === 'final');
    if (!selected) {
      const message = 'This completed game is no longer available. Refresh the page and try again.';
      setSaveError(message);
      throw new Error(message);
    }
    // Validate before making a network request or changing either copy of history.
    const corrected = applyFinalGameCorrection(selected, input);
    setSaving(true);
    try {
      const refreshed = await refetch();
      if (activeAccountId.current !== accountId) return;
      if (refreshed.isError || !refreshed.data) throw new Error('Could not check the latest account history. Reconnect and try again.');
      const latest = refreshed.data
        .filter((item) => item.project.tool === 'stat-tracker')
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
      const latestData = normalizeTrackerData(latest?.project);
      const latestGame = latestData.games.find((game) => game.id === gameId);
      if (latestGame && gameSnapshot(latestGame) !== gameSnapshot(selected)) {
        throw new Error('This game changed on another device. Refresh the page to review the newer version before saving.');
      }
      const latestLocal = readStoredTrackerData(window.localStorage, accountId);
      // Never replace an unsynced same-ID game while saving an unrelated correction.
      for (const localGame of latestLocal.games) {
        const cloudGame = latestData.games.find((game) => game.id === localGame.id);
        if (cloudGame && gameSnapshot(localGame) !== gameSnapshot(cloudGame)) {
          throw new Error('This device has tracker changes that differ from your account history. Open Stat Tracker to review and sync them before correcting a final.');
        }
      }
      const localGame = latestLocal.games.find((game) => game.id === gameId);
      if (localGame && gameSnapshot(localGame) !== gameSnapshot(localData.games.find((game) => game.id === gameId))) {
        throw new Error('This game changed on this device while you were editing. Refresh before saving.');
      }
      const next = combineTrackerReviewHistory(latestLocal, latestData);
      next.games = next.games.map((game) => game.id === gameId ? corrected : game);
      const savedProject = latest
        ? await updateProject.mutateAsync({
          projectId: latest.id,
          data: { project: trackerPayload(next), expectedRevision: latest.revision },
        })
        : await createProject.mutateAsync({
          data: {
            name: `${profile.athleteName || 'Athlete'} — Stat Tracker`,
            project: trackerPayload(next),
            guestUsageKey: getGuestUsageKey('lineup', 'stat-tracker'),
          },
        });
      queryClient.setQueryData([...getListProjectsQueryKey(), accountId], (current: typeof projects) => (
        current ? [savedProject, ...current.filter((item) => item.id !== savedProject.id)] : [savedProject]
      ));
      if (activeAccountId.current !== accountId) return;
      try {
        window.localStorage.setItem(getTrackerStorageKeys(accountId).history, JSON.stringify(next));
      } catch {
        setSaveMessage('Correction synced to your account. Device storage is unavailable; reconnect to reload the saved version.');
      }
      if (activeAccountId.current !== accountId) return;
      setLocalData(next);
      setSaveMessage((current) => current || 'Final stats saved to your account. Shared stats will use this corrected game.');
      void queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    } catch (error) {
      const message = error && typeof error === 'object' && 'status' in error && error.status === 409
        ? 'Another save changed this tracker history. Refresh the page and review the latest game before trying again.'
        : error instanceof Error ? error.message : 'Final stats could not be saved. Your edits remain in the form; try again.';
      if (activeAccountId.current === accountId) setSaveError(message);
      throw new Error(message);
    } finally {
      if (activeAccountId.current === accountId) setSaving(false);
    }
  };

  if (isLoaded && !accountId) {
    return <main className="min-h-screen bg-background p-6" role="status">Sign in to review your season stats. <Link href="/studio">Return to studio</Link></main>;
  }
  if (!isLoaded || loadedAccountId !== accountId) {
    return <main className="min-h-screen bg-background p-6" role="status">Loading your season stats…</main>;
  }
  return (
    <>
      {isLoading && <p className="sr-only" role="status">Checking saved account history…</p>}
      {isError && <p className="mx-auto max-w-6xl p-4 text-sm text-destructive" role="alert">Account history could not load. Local games are visible, but editing requires a connection.</p>}
      <SeasonStatsView
        games={games}
        athleteName={profile.athleteName || 'Your athlete'}
        teamName={profile.teamName || 'Your team'}
        selectedGameId={selectedGameId}
        onSelectGame={setSelectedGameId}
        onSaveCorrection={onSaveCorrection}
        saving={saving}
        saveMessage={saveMessage}
        saveError={saveError}
      />
    </>
  );
}