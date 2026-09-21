import { useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  CalendarPlus,
  Check,
  Clipboard,
  ExternalLink,
  Link2,
  Radio,
  MapPin,
  Share2,
  Smartphone,
  Trophy,
  Trash2,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { Link } from 'wouter';
import {
  getListAthleteInvitesQueryKey,
  getGetAthleteInviteQueryKey,
  getListProjectsQueryKey,
  getListHypeCardSharesQueryKey,
  downloadHypeCardShare,
  useCreateAthleteInvite,
  useGetAthleteInvite,
  useListAthleteInvites,
  useListProjects,
  useListHypeCardShares,
  useDeleteHypeCardShare,
  useStartAthleteInviteLive,
  useStopAthleteInviteLive,
  useUpdateAthleteInvite,
  type AthleteInviteInput,
  type AthleteInviteScheduleEvent,
} from '@workspace/api-client-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { HypeCardReplyComposer } from './public-hype-card';
import { getActiveCarouselIndex } from './athlete-video-carousel';
import { getSportRule, type Sport } from './stat-tracker';
import { getUserProfile } from './supporter-dashboard-model';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const hostedVideoQuery = { shareMode: 'card' as const, mediaType: 'video' as const, limit: 10 };
const hostedImageQuery = { shareMode: 'card' as const, mediaType: 'image' as const, limit: 1 };

function defaultSeasonEnd() {
  const now = new Date();
  const year = now.getMonth() > 6 ? now.getFullYear() + 1 : now.getFullYear();
  return `${year}-12-31`;
}

function inputDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? defaultSeasonEnd() : parsed.toISOString().slice(0, 10);
}

function inviteUrl(token: string) {
  const origin = ['pixlsports.com', 'www.pixlsports.com'].includes(window.location.hostname.toLowerCase())
    ? 'https://pixlsports.com'
    : window.location.origin;
  return `${origin}${basePath}/player/${token}`;
}

function seasonEndIso(value: string) {
  return new Date(`${value}T23:59:59.999`).toISOString();
}

function hostedVideoLabels(manifest: unknown, fallbackTitle: string) {
  const source = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? manifest as Record<string, unknown>
    : {};
  const project = source.project && typeof source.project === 'object' && !Array.isArray(source.project)
    ? source.project as Record<string, unknown>
    : {};
  const label = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  return {
    title: label(project.headline) || fallbackTitle,
    jerseyNumber: label(project.jerseyNumber),
    position: label(project.position),
  };
}

export function AthleteInviteManager() {
  const { user, isLoaded, isSignedIn } = useUser();
  const queryClient = useQueryClient();
  const profile = getUserProfile(user);
  const { data: invites, isLoading } = useListAthleteInvites({
    query: { enabled: Boolean(isSignedIn), queryKey: getListAthleteInvitesQueryKey() },
  });
  const { data: projects } = useListProjects({ query: { enabled: Boolean(isSignedIn), queryKey: getListProjectsQueryKey() } });
  const existing = invites?.[0] ?? null;
  const trackerProjects = projects?.filter((project) => project.project.tool === 'stat-tracker') ?? [];
  const scheduleProjects = projects?.filter((project) => project.project.tool === 'schedule') ?? [];
  const defaultSport = profile.sport && profile.sport !== 'softball' ? profile.sport : 'basketball';
  const [athleteName, setAthleteName] = useState(profile.athleteName);
  const [teamName, setTeamName] = useState(profile.teamName);
  const [seasonName, setSeasonName] = useState(() => `Season ${new Date().getFullYear()}`);
  const [seasonEndsAt, setSeasonEndsAt] = useState(defaultSeasonEnd);
  const [sport, setSport] = useState<Exclude<Sport, 'softball'>>(defaultSport);
  const [trackerProjectId, setTrackerProjectId] = useState('none');
  const [scheduleProjectId, setScheduleProjectId] = useState('none');
  const [showHypeCard, setShowHypeCard] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [showSchedule, setShowSchedule] = useState(true);
  const [notice, setNotice] = useState('');
  const [hypeCardGuideOpen, setHypeCardGuideOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<'card' | 'page'>('page');
  const createInvite = useCreateAthleteInvite();
  const updateInvite = useUpdateAthleteInvite();
  const startLive = useStartAthleteInviteLive();
  const stopLive = useStopAthleteInviteLive();
  const deleteHypeCard = useDeleteHypeCardShare();
  const { data: hypeCardShares, isLoading: videosLoading } = useListHypeCardShares(hostedVideoQuery, {
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getListHypeCardSharesQueryKey(hostedVideoQuery),
      staleTime: 10_000,
      refetchOnMount: 'always',
    },
  });
  const { data: hostedImages, isLoading: imagesLoading } = useListHypeCardShares(hostedImageQuery, {
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getListHypeCardSharesQueryKey(hostedImageQuery),
      staleTime: 10_000,
      refetchOnMount: 'always',
    },
  });
  const hypeCardsLoading = videosLoading || imagesLoading;
  const hostedVideos = hypeCardShares ?? [];
  const hostedImage = hostedImages?.[0] ?? null;
  useEffect(() => {
    if (!existing) return;
    setAthleteName(existing.athleteName);
    setTeamName(existing.teamName);
    setSeasonName(existing.seasonName);
    setSeasonEndsAt(inputDate(existing.seasonEndsAt));
    setSport(existing.sport);
    setTrackerProjectId(existing.trackerProjectId ?? 'none');
    setScheduleProjectId(existing.scheduleProjectId ?? 'none');
    setShowHypeCard(existing.showHypeCard);
    setShowStats(existing.showStats);
    setShowSchedule(existing.showSchedule);
  }, [existing?.inviteToken]);

  useEffect(() => {
    if (existing || seasonName || !scheduleProjects.length) return;
    const schedule = scheduleProjects[0].project as { season?: unknown };
    if (typeof schedule.season === 'string') setSeasonName(schedule.season);
    setScheduleProjectId(scheduleProjects[0].id);
  }, [existing, scheduleProjects, seasonName]);

  useEffect(() => {
    if (existing || trackerProjectId !== 'none' || !trackerProjects.length) return;
    setTrackerProjectId(trackerProjects[0].id);
  }, [existing, trackerProjectId, trackerProjects]);

  if (!isLoaded || isLoading) return <InviteShell><p role="status" className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Loading athlete page…</p></InviteShell>;
  if (!isSignedIn) return <InviteShell><div className="max-w-lg text-center"><h1 className="font-display text-5xl uppercase">Sign in to manage the athlete page</h1><Link href="/sign-in" className="mt-6 inline-flex bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground">Sign in</Link></div></InviteShell>;

  const payload = (): AthleteInviteInput => ({
    athleteName: athleteName.trim(),
    teamName: teamName.trim(),
    seasonName: seasonName.trim(),
    seasonEndsAt: seasonEndIso(seasonEndsAt),
    sport,
    trackerProjectId: trackerProjectId === 'none' || !trackerProjects.some((project) => project.id === trackerProjectId)
      ? null
      : trackerProjectId,
    scheduleProjectId: scheduleProjectId === 'none' || !scheduleProjects.some((project) => project.id === scheduleProjectId)
      ? null
      : scheduleProjectId,
    showHypeCard,
    showStats: showStats && (trackerProjectId === 'none' || trackerProjects.some((project) => project.id === trackerProjectId)),
    showSchedule: showSchedule && (scheduleProjectId === 'none' || scheduleProjects.some((project) => project.id === scheduleProjectId)),
    paused: existing?.paused ?? false,
  });
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice('');
    if (!athleteName.trim() || !seasonName.trim()) {
      setNotice('Add the athlete name and season.');
      return;
    }
    try {
      if (existing) await updateInvite.mutateAsync({ inviteToken: existing.inviteToken, data: payload() });
      else await createInvite.mutateAsync({ data: payload() });
      await queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() });
      setNotice(existing ? 'Athlete page updated. The invite URL stayed the same.' : 'Athlete page created. The invite URL is ready.');
    } catch (error) {
      const detail = error && typeof error === 'object' && 'data' in error
        ? (error as { data?: { error?: string } }).data?.error
        : null;
      setNotice(detail || 'The athlete page could not be saved.');
    }
  };
  const copy = async () => {
    if (!existing) return;
    await navigator.clipboard.writeText(inviteUrl(existing.inviteToken));
    setNotice('Invite URL copied.');
  };
  const share = async () => {
    if (!existing) return;
    const url = inviteUrl(existing.inviteToken);
    if (navigator.share) await navigator.share({ title: `${existing.athleteName} athlete page`, text: `Follow ${existing.athleteName}'s season.`, url });
    else await copy();
  };
  const toggleAvailability = async () => {
    if (!existing) return;
    const paused = !existing.paused;
    try {
      await updateInvite.mutateAsync({ inviteToken: existing.inviteToken, data: { ...payload(), paused } });
      await queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() });
      setNotice(paused
        ? 'Hype Page paused. The same URL is ready to resume.'
        : 'Hype Page resumed. The same URL is live again.');
    } catch {
      setNotice('The Hype Page availability could not be changed.');
    }
  };
  const toggleLive = async () => {
    if (!existing) return;
    try {
      if (existing.liveTrackerShareToken) {
        await stopLive.mutateAsync({ inviteToken: existing.inviteToken });
        setNotice('Game Day Live stopped. The Hype Page now shows finalized stats.');
      } else {
        await startLive.mutateAsync({ inviteToken: existing.inviteToken });
        setNotice('Game Day Live started for this Hype Page.');
      }
      await queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() });
    } catch (error) {
      const detail = error && typeof error === 'object' && 'data' in error
        ? (error as { data?: { error?: string } }).data?.error
        : null;
      setNotice(detail || 'Game Day Live could not be changed. Start a live game in Stat Tracker first.');
    }
  };
  const downloadHostedVideo = async (video: { shareToken: string; slug: string }) => {
    setNotice('');
    try {
      const blob = await downloadHypeCardShare(video.shareToken, { responseType: 'blob' });
      const url = URL.createObjectURL(blob as Blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${video.slug}.${(blob as Blob).type === 'video/webm' ? 'webm' : 'mp4'}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice('Hosted video downloaded.');
    } catch {
      setNotice('The hosted video could not be downloaded.');
    }
  };
  const removeHostedVideo = async (video: { shareToken: string; title: string }) => {
    if (!window.confirm(`Remove “${video.title}” from the Athlete Hype Page? The page and its other content will stay available.`)) return;
    setNotice('');
    try {
      await deleteHypeCard.mutateAsync({ shareToken: video.shareToken });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListHypeCardSharesQueryKey(hostedVideoQuery) }),
        ...(existing
          ? [queryClient.invalidateQueries({ queryKey: getGetAthleteInviteQueryKey(existing.inviteToken) })]
          : []),
      ]);
      setNotice('Hosted video removed. The Athlete Hype Page and its other content were not changed.');
    } catch {
      setNotice('The hosted video could not be removed.');
    }
  };
  const downloadHostedImage = async (image: { shareToken: string; slug: string }) => {
    setNotice('');
    try {
      const blob = await downloadHypeCardShare(image.shareToken, { responseType: 'blob' }) as Blob;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${image.slug}.${blob.type === 'image/png' ? 'png' : 'jpg'}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice('Hosted image Hype Card downloaded.');
    } catch {
      setNotice('The hosted image Hype Card could not be downloaded.');
    }
  };
  const removeHostedImage = async (image: { shareToken: string; title: string }) => {
    if (!window.confirm(`Remove “${image.title}” from the Athlete Hype Page? The page and its other content will stay available.`)) return;
    setNotice('');
    try {
      await deleteHypeCard.mutateAsync({ shareToken: image.shareToken });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListHypeCardSharesQueryKey(hostedImageQuery) }),
        ...(existing
          ? [queryClient.invalidateQueries({ queryKey: getGetAthleteInviteQueryKey(existing.inviteToken) })]
          : []),
      ]);
      setNotice('Hosted image Hype Card removed. The Athlete Hype Page and its other content were not changed.');
    } catch {
      setNotice('The hosted image Hype Card could not be removed.');
    }
  };

  return (
    <InviteShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
        <div className="flex flex-col justify-between gap-5 border-l-4 border-primary pl-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Athlete Hype Page</p>
            <h1 className="mt-2 font-display text-5xl uppercase leading-none sm:text-6xl">One story. One stable link.</h1>
            <p className="mt-4 max-w-2xl text-sm font-medium leading-relaxed text-muted-foreground">Post video moments to one evolving Hype Page with finalized stats, schedule, replies, and optional Game Day Live.</p>
          </div>
          <Link href="/studio/profile" className="text-xs font-bold uppercase tracking-widest text-primary hover:underline">Profile settings</Link>
        </div>

        <section className="mt-8 grid items-start gap-4 md:grid-cols-2" aria-label="Sharing paths">
          <div className="border border-border bg-card transition-colors hover:border-primary">
            <button
              type="button"
              className="flex w-full items-start justify-between gap-4 p-5 text-left"
              aria-expanded={hypeCardGuideOpen}
              aria-controls="hype-card-creation-guide"
              onClick={() => {
                setSelectedPath('card');
                setHypeCardGuideOpen(true);
              }}
              aria-pressed={selectedPath === 'card'}
              data-testid="button-toggle-hype-card-guide"
            >
              <span>
                <span className="block text-[10px] font-bold uppercase tracking-[.2em] text-primary">Quick share</span>
                <span className="mt-2 block font-display text-3xl uppercase">Create a Hype Card</span>
                <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">Post video moments to this athlete’s highlight carousel.</span>
              </span>
              <ChevronDown className={`mt-2 h-5 w-5 shrink-0 text-primary transition-transform ${hypeCardGuideOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {hypeCardGuideOpen && (
              <div id="hype-card-creation-guide" className="border-t border-border px-5 pb-5 pt-4">
                <h3 className="text-xs font-bold uppercase tracking-widest">How it works</h3>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                  <li>Open the Hype Card editor and create the card.</li>
                  <li>Choose Post to Athlete Hype Page when the card is ready.</li>
                  <li>Return here to download or remove any hosted video.</li>
                </ol>
                <Link href="/studio/hype-card" className="mt-4 inline-flex min-h-10 items-center bg-primary px-4 text-xs font-bold uppercase tracking-widest text-primary-foreground" data-testid="link-create-hype-card">
                  Open Hype Card editor →
                </Link>
                <div className="mt-5 border-t border-border pt-4" aria-live="polite">
                  {hypeCardsLoading ? (
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Checking hosted videos…</p>
                  ) : hostedVideos.length > 0 ? (
                    <div data-testid="hosted-video-list">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Videos on Athlete Hype Page</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{hostedVideos.length} / 10</p>
                      </div>
                      <ul className="mt-3 divide-y divide-border border-y border-border">
                        {hostedVideos.map((video) => {
                          const labels = hostedVideoLabels(video.manifest, video.title);
                          const details = [labels.jerseyNumber ? `#${labels.jerseyNumber}` : '', labels.position].filter(Boolean).join(' · ');
                          return (
                            <li key={video.shareToken} className="py-4" data-testid="hosted-video-item">
                              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-bold" data-testid="hosted-video-title">{labels.title}</p>
                                  {details && <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{details}</p>}
                                  <p className="mt-1 text-[10px] text-muted-foreground">Posted {new Date(video.createdAt).toLocaleDateString()}</p>
                                </div>
                                <div className="flex shrink-0 flex-wrap gap-2">
                                  <Button type="button" variant="outline" className="rounded-none" onClick={() => void downloadHostedVideo(video)} data-testid="button-download-hosted-video">
                                    <Download className="mr-2 h-4 w-4" />Download
                                  </Button>
                                  <Button type="button" variant="outline" className="rounded-none text-destructive" onClick={() => void removeHostedVideo(video)} disabled={deleteHypeCard.isPending} data-testid="button-remove-hosted-video">
                                    <Trash2 className="mr-2 h-4 w-4" />Delete
                                  </Button>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-xs font-medium leading-relaxed text-muted-foreground">No hosted videos yet. Your Hype Page, stats, schedule, and replies stay available.</p>
                  )}
                  {hostedImage && (
                    <div className="mt-5 border-t border-border pt-4" data-testid="hosted-image-hype-card">
                      <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Image Hype Card outside the video carousel</p>
                      <p className="mt-2 text-sm font-bold">{hostedImage.title}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" variant="outline" className="rounded-none" onClick={() => void downloadHostedImage(hostedImage)}>
                          <Download className="mr-2 h-4 w-4" />Download image
                        </Button>
                        <Button type="button" variant="outline" className="rounded-none text-destructive" onClick={() => void removeHostedImage(hostedImage)} disabled={deleteHypeCard.isPending}>
                          <Trash2 className="mr-2 h-4 w-4" />Delete image
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            className={`border p-5 text-left transition-colors ${selectedPath === 'page' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary'}`}
            onClick={() => setSelectedPath('page')}
            aria-pressed={selectedPath === 'page'}
            data-testid="card-create-hype-page"
          >
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Evolving share</p>
            <h2 className="mt-2 font-display text-3xl uppercase">Create a Hype Page</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Keep this athlete’s story current at one stable URL.</p>
          </button>
        </section>

        {selectedPath === 'page' && existing && (
          <section className="mt-8 border border-primary/40 bg-primary/5 p-4 sm:p-5" aria-label="Active athlete invite">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link2 className="h-5 w-5 shrink-0 text-primary" />
              <input readOnly value={inviteUrl(existing.inviteToken)} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 border border-border bg-background px-3 py-3 text-xs font-medium" aria-label="Athlete invite URL" data-testid="input-athlete-invite-url" />
              <Button type="button" variant="outline" className="rounded-none" onClick={copy}><Clipboard className="mr-2 h-4 w-4" />Copy</Button>
              <Button type="button" className="rounded-none" onClick={share}><Share2 className="mr-2 h-4 w-4" />Share</Button>
              <Link href={`/player/${existing.inviteToken}`} target="_blank" className="inline-flex min-h-10 items-center justify-center border border-border px-3 text-xs font-bold uppercase tracking-widest"><ExternalLink className="mr-2 h-4 w-4" />Open</Link>
            </div>
            <p className="mt-3 text-xs font-medium text-muted-foreground">{existing.paused ? 'Paused — this stable URL is unavailable until you resume it.' : 'Live — this stable URL stays with the athlete for the life of the account.'} Updating the settings below does not change this URL.</p>
            <div className="mt-5 flex flex-wrap gap-3 border-t border-border pt-5">
              <Button type="button" variant={existing.paused ? 'default' : 'outline'} onClick={toggleAvailability} disabled={updateInvite.isPending} className="rounded-none text-[10px] font-bold uppercase tracking-widest">
                <Link2 className="mr-2 h-4 w-4" />{existing.paused ? 'Resume Hype Page' : 'Pause Hype Page'}
              </Button>
              <Button type="button" variant="outline" onClick={toggleLive} disabled={startLive.isPending || stopLive.isPending || existing.paused} className="rounded-none text-[10px] font-bold uppercase tracking-widest">
                <Radio className="mr-2 h-4 w-4" />{existing.liveTrackerShareToken ? 'Stop Game Day Live' : 'Start Game Day Live'}
              </Button>
            </div>
          </section>
        )}

        {selectedPath === 'page' && (
          <form onSubmit={save} className="mt-8 max-w-xl">
            <aside className="space-y-5">
              <section className="border border-border bg-card p-5" data-testid="section-visible-athlete-page">
                <h2 className="font-display text-2xl uppercase">Visible sections</h2>
                <Toggle label="Video highlights" detail="Shows up to 10 active videos, newest first." checked={showHypeCard} onChange={setShowHypeCard} />
                <Toggle label="Finalized stats" detail="Never exposes live tracker activity." checked={showStats} onChange={setShowStats} />
                <Toggle label="Upcoming schedule" detail="Uses event cards with Add to Calendar." checked={showSchedule} onChange={setShowSchedule} />
              </section>
              <Button type="submit" disabled={createInvite.isPending || updateInvite.isPending} className="h-12 w-full rounded-none text-xs font-bold uppercase tracking-widest"><Check className="mr-2 h-4 w-4" />{existing ? 'Update Hype Page' : 'Create Hype Page'}</Button>
              {notice && <p role="status" className="border-l-2 border-primary bg-primary/5 px-3 py-3 text-xs font-bold leading-relaxed">{notice}</p>}
            </aside>
          </form>
        )}
      </main>
    </InviteShell>
  );
}

export function PublicAthleteInvitePage({ params }: { params: { inviteToken?: string } }) {
  const inviteToken = params.inviteToken ?? '';
  const [localReplies, setLocalReplies] = useState<Array<{ reaction: string; message: string | null; createdAt: string }>>([]);
  const [trendStatId, setTrendStatId] = useState('');
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const videoCarouselRef = useRef<HTMLOListElement>(null);
  const { data: invite, isLoading, isError } = useGetAthleteInvite(inviteToken, {
    query: { enabled: Boolean(inviteToken), queryKey: getGetAthleteInviteQueryKey(inviteToken), retry: false },
  });
  useEffect(() => {
    setLocalReplies([]);
    setTrendStatId('');
    setActiveVideoIndex(0);
  }, [inviteToken]);
  useEffect(() => {
    if (!invite) return;
    const previous = document.title;
    document.title = `${invite.athleteName} | Pixl Sports`;
    return () => { document.title = previous; };
  }, [invite]);
  if (isLoading) return <PublicShell><p role="status" className="text-sm font-bold uppercase tracking-widest text-white/60">Loading athlete page…</p></PublicShell>;
  if (isError || !invite) return <PublicShell><div className="max-w-md text-center"><Zap className="mx-auto h-12 w-12 text-primary" /><h1 className="mt-5 font-display text-5xl uppercase">Athlete page unavailable</h1><p className="mt-3 text-sm font-medium leading-relaxed text-white/60">This invite may have ended, been revoked, or been copied incorrectly.</p></div></PublicShell>;
  const rule = getSportRule(invite.sport);
  const replies = [...localReplies, ...invite.replies];
  const trendOptions = invite.stats
    ? [
        { id: 'score', label: 'Points / runs' },
        ...Object.keys(invite.stats.stats).map((id) => ({
          id,
          label: rule.stats.find((item) => item.id === id)?.shortLabel ?? id.replaceAll('-', ' '),
        })),
      ]
    : [];
  const selectedTrend = trendOptions.find((option) => option.id === trendStatId);
  const trendGames = invite.stats?.games
    ? [...invite.stats.games].sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const trendValues = selectedTrend
    ? trendGames.map((game) => selectedTrend.id === 'score' ? game.score : game.stats[selectedTrend.id] ?? 0)
    : [];
  const trendMax = Math.max(1, ...trendValues);
  const latestTrend = trendValues.at(-1);
  const previousTrend = trendValues.at(-2);
  const trendDirection = latestTrend !== undefined && previousTrend !== undefined
    ? latestTrend > previousTrend ? 'up' : latestTrend < previousTrend ? 'down' : 'flat'
    : 'flat';
  const moveToVideo = (index: number) => {
    const nextIndex = Math.max(0, Math.min(invite.videos.length - 1, index));
    const carousel = videoCarouselRef.current;
    const item = carousel?.children.item(nextIndex) as HTMLElement | null;
    if (carousel && item) carousel.scrollTo({ left: item.offsetLeft - carousel.offsetLeft, behavior: 'smooth' });
    setActiveVideoIndex(nextIndex);
  };
  const updateActiveVideo = () => {
    const carousel = videoCarouselRef.current;
    if (!carousel) return;
    const items = Array.from(carousel.children) as HTMLElement[];
    setActiveVideoIndex(getActiveCarouselIndex({
      scrollLeft: carousel.scrollLeft,
      clientWidth: carousel.clientWidth,
      scrollWidth: carousel.scrollWidth,
      containerLeft: carousel.getBoundingClientRect().left,
      itemLefts: items.map((item) => item.getBoundingClientRect().left),
    }));
  };
  const keepOneVideoPlaying = (current: HTMLVideoElement) => {
    videoCarouselRef.current?.querySelectorAll('video').forEach((video) => {
      if (video !== current) video.pause();
    });
  };
  return (
    <div className="noise min-h-dvh bg-[#0B1F3A] text-white" data-testid="public-athlete-invite">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-9 sm:px-8 sm:py-12">
        <header className="border-l-4 border-primary pl-5">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">{invite.seasonName} · {rule.label}</p>
          <h1 className="mt-3 font-display text-6xl uppercase leading-[.85] sm:text-7xl">{invite.athleteName}</h1>
          <p className="mt-4 text-sm font-bold uppercase tracking-widest text-white/45">{invite.teamName || 'Athlete season page'}</p>
        </header>

        <section className="athlete-highlights-panel mt-10 p-4 sm:p-6" aria-labelledby="athlete-video-highlights">
          <div className="athlete-highlights-heading flex items-end justify-between gap-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Featured moments</p>
              <h2 id="athlete-video-highlights" className="mt-2 font-display text-4xl uppercase leading-none sm:text-5xl">Video highlights</h2>
              <p className="mt-3 max-w-md text-xs font-medium leading-relaxed text-white/55">The latest plays, captured and ready to replay.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {invite.videos.length > 1 && (
                <>
                  <button type="button" onClick={() => moveToVideo(activeVideoIndex - 1)} disabled={activeVideoIndex === 0} className="grid h-11 w-11 place-items-center border border-white/20 text-white transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30" aria-label="Previous video" data-testid="button-previous-athlete-video"><ChevronLeft className="h-5 w-5" /></button>
                  <span className="min-w-12 text-center text-[10px] font-bold uppercase tracking-widest text-white/50" aria-live="polite">{activeVideoIndex + 1} / {invite.videos.length}</span>
                  <button type="button" onClick={() => moveToVideo(activeVideoIndex + 1)} disabled={activeVideoIndex === invite.videos.length - 1} className="grid h-11 w-11 place-items-center border border-white/20 text-white transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30" aria-label="Next video" data-testid="button-next-athlete-video"><ChevronRight className="h-5 w-5" /></button>
                </>
              )}
            </div>
          </div>
          {invite.videos.length > 0 ? (
            <ol
              ref={videoCarouselRef}
              className="athlete-video-carousel mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              aria-label="Athlete video highlights"
              tabIndex={0}
              onScroll={updateActiveVideo}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  moveToVideo(activeVideoIndex - 1);
                }
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  moveToVideo(activeVideoIndex + 1);
                }
              }}
              data-testid="athlete-video-carousel"
            >
              {invite.videos.map((video, index) => {
                const details = [video.jerseyNumber ? `#${video.jerseyNumber}` : '', video.position].filter(Boolean).join(' · ');
                return (
                  <li key={video.shareToken} className="w-[82%] shrink-0 snap-start sm:w-[58%] lg:w-[50%]" aria-label={`Video ${index + 1} of ${invite.videos.length}`} data-testid="athlete-video-slide">
                    <div className="athlete-video-stage">
                      <div className="athlete-video-frame">
                        <video
                          src={video.videoUrl}
                          poster={video.posterUrl ?? undefined}
                          controls
                          playsInline
                          preload="metadata"
                          aria-label={`Play ${video.title}`}
                          className="aspect-video w-full bg-black object-contain"
                          onPlay={(event) => keepOneVideoPlaying(event.currentTarget)}
                          data-testid="athlete-video-player"
                        />
                      </div>
                      {video.posterUrl && (
                        <div
                          aria-hidden="true"
                          className="athlete-video-reflection"
                          style={{ backgroundImage: `url("${video.posterUrl}")` }}
                          data-testid="athlete-video-reflection"
                        />
                      )}
                    </div>
                    <div className="border-l-2 border-primary px-4 py-4">
                      <p className="text-[9px] font-bold uppercase tracking-[.2em] text-primary">Moment {String(index + 1).padStart(2, '0')}</p>
                      <h3 className="mt-2 font-display text-3xl uppercase leading-none">{video.title}</h3>
                      {details && <p className="mt-3 text-xs font-bold uppercase tracking-[.16em] text-white/55">{details}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="mt-5 border border-white/10 bg-white/5 p-7" data-testid="athlete-video-empty-state">
              <p className="font-display text-3xl uppercase">Highlights are coming</p>
              <p className="mt-2 text-sm text-white/50">Check back after the next big moment.</p>
            </div>
          )}
        </section>

        {invite.liveGame && (
          <section className="mt-6 flex flex-col gap-4 border border-primary/50 bg-primary/10 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" aria-labelledby="athlete-game-day-live">
            <div>
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-primary"><Radio className="h-4 w-4" /> Game Day Live</p>
              <h2 id="athlete-game-day-live" className="mt-2 font-display text-3xl uppercase">Follow this game now</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/60">A short-lived live scoreboard is active. When it ends, this page returns to finalized stats.</p>
            </div>
            <Link href={`/live/${invite.liveGame.shareToken}`} className="inline-flex min-h-11 items-center justify-center gap-2 border border-primary px-5 text-xs font-bold uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground">Open live scoreboard <ExternalLink className="h-4 w-4" /></Link>
          </section>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            {invite.stats && (
              <section className="border border-white/10 bg-white/5 p-5 sm:p-7" aria-labelledby="athlete-season-stats">
                <div className="flex items-center justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Finalized only</p><h2 id="athlete-season-stats" className="mt-2 font-display text-3xl uppercase">Season stats</h2></div><Trophy className="h-8 w-8 text-primary" /></div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Games" value={invite.stats.gamesPlayed} primary />
                  <Stat label="Points / runs" value={invite.stats.score} />
                  {Object.entries(invite.stats.stats).map(([id, value]) => <Stat key={id} label={rule.stats.find((item) => item.id === id)?.shortLabel ?? id.replaceAll('-', ' ')} value={value} />)}
                </div>
                 {trendOptions.length > 0 && (
                   <div className="mt-6 border-t border-white/10 pt-5" data-testid="athlete-stat-trends">
                     <label htmlFor="athlete-trend-stat" className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Show trends</label>
                     <select
                       id="athlete-trend-stat"
                       value={trendStatId}
                       onChange={(event) => setTrendStatId(event.target.value)}
                       className="mt-2 h-11 w-full border border-white/15 bg-black/25 px-3 text-sm font-bold text-white outline-none focus:border-primary"
                       data-testid="select-athlete-trend-stat"
                     >
                       <option value="">Choose a stat</option>
                       {trendOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                     </select>
                     {selectedTrend && (
                       <div className="mt-4" data-testid="athlete-stat-trend-details">
                         <div className="flex items-center justify-between gap-3">
                           <p className="text-xs font-bold uppercase tracking-widest text-white/65">{selectedTrend.label} by game</p>
                           <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white/45">
                             {trendDirection === 'up' ? <TrendingUp className="h-3.5 w-3.5 text-primary" /> : trendDirection === 'down' ? <TrendingDown className="h-3.5 w-3.5 text-amber-300" /> : null}
                             {trendDirection === 'up' ? 'Up lately' : trendDirection === 'down' ? 'Down lately' : 'Steady'}
                           </p>
                         </div>
                         <ol className="mt-3 space-y-3">
                           {trendGames.map((game, index) => {
                             const value = trendValues[index] ?? 0;
                             return (
                               <li key={`${game.date}-${game.opponent}-${index}`} className="flex items-center gap-3">
                                 <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-widest text-white/40">{game.date ? new Date(`${game.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : `Game ${index + 1}`}</span>
                                 <div className="h-2 min-w-0 flex-1 bg-white/10">
                                   <div className="h-full bg-primary" style={{ width: `${Math.max(6, (value / trendMax) * 100)}%` }} />
                                 </div>
                                 <span className="w-8 text-right font-display text-lg text-white">{value}</span>
                               </li>
                             );
                           })}
                         </ol>
                       </div>
                     )}
                   </div>
                 )}
                <p className="mt-4 text-right text-[9px] font-bold uppercase tracking-widest text-white/30">Updated {new Date(invite.stats.updatedAt).toLocaleDateString()}</p>
              </section>
            )}
            {invite.scheduleEvents.length > 0 && (
              <section aria-labelledby="athlete-upcoming-events">
                <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">What’s next</p>
                <h2 id="athlete-upcoming-events" className="mt-2 font-display text-4xl uppercase">Upcoming events</h2>
                <ol className="mt-5 grid gap-4 sm:grid-cols-2">
                  {invite.scheduleEvents.map((event) => <EventCard key={event.id} event={event} teamName={invite.teamName} />)}
                </ol>
              </section>
            )}
            {invite.videos[0] && (
              <section className="border border-primary/40 bg-primary/10 p-5 sm:p-7" aria-labelledby="athlete-reply-composer">
                <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">For the athlete</p>
                <h2 id="athlete-reply-composer" className="mt-2 font-display text-3xl uppercase">Send some hype</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/60">Choose a reaction and add an optional message without leaving this athlete page.</p>
                <HypeCardReplyComposer
                  shareToken={invite.videos[0].shareToken}
                  className="mt-5 border-t border-primary/20 pt-5"
                  onSent={(reply) => {
                    setLocalReplies((current) => [{ ...reply, createdAt: new Date().toISOString() }, ...current]);
                  }}
                />
              </section>
            )}
            {replies.length > 0 && (
              <section className="border border-white/10 bg-white/5 p-5 sm:p-7" aria-labelledby="athlete-replies">
                <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">From the people cheering</p>
                <h2 id="athlete-replies" className="mt-2 font-display text-3xl uppercase">Recent reactions</h2>
                <ul className="mt-5 space-y-3">
                  {replies.slice(0, 6).map((reply, index) => (
                    <li key={`${reply.createdAt}-${index}`} className="border-l-2 border-primary/60 bg-black/20 p-4">
                      <p className="text-sm font-bold">{reply.reaction}</p>
                      {reply.message && <p className="mt-2 text-sm leading-relaxed text-white/65">{reply.message}</p>}
                      <p className="mt-3 text-[9px] font-bold uppercase tracking-widest text-white/35">{new Date(reply.createdAt).toLocaleDateString()}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {invite.videos.length === 0 && !invite.stats && invite.scheduleEvents.length === 0 && <div className="border border-white/10 bg-white/5 p-8 text-center"><p className="font-display text-3xl uppercase">Season updates are coming</p><p className="mt-2 text-sm text-white/50">Save this page and check back after the next update.</p></div>}
          </div>
          <aside className="h-fit border border-white/10 bg-[#11141b] p-5 sm:p-6">
            <Smartphone className="h-7 w-7 text-primary" />
            <h2 className="mt-4 font-display text-3xl uppercase">Save this page</h2>
            <p className="mt-3 text-sm font-medium leading-relaxed text-white/55">Keep this athlete page on your phone and revisit it as the season changes.</p>
            <ol className="mt-5 space-y-3 text-xs font-bold uppercase tracking-wider text-white/70">
              <li className="flex gap-3"><span className="text-primary">1</span>Open the browser share menu</li>
              <li className="flex gap-3"><span className="text-primary">2</span>Choose Add to Home Screen</li>
              <li className="flex gap-3"><span className="text-primary">3</span>Open the saved icon anytime</li>
            </ol>
            <p className="mt-6 border-t border-white/10 pt-4 text-[10px] font-bold uppercase tracking-widest text-white/30">Stable page URL · season context {new Date(invite.seasonEndsAt).toLocaleDateString()}</p>
          </aside>
        </div>
      </main>
    </div>
  );
}

function EventCard({ event, teamName }: { event: AthleteInviteScheduleEvent; teamName: string }) {
  const title = event.type === 'game' ? `vs ${event.opponent || 'Opponent TBD'}` : event.type;
  const addToCalendar = () => {
    const start = calendarTimestamp(event.date, event.time);
    const endDate = new Date(`${event.date}T${event.time || '12:00'}:00`);
    endDate.setHours(endDate.getHours() + 2);
    const end = endDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pixl Sports//Athlete Invite//EN', 'BEGIN:VEVENT', `UID:${event.id}@pixlsports`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${escapeCalendar(`${teamName ? `${teamName} ` : ''}${title}`)}`, `LOCATION:${escapeCalendar(event.location)}`, `DESCRIPTION:${escapeCalendar(event.notes)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${event.date}-${event.type}.ics`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <li className="border border-white/10 bg-white/5 p-5" data-testid="athlete-schedule-event-card">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">{event.status} · {event.type}</p><h3 className="mt-2 font-display text-3xl uppercase">{title}</h3></div><span className="border border-white/15 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-white/50">{new Date(`${event.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>
      <p className="mt-4 text-xs font-bold uppercase tracking-widest text-white/65">{event.time ? new Date(`${event.date}T${event.time}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'Time TBD'}</p>
      {event.location && <p className="mt-2 flex items-center gap-2 text-xs text-white/50"><MapPin className="h-4 w-4 text-primary" />{event.location}</p>}
      <button type="button" onClick={addToCalendar} className="mt-5 inline-flex min-h-10 items-center gap-2 border border-primary/50 px-3 text-[10px] font-bold uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground"><CalendarPlus className="h-4 w-4" />Add to Calendar</button>
    </li>
  );
}

function calendarTimestamp(date: string, time: string) {
  return new Date(`${date}T${time || '12:00'}:00`).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function escapeCalendar(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function Stat({ label, value, primary = false }: { label: string; value: number; primary?: boolean }) {
  return <div className="border border-white/10 bg-black/20 p-3"><p className="truncate text-[9px] font-bold uppercase tracking-widest text-white/50">{label}</p><p className={`mt-1 font-display text-3xl ${primary ? 'text-primary' : 'text-white'}`}>{value}</p></div>;
}
function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="mt-5 flex items-start justify-between gap-4 border-t border-border pt-4"><div><p className="text-sm font-bold">{label}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p></div><Switch checked={checked} onCheckedChange={onChange} aria-label={label} /></div>;
}
function InviteShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background text-foreground"><header className="border-b border-border bg-card"><div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8"><Link href="/studio"><img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-11 w-auto" /></Link><Link href="/studio" className="text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">Back to studio</Link></div></header>{children}</div>;
}
function PublicHeader() {
  return <header className="border-b border-white/10 bg-[#11141b]"><div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8"><Link href="/"><img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-11 w-auto" /></Link><span className="text-[10px] font-bold uppercase tracking-[.2em] text-white/35">Athlete Hype Page</span></div></header>;
}
function PublicShell({ children }: { children: React.ReactNode }) {
  return <div className="noise min-h-dvh bg-[#0B1F3A] text-white"><PublicHeader /><main className="grid min-h-[calc(100dvh-72px)] place-items-center px-5 py-12">{children}</main></div>;
}