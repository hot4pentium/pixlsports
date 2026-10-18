import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { runGearQualifiedShareAction } from './soccer-gear-engagement';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Check,
  CalendarDays,
  Clipboard,
  ExternalLink,
  ImagePlus,
  Link2,
  MessageCircle,
  QrCode,
  Radio,
  Share2,
  SlidersHorizontal,
  Smartphone,
  Trophy,
  Trash2,
  Upload,
  Palette,
  Video,
  X,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import QRCode from 'qrcode';
import { Link } from 'wouter';
import {
  getListAthleteInvitesQueryKey,
  getGetAthleteInviteQueryKey,
  getGetAthleteFanCardQueryKey,
  getListAthleteInviteHypesQueryKey,
  getListProjectsQueryKey,
  getGetAthleteInviteEditorAccessQueryKey,
  getListHypeCardSharesQueryKey,
  downloadHypeCardShare,
  requestHypeCardShareUploadUrl,
  useCreateAthleteInvite,
  useCreateHypeCardShare,
  useGetAthleteInvite,
  useListAthleteInvites,
  useListProjects,
  useGetAthleteInviteEditorAccess,
  useCreateAthleteInviteEditorAccess,
  useRevokeAthleteInviteEditorAccess,
  useListHypeCardShares,
  useDeleteHypeCardShare,
  useStartAthleteInviteLive,
  useStopAthleteInviteLive,
  useUpdateAthleteInvite,
  useListAthleteInviteHypes,
  useDeleteAthleteInviteHype,
  getListAthleteInviteLiveTapAccessLinksQueryKey,
  useCreateAthleteInviteLiveTapAccessLink,
  useListAthleteInviteLiveTapAccessLinks,
  useRevokeAthleteInviteLiveTapAccessLink,
  type AthleteInviteEventSummary,
  type AthleteInviteInput,
  type HypeCardAppearance,
} from '@workspace/api-client-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { BackNavigationLink } from '@/components/back-navigation-link';
import { HypeCardReplyComposer } from './public-hype-card';
import { FanCardPhotoManager } from './fan-card-photo-manager';
import { FanCardAppearanceManager } from './fan-card-appearance-manager';
import { HypeManagerTaskCard } from './hype-manager-wallet';
import { OwnerEventNotifications } from './owner-event-notifications';
import { getActiveCarouselIndex } from './athlete-video-carousel';
import { getSportRule, type Sport } from './stat-tracker';
import { getUserProfile, getUserRole, type UserProfile } from './supporter-dashboard-model';
import { MAX_HOSTED_VIDEO_BYTES, monotonicProgress, prepareHypeCardShareMedia, uploadHypeCardShareMedia } from './hype-card-share';
import {
  deleteAthleteVideoDraft,
  loadAthleteVideoDraft,
  saveAthleteVideoDraft,
  saveAthleteVideoDraftDetails,
  type AthleteVideoDraftDetails,
} from './athlete-video-draft';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const hostedVideoQuery = { shareMode: 'card' as const, mediaType: 'video' as const, limit: 10 };
const hostedImageQuery = { shareMode: 'card' as const, mediaType: 'image' as const, limit: 1 };
const MAX_ATHLETE_HIGHLIGHT_VIDEOS = 3;

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
  return `${origin}${basePath}/fan/${encodeURIComponent(token)}`;
}

function fanCardUrl(token: string) {
  return inviteUrl(token);
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
    title: fallbackTitle || label(project.mediaName) || label(project.headline) || 'Game Day highlight',
    jerseyNumber: label(project.jerseyNumber),
    position: label(project.position),
  };
}

export function AthleteInviteManager() {
  const { user, isLoaded, isSignedIn } = useUser();
  const isParentAccount = getUserRole(user) === 'fan';
  const queryClient = useQueryClient();
  const profile = getUserProfile(user);
  const { data: invites, isLoading } = useListAthleteInvites({
    query: { enabled: Boolean(isSignedIn && isParentAccount), queryKey: getListAthleteInvitesQueryKey() },
  });
  const { data: projects } = useListProjects({ query: { enabled: Boolean(isSignedIn && isParentAccount), queryKey: getListProjectsQueryKey() } });
  const existing = invites?.[0] ?? null;
  const trackerProjects = projects?.filter((project) => project.project.tool === 'stat-tracker') ?? [];
  const defaultSport = profile.sport && profile.sport !== 'softball' ? profile.sport : 'basketball';
  const [athleteName, setAthleteName] = useState(profile.athleteName);
  const [teamName, setTeamName] = useState(profile.teamName);
  const [seasonName, setSeasonName] = useState(() => profile.seasonName || `Season ${new Date().getFullYear()}`);
  const [seasonEndsAt, setSeasonEndsAt] = useState(defaultSeasonEnd);
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  const [sport, setSport] = useState<Exclude<Sport, 'softball'>>(defaultSport);
  const [trackerProjectId, setTrackerProjectId] = useState('none');
  const [showHypeCard, setShowHypeCard] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [notice, setNotice] = useState('');
  const createInvite = useCreateAthleteInvite();
  const updateInvite = useUpdateAthleteInvite();
  const startLive = useStartAthleteInviteLive();
  const stopLive = useStopAthleteInviteLive();
  const deleteHypeCard = useDeleteHypeCardShare();
  const { data: hypeCardShares, isLoading: videosLoading, isError: videosError } = useListHypeCardShares(hostedVideoQuery, {
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getListHypeCardSharesQueryKey(hostedVideoQuery),
      staleTime: 10_000,
      refetchOnMount: 'always',
    },
  });
  const { data: hostedImages, isLoading: imagesLoading, isError: imagesError } = useListHypeCardShares(hostedImageQuery, {
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getListHypeCardSharesQueryKey(hostedImageQuery),
      staleTime: 10_000,
      refetchOnMount: 'always',
    },
  });
  const hypeCardsLoading = videosLoading || imagesLoading;
  const hypeCardsError = videosError || imagesError;
  const hostedVideos = hypeCardShares ?? [];
  const hostedImage = hostedImages?.[0] ?? null;
  useEffect(() => {
    if (!existing) return;
    setAthleteName(existing.athleteName);
    setTeamName(existing.teamName);
    setSeasonName(existing.seasonName);
    setSeasonEndsAt(inputDate(existing.seasonEndsAt));
    setTimezone(existing.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    setSport(existing.sport);
    setTrackerProjectId(existing.trackerProjectId ?? 'none');
    setShowHypeCard(existing.showHypeCard);
    setShowStats(existing.showStats);
  }, [existing?.inviteToken]);

  useEffect(() => {
    if (existing || trackerProjectId !== 'none' || !trackerProjects.length) return;
    setTrackerProjectId(trackerProjects[0].id);
  }, [existing, trackerProjectId, trackerProjects]);

  if (!isLoaded || isLoading) return <InviteShell><p role="status" className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Loading athlete page…</p></InviteShell>;
  if (!isSignedIn) return <InviteShell><div className="max-w-lg text-center"><h1 className="font-display text-5xl uppercase">Sign in to manage the athlete page</h1><Link href="/sign-in" className="mt-6 inline-flex bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground">Sign in</Link></div></InviteShell>;
  if (!isParentAccount) return <InviteShell><div className="mx-auto max-w-xl px-5 py-20 text-center"><h1 className="font-display text-4xl uppercase">Parent controls only</h1><p className="mt-4 text-sm leading-relaxed text-muted-foreground">Your athlete access is limited to the linked HYPE Card and soccer kit your parent or guardian set up.</p><Link href="/studio/player-showcase" className="mt-6 inline-flex bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground">Open athlete showcase</Link></div></InviteShell>;

  const payload = (): AthleteInviteInput => ({
    athleteName: athleteName.trim(),
    teamName: teamName.trim(),
    seasonName: seasonName.trim(),
    seasonEndsAt: seasonEndIso(seasonEndsAt),
    timezone,
    sport,
    trackerProjectId: trackerProjectId === 'none' || !trackerProjects.some((project) => project.id === trackerProjectId)
      ? null
      : trackerProjectId,
    scheduleProjectId: null,
    showHypeCard,
    showStats: showStats && (trackerProjectId === 'none' || trackerProjects.some((project) => project.id === trackerProjectId)),
    showSchedule: false,
    hypesEnabled: existing?.hypesEnabled ?? true,
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
    const credited = await runGearQualifiedShareAction(() => navigator.clipboard.writeText(fanCardUrl(existing.inviteToken)), user?.id, existing.inviteToken);
    setNotice(credited ? 'HYPE Card URL copied.' : 'HYPE Card URL copied. Gear reward will retry when you reconnect or open Soccer Gear.');
  };
  const share = async () => {
    if (!existing) return;
    const url = fanCardUrl(existing.inviteToken);
    if (navigator.share) {
      try {
        const credited = await runGearQualifiedShareAction(() => navigator.share({ title: `${existing.athleteName} HYPE Card`, text: `Follow ${existing.athleteName}'s season.`, url }), user?.id, existing.inviteToken);
        setNotice(credited ? 'HYPE Card share completed.' : 'Share completed. Gear reward will retry when you reconnect or open Soccer Gear.');
      } catch { setNotice('Share menu closed. No gear progress was added.'); }
    }
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
      setNotice('Hosted HYPE Card image downloaded.');
    } catch {
      setNotice('The hosted HYPE Card image could not be downloaded.');
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
      setNotice('Hosted HYPE Card image removed. The Athlete Hype Page and its other content were not changed.');
    } catch {
      setNotice('The hosted HYPE Card image could not be removed.');
    }
  };
  const retryHostedMedia = async () => {
    setNotice('');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListHypeCardSharesQueryKey(hostedVideoQuery) }),
      queryClient.invalidateQueries({ queryKey: getListHypeCardSharesQueryKey(hostedImageQuery) }),
    ]);
  };

  return (
    <InviteShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
        <div className="flex flex-col justify-between gap-5 border-l-4 border-primary pl-5 sm:flex-row sm:items-end">
          <div>
           <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">HYPE Card</p>
            <h1 className="mt-2 font-display text-5xl uppercase leading-none sm:text-6xl">One story. One HYPE Card link.</h1>
              <p className="mt-4 max-w-2xl text-sm font-medium leading-relaxed text-muted-foreground">Give fans one evolving HYPE Card with a photo, highlights, finalized stats, and season results.</p>
          </div>
          <Link href="/studio/profile" className="text-xs font-bold uppercase tracking-widest text-primary hover:underline">Profile settings</Link>
        </div>

        <section className="mt-8" aria-label="HYPE Card">
          {existing ? (
            <div className="border border-primary bg-primary/10 p-5" data-testid="card-create-hype-page">
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Share with fans</p>
              <h2 className="mt-2 font-display text-3xl uppercase">HYPE Card</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">One HYPE Card for the athlete’s season. Existing invite links open this same card.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={`/fan/${existing.inviteToken}`} className="inline-flex min-h-10 items-center bg-primary px-4 text-xs font-bold uppercase tracking-widest text-primary-foreground" data-testid="link-open-fan-hype-card">Open HYPE Card</Link>
                <Link href={`/player/${existing.inviteToken}/manage`} className="inline-flex min-h-10 items-center border border-border px-4 text-xs font-bold uppercase tracking-widest" data-testid="link-manage-athlete-card">Manage HYPE Card</Link>
              </div>
            </div>
          ) : (
            <div className="border border-primary bg-primary/10 p-5" data-testid="card-create-hype-page">
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Evolving share</p>
              <h2 className="mt-2 font-display text-3xl uppercase">Create the HYPE Card</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Create one HYPE Card for the season. Existing invite links will open it too.</p>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground" data-testid="first-card-photo-guidance">After creating your HYPE Card, open Manage HYPE Card to upload the athlete’s photo. Athlete Profile no longer has a separate photo upload.</p>
            </div>
          )}
        </section>

        <AthleteEditorInvitationPanel inviteToken={existing?.inviteToken ?? null} />

        {!existing && (
          <form onSubmit={save} className="mt-8 max-w-xl">
            <aside className="space-y-5">
              <Button type="submit" disabled={createInvite.isPending || updateInvite.isPending} className="h-12 w-full rounded-none text-xs font-bold uppercase tracking-widest"><Check className="mr-2 h-4 w-4" />{existing ? 'Update athlete card' : 'Create athlete card'}</Button>
              {notice && <p role="status" className="border-l-2 border-primary bg-primary/5 px-3 py-3 text-xs font-bold leading-relaxed">{notice}</p>}
            </aside>
          </form>
        )}
      </main>
    </InviteShell>
  );
}

export function AthleteEditorInvitationPanel({ inviteToken }: { inviteToken: string | null }) {
  const queryClient = useQueryClient();
  const [emailAddress, setEmailAddress] = useState('');
  const [projectId, setProjectId] = useState('');
  const [message, setMessage] = useState('');
  const invitationQuery = useGetAthleteInviteEditorAccess(inviteToken ?? '', {
    query: {
      enabled: Boolean(inviteToken),
      queryKey: getGetAthleteInviteEditorAccessQueryKey(inviteToken ?? ''),
      refetchOnMount: 'always',
      staleTime: 0,
    },
  });
  const projectsQuery = useListProjects({
    query: { enabled: Boolean(inviteToken), queryKey: getListProjectsQueryKey() },
  });
  const createInvitation = useCreateAthleteInviteEditorAccess();
  const revokeInvitation = useRevokeAthleteInviteEditorAccess();
  const hypeProjects = projectsQuery.data?.filter((item) => item.project.tool === 'hype-card') ?? [];
  const invitation = invitationQuery.data;
  const invitationLocked = invitation?.status === 'pending' || invitation?.status === 'active';
  useEffect(() => {
    if (!invitation) return;
    setEmailAddress((current) => current || invitation.emailAddress || '');
    setProjectId((current) => current || invitation.projectId || '');
  }, [invitation]);
  const refreshInvitation = async () => {
    if (!inviteToken) return;
    await queryClient.invalidateQueries({
      queryKey: getGetAthleteInviteEditorAccessQueryKey(inviteToken),
    });
    await invitationQuery.refetch();
  };
  const sendInvite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    if (!inviteToken || !emailAddress.trim() || !projectId) return;
    try {
      const response = await createInvitation.mutateAsync({
        inviteToken,
        data: { emailAddress: emailAddress.trim(), projectId },
      });
      await refreshInvitation();
      setMessage(response.status === 'active'
        ? 'Access restored. The athlete can sign in and edit this card.'
        : 'Invitation sent. The athlete can edit the card design and soccer kit after signing in.');
    } catch {
      setMessage('The invitation could not be sent. Check the email and try again.');
    }
  };
  const revoke = async () => {
    if (!inviteToken || !window.confirm('Revoke this athlete’s HYPE Card and soccer kit access?')) return;
    setMessage('');
    try {
      await revokeInvitation.mutateAsync({ inviteToken });
      await refreshInvitation();
      setMessage('Athlete HYPE Card and soccer kit access revoked.');
    } catch {
      setMessage('Access could not be revoked. Try again.');
    }
  };
  const statusLabel = invitation?.status === 'active'
    ? 'Active'
    : invitation?.status === 'pending'
      ? 'Invitation pending'
      : invitation?.status === 'revoked'
        ? 'Revoked'
        : 'Not invited';

  return (
    <section className="mt-8 border border-border bg-card p-5 sm:p-7" aria-labelledby="athlete-editor-invitation-title" data-testid="athlete-editor-invitation">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Design access only</p>
          <h2 id="athlete-editor-invitation-title" className="mt-2 font-display text-3xl uppercase">Invite athlete to edit</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Parents remain in control of the athlete page, visibility, publishing, privacy, and sharing. The athlete can edit only the linked HYPE Card design and soccer kit.</p>
        </div>
        {inviteToken && (
          <span className={`inline-flex w-fit items-center gap-2 border px-3 py-2 text-[10px] font-bold uppercase tracking-widest ${invitation?.status === 'active' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'}`}>
            <span className="h-2 w-2 rounded-full bg-current" />{invitationQuery.isLoading ? 'Checking access' : statusLabel}
          </span>
        )}
      </div>
      {!inviteToken ? (
        <div className="mt-5 border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm leading-relaxed">
          Create the athlete page first to connect a parent-owned HYPE Card.
          <Link href="/studio/athlete-page" className="ml-2 font-bold text-primary underline underline-offset-4">Open athlete page settings</Link>
        </div>
      ) : projectsQuery.isLoading ? (
        <div className="mt-5 h-16 animate-pulse bg-muted" aria-label="Loading HYPE Card projects" />
      ) : projectsQuery.isError ? (
        <div className="mt-5 border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p>HYPE Card projects could not be loaded.</p>
          <button type="button" onClick={() => void projectsQuery.refetch()} className="mt-2 font-bold text-primary underline underline-offset-4">Try again</button>
        </div>
      ) : hypeProjects.length === 0 ? (
        <div className="mt-5 border border-dashed border-primary/40 bg-primary/5 p-5">
          <p className="font-bold">Create a HYPE Card before inviting an athlete.</p>
          <p className="mt-1 text-sm text-muted-foreground">The athlete needs one existing card to edit. They cannot create or choose projects.</p>
          <Link href="/studio/hype-card" className="mt-4 inline-flex min-h-10 items-center gap-2 bg-primary px-4 text-xs font-bold uppercase tracking-widest text-primary-foreground"><Palette className="h-4 w-4" /> Create HYPE Card</Link>
        </div>
      ) : (
        <div className="mt-5">
          {invitationQuery.isError && (
            <p className="mb-3 border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm" role="alert">
              Invitation status could not be loaded. <button type="button" onClick={() => void invitationQuery.refetch()} className="font-bold underline">Retry</button>
            </p>
          )}
          <form onSubmit={sendInvite} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="block text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Athlete email
              <input type="email" required maxLength={320} value={invitationLocked ? invitation?.emailAddress ?? emailAddress : emailAddress} onChange={(event) => setEmailAddress(event.target.value)} placeholder="athlete@example.com" disabled={invitationLocked} className="mt-2 h-12 w-full border border-border bg-background px-3 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60" />
            </label>
            <label className="block text-xs font-bold uppercase tracking-widest text-muted-foreground">
              HYPE Card project
              <select required value={invitationLocked ? invitation?.projectId ?? '' : projectId} onChange={(event) => setProjectId(event.target.value)} disabled={invitationLocked} className="mt-2 h-12 w-full border border-border bg-background px-3 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60">
                <option value="">Choose a card</option>
                {hypeProjects.map((item) => <option key={item.id} value={item.id}>{item.name || 'Untitled HYPE Card'}</option>)}
              </select>
            </label>
            {invitation?.status === 'pending' || invitation?.status === 'active' ? (
              <button type="button" onClick={() => void revoke()} disabled={revokeInvitation.isPending} className="inline-flex h-12 items-center justify-center gap-2 border border-destructive/40 px-4 text-xs font-bold uppercase tracking-widest text-destructive hover:bg-destructive/5 disabled:opacity-50">
                <Trash2 className="h-4 w-4" />{revokeInvitation.isPending ? 'Revoking' : 'Revoke access'}
              </button>
            ) : (
              <Button type="submit" disabled={createInvitation.isPending || !emailAddress.trim() || !projectId} className="h-12 rounded-none px-5 text-xs font-bold uppercase tracking-widest">
                {createInvitation.isPending ? 'Sending' : invitation?.status === 'revoked' ? 'Invite again' : 'Send invitation'}
              </Button>
            )}
          </form>
          {invitation?.emailAddress && (
            <p className="mt-3 text-xs text-muted-foreground">Current invite: <strong className="text-foreground">{invitation.emailAddress}</strong>{invitation.projectId ? ` · ${hypeProjects.find((item) => item.id === invitation.projectId)?.name || 'Linked HYPE Card'}` : ''}</p>
          )}
          {invitation?.projectId && hypeProjects.some((item) => item.id === invitation.projectId) && (
            <Link href={`/studio/hype-card/${encodeURIComponent(invitation.projectId)}`} className="mt-3 inline-flex min-h-10 items-center gap-2 border border-border px-4 text-xs font-bold uppercase tracking-widest hover:border-primary hover:text-primary" data-testid="link-edit-linked-athlete-card">
              <Palette className="h-4 w-4" /> Open linked HYPE Card
            </Link>
          )}
          {message && <p className="mt-4 border-l-2 border-primary bg-primary/5 px-3 py-2 text-sm" role="status">{message}</p>}
        </div>
      )}
    </section>
  );
}

type OwnedAthleteInvite = {
  athleteName: string;
  teamName: string;
  seasonName: string;
  seasonEndsAt: string;
  sport: Exclude<Sport, 'softball'>;
  trackerProjectId: string | null;
  showHypeCard: boolean;
  showStats: boolean;
  showEvents: boolean;
  events: AthleteInviteEventSummary[];
  hypesEnabled: boolean;
  paused: boolean;
  inviteToken: string;
  liveTrackerShareToken: string | null;
  photoUrl: string | null;
  cutoutUrl?: string | null;
  photoRevision?: string | null;
  cardAppearance?: HypeCardAppearance | null;
  timezone: string | null;
};

function directVideoSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'athlete-highlight';
}

function directMediaName(value: string) {
  const cleaned = value.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned && !/^(?:IMG|VID|MOV|DSC|PXL|Screenshot)[ ]?\d+$/i.test(cleaned)
    ? cleaned.slice(0, 80)
    : 'Game Day highlight';
}

function OwnerVideoUpload({
  invite,
  atLimit,
  onPosted,
}: {
  invite: Pick<OwnedAthleteInvite, 'inviteToken' | 'athleteName' | 'teamName'>;
  atLimit: boolean;
  onPosted: () => Promise<void>;
}) {
  const createShare = useCreateHypeCardShare();
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [message, setMessage] = useState('');
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [mediaName, setMediaName] = useState('Game Day highlight');
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftVersionRef = useRef(0);
  const restoredTrimRef = useRef(false);
  const sourceSavedRef = useRef(false);
  const draftKey = `owner-athlete-video:${invite.inviteToken}`;

  const queueDraftSave = useCallback((draft: AthleteVideoDraftDetails, sourceBlob?: Blob) => {
    const version = ++draftVersionRef.current;
    if (sourceBlob) sourceSavedRef.current = false;
    setDraftStatus('saving');
    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (sourceBlob) {
          await saveAthleteVideoDraft(draftKey, { ...draft, blob: sourceBlob });
          sourceSavedRef.current = true;
          return;
        }
        if (!sourceSavedRef.current) {
          throw new Error('The original video has not been saved on this device.');
        }
        await saveAthleteVideoDraftDetails(draftKey, draft);
      });
    void writeQueueRef.current.then(() => {
      if (draftVersionRef.current === version) setDraftStatus('saved');
    }).catch(() => {
      if (draftVersionRef.current === version) setDraftStatus('error');
    });
    return writeQueueRef.current;
  }, [draftKey]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => {
    let active = true;
    setDraftReady(false);
    setDraftStatus('idle');
    void loadAthleteVideoDraft(draftKey).then((draft) => {
      if (!active || !draft) {
        if (active) {
          sourceSavedRef.current = false;
          setDraftReady(true);
        }
        return;
      }
      if (draft.blob.size > 120 * 1024 * 1024 || !draft.fileType.startsWith('video/')) {
        setMessage('The saved video draft is unavailable or exceeds the 120MB local limit. Choose the original video again.');
        setDraftReady(true);
        return;
      }
      const restoredFile = new File([draft.blob], draft.fileName, {
        type: draft.fileType,
        lastModified: draft.lastModified,
      });
      sourceSavedRef.current = true;
      restoredTrimRef.current = true;
      setFile(restoredFile);
      setMediaName(draft.mediaName);
      setTrimStart(draft.trimStart);
      setTrimEnd(draft.trimEnd);
      setVideoUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(restoredFile);
      });
      setDraftStatus('saved');
      setDraftReady(true);
    }).catch(() => {
      if (!active) return;
      setDraftStatus('error');
      setMessage('A saved video draft could not be opened on this device. The original video has not been uploaded.');
      setDraftReady(true);
    });
    return () => {
      active = false;
    };
  }, [draftKey]);

  useEffect(() => {
    if (!file || !draftReady) return;
    const draft: AthleteVideoDraftDetails = {
      fileName: file.name,
      fileType: file.type,
      lastModified: file.lastModified,
      trimStart,
      trimEnd,
      mediaName,
    };
    queueDraftSave(draft);
  }, [draftReady, file, mediaName, queueDraftSave, trimEnd, trimStart]);

  const reset = async () => {
    abortRef.current?.abort();
    try {
      await writeQueueRef.current.catch(() => undefined);
      await deleteAthleteVideoDraft(draftKey);
    } catch {
      setDraftStatus('error');
      setMessage('This video draft could not be removed from this device. It may return when you reopen this page.');
      return;
    }
    draftVersionRef.current += 1;
    restoredTrimRef.current = false;
    sourceSavedRef.current = false;
    setFile(null);
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setStage('');
    setProgress(0);
    setMessage('');
    setMediaName('Game Day highlight');
    setDraftReady(true);
    setDraftStatus('idle');
    setVideoUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!nextFile) return;
    if (!nextFile.type.startsWith('video/')) {
      setMessage('Choose a video file.');
      return;
    }
    if (nextFile.size > 120 * 1024 * 1024) {
      setMessage('Video is too large. Choose a video under 120MB.');
      return;
    }
    abortRef.current?.abort();
    setMessage('');
    setStage('');
    setProgress(0);
    setFile(nextFile);
    const nextMediaName = directMediaName(nextFile.name);
    setMediaName(nextMediaName);
    setDraftReady(true);
    restoredTrimRef.current = false;
    void queueDraftSave({
      fileName: nextFile.name,
      fileType: nextFile.type,
      lastModified: nextFile.lastModified,
      trimStart: 0,
      trimEnd: 0,
      mediaName: nextMediaName,
    }, nextFile);
    setVideoUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(nextFile);
    });
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
  };

  const handleMetadata = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      setMessage('This video has an invalid duration.');
      return;
    }
    if (duration > 0 && !restoredTrimRef.current) {
      setDuration(video.duration);
      return;
    }
    setDuration(video.duration);
    if (restoredTrimRef.current) {
      const maxStart = Math.max(0, video.duration - 0.1);
      const safeStart = Math.max(0, Math.min(trimStart, maxStart));
      const requestedEnd = trimEnd > trimStart ? trimEnd : Math.min(15, video.duration);
      const safeEnd = Math.max(safeStart + 0.1, Math.min(video.duration, safeStart + 15, requestedEnd));
      setTrimStart(safeStart);
      setTrimEnd(safeEnd);
      restoredTrimRef.current = false;
      setMessage('');
    } else {
      setTrimStart(0);
      setTrimEnd(Math.min(15, video.duration));
      setMessage(video.duration > 15 ? 'The first 15 seconds are selected. Adjust the segment below if needed.' : '');
    }
  };

  const handleStartChange = (value: number) => {
    const nextStart = Math.max(0, Math.min(value, Math.max(0, duration - 0.1)));
    setTrimStart(nextStart);
    setTrimEnd((currentEnd) => Math.max(nextStart + 0.1, Math.min(duration, nextStart + 15, currentEnd)));
  };

  const handleEndChange = (value: number) => {
    setTrimEnd(Math.max(trimStart + 0.1, Math.min(duration, trimStart + 15, value)));
  };

  const publish = async () => {
    const video = videoRef.current;
    if (!file || !video || !duration) {
      setMessage('Choose a video and wait for its preview to load.');
      return;
    }
    if (trimEnd <= trimStart || trimEnd - trimStart > 15.1) {
      setMessage('Choose a segment between 0.1 and 15 seconds.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setMessage('');
    setProgress(0.01);
    setStage('Preparing the clip on this device…');
    try {
      const prepared = await prepareHypeCardShareMedia(
        video,
        { trimStart, trimEnd },
        (value) => setProgress((current) => monotonicProgress(current, value * 0.55)),
        {
          signal: controller.signal,
          quality: 'standard',
          onAudioCheck: () => {
            setStage('Checking audio before posting…');
            setProgress((current) => monotonicProgress(current, 0.55));
          },
        },
      );
      if (prepared.video.size > MAX_HOSTED_VIDEO_BYTES) {
        throw new Error('The prepared video is too large for the Athlete Hype Page. Choose a shorter segment.');
      }
      const videoContentType = prepared.videoContentType.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
      setStage('Uploading the prepared video and poster…');
      setProgress((current) => monotonicProgress(current, 0.55));
      const [videoUpload, posterUpload] = await Promise.all([
        requestHypeCardShareUploadUrl({ mediaKind: 'video', contentType: videoContentType }),
        requestHypeCardShareUploadUrl({ mediaKind: 'poster', contentType: 'image/jpeg' }),
      ]);
      const transferred = { video: 0, poster: 0 };
      const updateProgress = () => {
        const total = prepared.video.size + prepared.poster.size;
        setProgress((current) => monotonicProgress(current, 0.55 + (total ? (transferred.video + transferred.poster) / total : 0) * 0.3));
      };
      await Promise.all([
        uploadHypeCardShareMedia(videoUpload.uploadUrl, prepared.video, videoContentType, controller.signal, (value) => {
          transferred.video = prepared.video.size * value;
          updateProgress();
        }),
        uploadHypeCardShareMedia(posterUpload.uploadUrl, prepared.poster, 'image/jpeg', controller.signal, (value) => {
          transferred.poster = prepared.poster.size * value;
          updateProgress();
        }),
      ]);
      setStage('Adding the video to the Athlete Hype Page…');
      setProgress((current) => monotonicProgress(current, 0.9));
      const label = mediaName.trim();
      if (!label) {
        setMessage('Add a moment name before posting.');
        setUploading(false);
        return;
      }
      const uniqueKey = `${invite.inviteToken}:${Date.now()}:${directVideoSlug(file.name)}`;
      await createShare.mutateAsync({
        data: {
          title: `${invite.athleteName} · ${label}`.slice(0, 200),
          mediaName: label,
          slug: `${directVideoSlug(invite.athleteName)}-${directVideoSlug(label)}-${Date.now()}`.slice(0, 80),
          shareKey: uniqueKey,
          shareMode: 'card',
          mediaType: 'video',
          mediaUploadClaimId: videoUpload.claimId,
          posterUploadClaimId: posterUpload.claimId,
          expiresInDays: 365,
          manifest: {
            version: 1,
            shareKey: uniqueKey,
            project: {
              version: 3,
              headline: label,
              mediaName: label,
              mediaType: 'video',
              mediaId: null,
              downloadMediaId: null,
              posterMediaId: null,
              logoMediaId: null,
              videoFit: 'fit',
              videoPrepared: true,
              videoMeta: {
                name: file.name,
                type: videoContentType,
                size: prepared.video.size,
                duration: prepared.duration,
              },
              trimStart: 0,
              trimEnd: prepared.duration,
              playerName: invite.athleteName,
              teamName: invite.teamName,
              jerseyNumber: '',
              position: '',
            },
          },
        },
      });
      let draftClearWarning = '';
      try {
        await writeQueueRef.current.catch(() => undefined);
        await deleteAthleteVideoDraft(draftKey);
        sourceSavedRef.current = false;
      } catch {
        draftClearWarning = ' The video was added, but this device could not clear its saved draft.';
      }
      setProgress((current) => monotonicProgress(current, 1));
      setStage('');
      setMessage(`Video added to the Athlete Hype Page.${draftClearWarning}`);
      draftVersionRef.current += 1;
      restoredTrimRef.current = false;
      setFile(null);
      setDuration(0);
      setTrimStart(0);
      setTrimEnd(0);
      setVideoUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setDraftStatus(draftClearWarning ? 'error' : 'idle');
      try {
        await onPosted();
      } catch {
        setMessage(`Video added to the Athlete Hype Page.${draftClearWarning} The page could not refresh its posted-video list.`);
      }
    } catch (error) {
      const cancelled = error instanceof Error && error.name === 'AbortError';
      setMessage(cancelled ? 'Video upload cancelled. The original video remains on this device.' : error instanceof Error ? error.message : 'The video could not be added.');
      setStage('');
      setProgress(0);
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  };

  return (
    <section className="mt-5 border border-white/15 bg-black/10 p-4 sm:p-5" aria-labelledby="add-athlete-video">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">New highlight</p>
          <h4 id="add-athlete-video" className="mt-1 font-display text-2xl uppercase">Add a video here</h4>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-white/60">Choose, trim, and post a clip directly to this athlete’s HYPE Card.</p>
        </div>
        <label className={`inline-flex min-h-10 shrink-0 cursor-pointer items-center justify-center gap-2 bg-primary px-4 text-xs font-bold uppercase tracking-widest text-primary-foreground ${atLimit || uploading || !draftReady ? 'pointer-events-none opacity-50' : 'hover:bg-primary/90'}`}>
          <Upload className="h-4 w-4" /> Add video
          <input type="file" accept="video/*" className="sr-only" onChange={handleFileChange} disabled={atLimit || uploading || !draftReady} />
        </label>
      </div>
      {atLimit && <p className="mt-3 text-xs font-medium text-amber-200">This page has reached its 3-video highlight limit. Delete one before adding another.</p>}
      {file && videoUrl && (
        <div className="mt-5 grid gap-4 border-t border-white/15 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
          <video ref={videoRef} src={videoUrl} controls playsInline preload="metadata" onLoadedMetadata={handleMetadata} className="max-h-72 w-full bg-black object-contain" />
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/70"><Video className="h-4 w-4 text-primary" /> {duration ? `${duration.toFixed(1)} seconds` : 'Reading video…'}</div>
            {duration > 0 && (
              <div className="space-y-4">
                <label className="block text-xs font-bold uppercase tracking-wider text-white/70">
                  Start: {trimStart.toFixed(1)}s
                  <input type="range" min="0" max={Math.max(0, duration - 0.1)} step="0.1" value={trimStart} onChange={(event) => handleStartChange(Number(event.target.value))} className="mt-2 w-full accent-[hsl(var(--primary))]" />
                </label>
                <label className="block text-xs font-bold uppercase tracking-wider text-white/70">
                  End: {trimEnd.toFixed(1)}s
                  <input type="range" min={Math.min(duration, trimStart + 0.1)} max={Math.min(duration, trimStart + 15)} step="0.1" value={trimEnd} onChange={(event) => handleEndChange(Number(event.target.value))} className="mt-2 w-full accent-[hsl(var(--primary))]" />
                </label>
                <p className="text-xs text-white/55">Selected segment: {(trimEnd - trimStart).toFixed(1)}s. Maximum 15 seconds.</p>
              </div>
            )}
            <label className="block text-xs font-bold uppercase tracking-wider text-white/70" htmlFor="owner-media-name">
              Moment name
              <input
                id="owner-media-name"
                value={mediaName}
                onChange={(event) => setMediaName(event.target.value)}
                maxLength={80}
                className="mt-2 min-h-11 w-full border border-white/20 bg-black/20 px-3 text-sm font-medium normal-case tracking-normal text-white"
                placeholder="Game Day highlight"
                aria-describedby="owner-media-name-help"
                data-testid="input-owner-media-name"
              />
              <span id="owner-media-name-help" className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-white/50">Shown to supporters; the device filename stays private.</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void publish()} disabled={uploading || !duration} className="inline-flex min-h-10 items-center gap-2 bg-primary px-4 text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-50">
                {uploading ? `${Math.max(1, Math.round(progress * 100))}%` : 'Post video'}
              </button>
              <button type="button" onClick={uploading ? () => abortRef.current?.abort() : reset} className="inline-flex min-h-10 items-center gap-2 border border-white/25 px-4 text-xs font-bold uppercase tracking-widest text-white hover:bg-white/10">
                {uploading ? 'Cancel' : <><X className="h-4 w-4" /> Remove</>}
              </button>
            </div>
            {(stage || message) && <p className="text-xs font-medium leading-relaxed text-white/65" role={message.includes('added') ? 'status' : 'alert'} aria-live="polite">{message || stage}</p>}
          </div>
        </div>
      )}
      {!file && message && <p className="mt-3 text-xs font-medium text-amber-200" role={message.includes('added') ? 'status' : 'alert'} aria-live="polite">{message}</p>}
      {file && draftStatus !== 'idle' && (
        <p className={`mt-3 text-xs font-medium ${draftStatus === 'error' ? 'text-amber-200' : 'text-white/55'}`} role={draftStatus === 'error' ? 'alert' : 'status'} aria-live="polite" data-testid="status-owner-video-draft">
          {draftStatus === 'saving' && 'Saving the original video, trim, and moment name privately on this device…'}
          {draftStatus === 'saved' && 'Draft saved privately on this device. Only the prepared clip and poster are uploaded when you post.'}
          {draftStatus === 'error' && 'This video draft could not be saved on this device. It may be lost if you leave this page; the original is not uploaded to the server.'}
        </p>
      )}
    </section>
  );
}

function OwnerHypePageManage({ invite, profile }: {
  invite: OwnedAthleteInvite;
  profile: Pick<UserProfile, 'athleteName' | 'jerseyNumber' | 'position'>;
}) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const updateInvite = useUpdateAthleteInvite();
  const deleteHypeCard = useDeleteHypeCardShare();
  const [showHypeCard, setShowHypeCard] = useState(invite.showHypeCard);
  const [showStats, setShowStats] = useState(invite.showStats);
  const [showEvents, setShowEvents] = useState(invite.showEvents);
  const [hypesEnabled, setHypesEnabled] = useState(invite.hypesEnabled);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const visibilitySavingRef = useRef(false);
  const [visibilityStatus, setVisibilityStatus] = useState<'idle' | 'saving' | 'saved' | 'refresh-error' | 'error'>('idle');
  const [activeTask, setActiveTask] = useState<'share' | 'photo' | 'design' | 'sections' | 'events' | 'hypes' | 'media' | 'live-taps' | null>(
    () => window.location.hash === '#design'
      ? 'design'
      : window.location.hash === '#owner-fan-hypes'
        ? 'hypes'
      : window.location.hash === '#owner-notify-followers' ? 'events' : null,
  );
  const toggleTask = (task: Exclude<typeof activeTask, null>) => {
    setActiveTask((current) => current === task ? null : task);
  };
  const previousInviteToken = useRef(invite.inviteToken);
  const { data: hypes, isLoading: hypesLoading, isError: hypesError } = useListAthleteInviteHypes(invite.inviteToken, {
    query: { queryKey: getListAthleteInviteHypesQueryKey(invite.inviteToken), refetchOnMount: 'always', refetchInterval: 30_000 },
  });
  const deleteHype = useDeleteAthleteInviteHype();
  const createLiveTapAccessLink = useCreateAthleteInviteLiveTapAccessLink();
  const revokeLiveTapAccessLink = useRevokeAthleteInviteLiveTapAccessLink();
  const liveTapAccessLinks = useListAthleteInviteLiveTapAccessLinks(invite.inviteToken, {
    query: {
      enabled: activeTask === 'live-taps',
      queryKey: getListAthleteInviteLiveTapAccessLinksQueryKey(invite.inviteToken),
      retry: false,
    },
  });
  const [familyTapQrDataUrl, setFamilyTapQrDataUrl] = useState('');
  const [familyTapAccessId, setFamilyTapAccessId] = useState('');
  const [familyTapNotice, setFamilyTapNotice] = useState('');
  const [notice, setNotice] = useState('');
  const { data: hypeCardShares, isLoading: videosLoading, isError: videosError } = useListHypeCardShares(hostedVideoQuery, {
    query: {
      queryKey: getListHypeCardSharesQueryKey(hostedVideoQuery),
      staleTime: 10_000,
      refetchOnMount: 'always',
    },
  });
  const { data: hostedImages, isLoading: imagesLoading, isError: imagesError } = useListHypeCardShares(hostedImageQuery, {
    query: {
      queryKey: getListHypeCardSharesQueryKey(hostedImageQuery),
      staleTime: 10_000,
      refetchOnMount: 'always',
    },
  });
  const hostedVideos = hypeCardShares ?? [];
  const hostedImage = hostedImages?.[0] ?? null;
  const mediaLoading = videosLoading || imagesLoading;
  const mediaError = videosError || imagesError;

  useEffect(() => {
    const changedInvite = previousInviteToken.current !== invite.inviteToken;
    previousInviteToken.current = invite.inviteToken;
    if (changedInvite) {
      setSettingsDirty(false);
      setVisibilityStatus('idle');
      setFamilyTapQrDataUrl('');
      setFamilyTapAccessId('');
      setFamilyTapNotice('');
      setActiveTask(window.location.hash === '#owner-fan-hypes'
        ? 'hypes'
        : window.location.hash === '#owner-notify-followers' ? 'events' : null);
    }
    if (settingsDirty && !changedInvite) return;
    setShowHypeCard(invite.showHypeCard);
    setShowStats(invite.showStats);
    setShowEvents(invite.showEvents);
    setHypesEnabled(invite.hypesEnabled);
  }, [invite.inviteToken, invite.showHypeCard, invite.showStats, invite.showEvents, invite.hypesEnabled, settingsDirty]);
  useEffect(() => {
    const openOwnerTask = () => {
      if (window.location.hash === '#design') setActiveTask('design');
      if (window.location.hash === '#owner-fan-hypes') setActiveTask('hypes');
      if (window.location.hash === '#owner-notify-followers') setActiveTask('events');
    };
    openOwnerTask();
    window.addEventListener('hashchange', openOwnerTask);
    return () => window.removeEventListener('hashchange', openOwnerTask);
  }, [invite.inviteToken]);
  useEffect(() => {
    if (activeTask !== 'hypes' || window.location.hash !== '#owner-fan-hypes') return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById('owner-fan-hypes');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTask, invite.inviteToken]);
  useEffect(() => {
    if (activeTask !== 'design' || window.location.hash !== '#design') return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById('hype-manager-trigger-design');
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTask, invite.inviteToken]);

  const payload = (paused = invite.paused, useDraft = true): AthleteInviteInput => ({
    athleteName: invite.athleteName,
    teamName: invite.teamName,
    seasonName: invite.seasonName,
    seasonEndsAt: invite.seasonEndsAt,
    timezone: invite.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    sport: invite.sport,
    trackerProjectId: invite.trackerProjectId,
    scheduleProjectId: null,
    showHypeCard: useDraft ? showHypeCard : invite.showHypeCard,
    showStats: useDraft ? showStats : invite.showStats,
    showSchedule: false,
    showEvents: useDraft ? showEvents : invite.showEvents,
    hypesEnabled: useDraft ? hypesEnabled : invite.hypesEnabled,
    paused,
  });
  const refreshPage = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetAthleteInviteQueryKey(invite.inviteToken) }),
      queryClient.invalidateQueries({ queryKey: getGetAthleteFanCardQueryKey(invite.inviteToken) }),
    ]);
  };
  const saveVisibilityChange = async (
    field: 'showHypeCard' | 'showStats' | 'showEvents' | 'hypesEnabled',
    checked: boolean,
  ) => {
    if (visibilitySavingRef.current || updateInvite.isPending) return;
    const current = { showHypeCard, showStats, showEvents, hypesEnabled };
    const next = { ...current, [field]: checked };
    const setField = {
      showHypeCard: setShowHypeCard,
      showStats: setShowStats,
      showEvents: setShowEvents,
      hypesEnabled: setHypesEnabled,
    }[field];
    visibilitySavingRef.current = true;
    setVisibilitySaving(true);
    setVisibilityStatus('saving');
    setSettingsDirty(true);
    setField(checked);
    try {
      // Save only the toggled visibility for this section.
      await updateInvite.mutateAsync({
        inviteToken: invite.inviteToken,
        data: { ...payload(invite.paused, false), ...next },
      });
      try {
        await refreshPage();
        setSettingsDirty(false);
        setVisibilityStatus('saved');
      } catch {
        // The mutation succeeded: keep the new switch value even if refresh failed.
        setVisibilityStatus('refresh-error');
      }
    } catch {
      setField(current[field]);
      setSettingsDirty(false);
      setVisibilityStatus('error');
    } finally {
      visibilitySavingRef.current = false;
      setVisibilitySaving(false);
    }
  };
  const copyFanCard = async () => {
    const credited = await runGearQualifiedShareAction(() => navigator.clipboard.writeText(fanCardUrl(invite.inviteToken)), user?.id, invite.inviteToken);
    setNotice(credited ? 'HYPE Card URL copied.' : 'HYPE Card URL copied. Gear reward will retry when you reconnect or open Soccer Gear.');
  };
  const createFamilyTapQrCode = async () => {
    setFamilyTapNotice('');
    setFamilyTapQrDataUrl('');
    setFamilyTapAccessId('');
    try {
      const created = await createLiveTapAccessLink.mutateAsync({ inviteToken: invite.inviteToken });
      setFamilyTapAccessId(created.id);
      const accessUrl = `${fanCardUrl(invite.inviteToken)}#live-taps=${encodeURIComponent(created.accessToken)}`;
      void queryClient.invalidateQueries({
        queryKey: getListAthleteInviteLiveTapAccessLinksQueryKey(invite.inviteToken),
      });
      try {
        const qrDataUrl = await QRCode.toDataURL(accessUrl, {
          errorCorrectionLevel: 'Q',
          margin: 3,
          width: 360,
          color: { dark: '#07172b', light: '#ffffff' },
        });
        setFamilyTapQrDataUrl(qrDataUrl);
        setFamilyTapNotice('QR code ready. Show it to family in person; anyone who sees it can cheer during Game Day Live until you revoke access.');
      } catch {
        setFamilyTapNotice('Family access was created, but its QR code could not be generated. Revoke it below before trying again.');
      }
    } catch {
      setFamilyTapNotice('The family QR code could not be created. Please try again.');
    }
  };
  const revokeFamilyTapQr = async (accessId: string) => {
    setFamilyTapNotice('');
    try {
      await revokeLiveTapAccessLink.mutateAsync({ inviteToken: invite.inviteToken, accessId });
      await queryClient.invalidateQueries({
        queryKey: getListAthleteInviteLiveTapAccessLinksQueryKey(invite.inviteToken),
      });
      if (familyTapAccessId === accessId) {
        setFamilyTapAccessId('');
        setFamilyTapQrDataUrl('');
      }
      setFamilyTapNotice('Family QR access revoked. It can no longer add cheers.');
    } catch {
      setFamilyTapNotice('Family QR access could not be revoked. Please try again.');
    }
  };
  const shareFanCard = async () => {
    const url = fanCardUrl(invite.inviteToken);
    if (navigator.share) {
      try {
        const credited = await runGearQualifiedShareAction(() => navigator.share({ title: `${invite.athleteName} HYPE Card`, text: `Follow ${invite.athleteName}'s season.`, url }), user?.id, invite.inviteToken);
        setNotice(credited ? 'HYPE Card share completed.' : 'Share completed. Gear reward will retry when you reconnect or open Soccer Gear.');
      } catch { setNotice('Share menu closed. No gear progress was added.'); }
    }
    else await copyFanCard();
  };
  const toggleAvailability = async () => {
    setNotice('');
    try {
      await updateInvite.mutateAsync({ inviteToken: invite.inviteToken, data: payload(!invite.paused, false) });
      await refreshPage();
      setNotice(invite.paused ? 'Hype Page resumed.' : 'Hype Page paused. Only you can access its management section.');
    } catch {
      setNotice('The Hype Page availability could not be changed.');
    }
  };
  const downloadMedia = async (media: { shareToken: string; slug: string }, kind: 'video' | 'image') => {
    setNotice('');
    try {
      const blob = await downloadHypeCardShare(media.shareToken, { responseType: 'blob' }) as Blob;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${media.slug}.${kind === 'video' ? (blob.type === 'video/webm' ? 'webm' : 'mp4') : (blob.type === 'image/png' ? 'png' : 'jpg')}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(`${kind === 'video' ? 'Video' : 'Image'} downloaded.`);
    } catch {
      setNotice(`The ${kind} could not be downloaded.`);
    }
  };
  const removeMedia = async (media: { shareToken: string; title: string }, query: typeof hostedVideoQuery | typeof hostedImageQuery) => {
    if (!window.confirm(`Remove “${media.title}” from the Athlete Hype Page?`)) return;
    setNotice('');
    try {
      await deleteHypeCard.mutateAsync({ shareToken: media.shareToken });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListHypeCardSharesQueryKey(query) }),
        queryClient.invalidateQueries({ queryKey: getGetAthleteInviteQueryKey(invite.inviteToken) }),
      ]);
      setNotice('Posted media removed.');
    } catch {
      setNotice('The posted media could not be removed.');
    }
  };
  const removeHype = async (id: string) => {
    setNotice('');
    try {
      await deleteHype.mutateAsync({ inviteToken: invite.inviteToken, hypeId: id });
      await queryClient.invalidateQueries({ queryKey: getListAthleteInviteHypesQueryKey(invite.inviteToken) });
      setNotice('Shoutout removed.');
    } catch {
      setNotice('The shoutout could not be removed. Please try again.');
    }
  };

  const activeTaskIndex = ['share', 'design', 'live-taps', 'photo', 'sections', 'events', 'hypes', 'media'].findIndex((task) => task === activeTask);

  return (
    <section className="mx-auto mt-7 max-w-5xl text-white" aria-labelledby="owner-hype-page-management" data-testid="owner-hype-page-management">
      <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Owner only</p>
          <h2 id="owner-hype-page-management" className="mt-2 font-display text-4xl uppercase sm:text-5xl">HYPE Card Manager</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">Build and share your athlete&apos;s story. Choose what you want to do next.</p>
        </div>
        <BackNavigationLink href="/studio" label="Back to Studio" testId="link-hype-manager-studio" />
      </div>
      {notice && <p role="status" className="my-3 border-l-2 border-primary bg-primary/10 px-3 py-3 text-xs font-bold leading-relaxed" data-testid="status-hype-manager">{notice}</p>}

      <div className="hype-manager-task-grid mt-5">
      <HypeManagerTaskCard key="share" id="share" taskIndex={0} activeTaskIndex={activeTaskIndex} title="Share Hype Card" description="Choose a card to share" Icon={Share2} active={activeTask === 'share'} onSelect={() => toggleTask('share')} badge={invite.paused ? 'Paused' : 'Live'} preview={invite.photoUrl ? <img src={invite.photoUrl} alt="" className="h-14 w-14 rounded-lg object-cover" /> : <span className="grid h-14 w-14 place-items-center bg-[#dceaf4] text-lg font-black text-[#102a4c]">{invite.athleteName.trim().charAt(0).toUpperCase() || 'P'}</span>}>
      <div>
        <h3 className="font-display text-2xl uppercase">Share the HYPE Card</h3>
        <p className="mt-1 text-xs text-white/55">This is the main link for family and fans. It stays with this athlete as their season updates.</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <input readOnly value={fanCardUrl(invite.inviteToken)} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 border border-white/20 bg-black/20 px-3 py-3 text-xs font-medium text-white" aria-label="HYPE Card URL" data-testid="input-fan-hype-card-url" />
          <Button type="button" variant="outline" className="rounded-none border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={copyFanCard} data-testid="button-copy-fan-hype-card"><Clipboard className="mr-2 h-4 w-4" />Copy</Button>
          <Button type="button" className="rounded-none" onClick={shareFanCard} data-testid="button-share-fan-hype-card"><Share2 className="mr-2 h-4 w-4" />Share</Button>
          <Link href={`/fan/${invite.inviteToken}`} className="inline-flex min-h-10 items-center border border-primary px-4 text-xs font-bold uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground" data-testid="link-preview-fan-hype-card">Preview</Link>
        </div>
      </div>
      <p className="mt-3 text-xs font-medium text-white/55">{invite.paused ? 'Paused — fans cannot open this card until you resume it.' : 'Live — fans can open this HYPE Card page.'}</p>
      <div className="mt-5 flex flex-wrap gap-3 border-t border-white/15 pt-5">
        <Button type="button" variant="outline" onClick={toggleAvailability} disabled={updateInvite.isPending || visibilitySaving} className="rounded-none border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white">
          <Link2 className="mr-2 h-4 w-4" />{invite.paused ? 'Resume Hype Page' : 'Pause Hype Page'}
        </Button>
      </div>
      </HypeManagerTaskCard>

      <HypeManagerTaskCard key="design" id="design" taskIndex={1} activeTaskIndex={activeTaskIndex} title="Card Design" description="Classic, Gallery or Spotlight" Icon={Palette} active={activeTask === 'design'} onSelect={() => toggleTask('design')} badge={invite.cardAppearance && invite.cardAppearance.design !== 'classic' ? invite.cardAppearance.design === 'gallery' ? 'Gallery' : 'Spotlight' : undefined}>
        <FanCardAppearanceManager invite={invite} profile={profile} />
      </HypeManagerTaskCard>

      <HypeManagerTaskCard
        key="live-taps"
        id="live-taps"
        taskIndex={2}
        activeTaskIndex={activeTaskIndex}
        title="Family Live Taps"
        description="Create and revoke in-person family QR codes"
        Icon={Zap}
        active={activeTask === 'live-taps'}
        onSelect={() => toggleTask('live-taps')}
        badge={liveTapAccessLinks.data?.length ? `${liveTapAccessLinks.data.length} active` : undefined}
      >
        <section aria-labelledby="owner-live-taps-title" data-testid="section-owner-live-taps">
          <h3 id="owner-live-taps-title" className="font-display text-2xl uppercase">Family Live Taps</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/65">
            The public HYPE Card link is view-only. Create a private QR code for family to scan in person. Anyone who sees the code can cheer during Game Day Live. Revoke it here if it is copied or lost, then create a new one.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              className="rounded-none"
              onClick={() => void createFamilyTapQrCode()}
              disabled={createLiveTapAccessLink.isPending}
              data-testid="button-create-live-tap-qr"
            >
              <QrCode className="mr-2 h-4 w-4" />{createLiveTapAccessLink.isPending ? 'Creating…' : 'Create family QR code'}
            </Button>
          </div>
          {familyTapQrDataUrl && (
            <figure className="mt-4 flex flex-col items-start gap-4 border border-white/15 bg-black/15 p-4 sm:flex-row sm:items-center" data-testid="created-live-tap-qr">
              <img
                src={familyTapQrDataUrl}
                alt={`Private Family Live Taps QR code for ${invite.athleteName}`}
                className="h-56 w-56 shrink-0 border-4 border-white bg-white object-contain"
                data-testid="img-created-live-tap-qr"
              />
              <figcaption className="max-w-sm text-xs leading-relaxed text-white/70">
                Show this code to family at the game so they can scan it in person. Anyone who sees or photographs it can send cheers during Game Day Live until you revoke this access.
              </figcaption>
            </figure>
          )}
          {liveTapAccessLinks.isLoading ? (
            <p role="status" className="mt-4 text-xs text-white/55">Checking active family QR codes…</p>
          ) : liveTapAccessLinks.isError ? (
            <p role="alert" className="mt-4 text-xs text-amber-200">Active family QR codes could not be loaded.</p>
          ) : liveTapAccessLinks.data?.length ? (
            <ul className="mt-4 divide-y divide-white/15 border-y border-white/15" data-testid="live-tap-qr-list">
              {liveTapAccessLinks.data.map((link) => (
                <li key={link.id} className="flex flex-col justify-between gap-3 py-3 sm:flex-row sm:items-center">
                  <p className="text-xs text-white/65">
                    Family QR code · created <time dateTime={link.createdAt}>{new Date(link.createdAt).toLocaleDateString()}</time>
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-none border-white/30 bg-transparent text-red-200 hover:bg-red-500/10 hover:text-red-100"
                    onClick={() => void revokeFamilyTapQr(link.id)}
                    disabled={revokeLiveTapAccessLink.isPending}
                    data-testid={`button-revoke-live-tap-qr-${link.id}`}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 border border-white/15 bg-black/15 p-3 text-xs text-white/55">No active family QR codes yet.</p>
          )}
          <p role={familyTapNotice.includes('could not') ? 'alert' : 'status'} aria-live="polite" className="mt-3 text-xs font-semibold text-white/70" data-testid="status-owner-live-taps">
            {familyTapNotice}
          </p>
        </section>
      </HypeManagerTaskCard>

      <HypeManagerTaskCard key="photo" id="photo" taskIndex={3} activeTaskIndex={activeTaskIndex} title="Upload Photo" description="Add a new athlete photo" Icon={ImagePlus} active={activeTask === 'photo'} onSelect={() => toggleTask('photo')} badge={invite.photoUrl ? 'Photo added' : undefined}>
        <FanCardPhotoManager inviteToken={invite.inviteToken} photoUrl={invite.photoUrl} cutoutUrl={invite.cutoutUrl} photoRevision={invite.photoRevision} />
      </HypeManagerTaskCard>

      <HypeManagerTaskCard key="sections" id="sections" taskIndex={4} activeTaskIndex={activeTaskIndex} title="Visible Sections" description="Choose what supporters see" Icon={SlidersHorizontal} active={activeTask === 'sections'} onSelect={() => toggleTask('sections')} badge={visibilitySaving ? 'Saving…' : visibilityStatus === 'error' ? 'Save failed' : visibilityStatus === 'refresh-error' ? 'Refresh needed' : undefined}>
      <section data-testid="section-visible-athlete-page">
        <h3 className="font-display text-2xl uppercase">Visible sections</h3>
        <p className="mt-1 text-xs text-white/60">Section switches save as soon as you change them.</p>
        <OwnerToggle label="Finalized stats" detail="Never exposes live tracker activity." checked={showStats} disabled={visibilitySaving || updateInvite.isPending} onChange={(value) => void saveVisibilityChange('showStats', value)} />
        <OwnerToggle label="Fan Shoutouts" detail="Fans can send a short encouragement from the HYPE Card. You can turn this off at any time." checked={hypesEnabled} disabled={visibilitySaving || updateInvite.isPending} onChange={(value) => void saveVisibilityChange('hypesEnabled', value)} />
        <OwnerToggle label="Allow events" detail="When on, all your eligible saved Event Cards appear on the HYPE Card, including cards you create later. When off, none appear." checked={showEvents} disabled={visibilitySaving || updateInvite.isPending} onChange={(value) => void saveVisibilityChange('showEvents', value)} />
        {visibilityStatus !== 'idle' && (
          <p
            className={`mt-4 text-xs font-semibold ${visibilityStatus === 'error' || visibilityStatus === 'refresh-error' ? 'text-amber-200' : 'text-white/70'}`}
            role={visibilityStatus === 'error' || visibilityStatus === 'refresh-error' ? 'alert' : 'status'}
            aria-live="polite"
            data-testid="status-owner-visible-sections"
          >
            {visibilityStatus === 'saving' ? 'Saving section change…' : visibilityStatus === 'saved' ? 'Section change saved.' : visibilityStatus === 'refresh-error' ? 'Section change saved, but the page could not refresh. Reload to confirm.' : 'Section change could not be saved. The switch was restored; try again.'}
          </p>
        )}
      </section>
      </HypeManagerTaskCard>

      <HypeManagerTaskCard
        key="events"
        id="events"
        taskIndex={5}
        activeTaskIndex={activeTaskIndex}
        title="Event Notifications"
        description="Notify followers about upcoming games"
        Icon={CalendarDays}
        active={activeTask === 'events'}
        onSelect={() => toggleTask('events')}
        badge={visibilitySaving ? 'Saving…' : showEvents ? 'Events on' : 'Events off'}
      >
        <OwnerEventNotifications invite={{ inviteToken: invite.inviteToken, showEvents, events: invite.events }} />
      </HypeManagerTaskCard>

      <HypeManagerTaskCard key="hypes" id="hypes" taskIndex={6} activeTaskIndex={activeTaskIndex} title="Fan Shoutouts" description="See messages from fans" Icon={MessageCircle} active={activeTask === 'hypes'} onSelect={() => toggleTask('hypes')} badge={hypes?.length ? `${hypes.length} received` : undefined}>
      <section aria-labelledby="owner-fan-hypes" data-testid="section-owner-fan-hypes">
        <h3 id="owner-fan-hypes" tabIndex={-1} className="font-display text-2xl uppercase">Fan Shoutouts</h3>
        <p className="mt-2 text-sm text-white/60">{hypesEnabled ? 'Shoutouts are on for the HYPE Card.' : 'Shoutouts are off. Earlier messages remain available to you.'}</p>
        <p className="mt-2 text-xs text-white/50">When browser alerts are enabled, new Shoutouts open directly here. Alert previews do not show fan messages.</p>
        {hypesLoading ? <p role="status" className="mt-4 text-sm">Loading Shoutouts…</p>
          : hypesError ? <p role="alert" className="mt-4 text-sm">Could not load Shoutouts. Refresh to try again.</p>
          : hypes?.length ? <ul className="mt-4 space-y-3">{hypes.map((hype) => (
            <li key={hype.id} className="flex items-start justify-between gap-4 border border-white/20 p-4">
              <div className="min-w-0"><strong>{hype.reaction}</strong><p className="mt-1 break-words text-xs text-white/60">{hype.senderName ? `From ${hype.senderName}` : 'Anonymous fan'}</p>{hype.message && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{hype.message}</p>}
                <time className="mt-2 block text-xs text-white/50" dateTime={hype.createdAt}>{new Date(hype.createdAt).toLocaleString()}</time></div>
              <button type="button" disabled={deleteHype.isPending} onClick={() => void removeHype(hype.id)} className="shrink-0 text-xs font-bold uppercase text-primary hover:underline">Remove</button>
            </li>
          ))}</ul> : <p className="mt-4 text-sm text-white/60">No Shoutouts yet.</p>}
      </section>
      </HypeManagerTaskCard>

      {false && <HypeManagerTaskCard id="media" taskIndex={7} activeTaskIndex={activeTaskIndex} title="Add Media" description="Add media" Icon={Video} active={activeTask === 'media'} onSelect={() => toggleTask('media')} badge={hostedVideos.length ? `${hostedVideos.length} posted` : undefined}>
      <div aria-live="polite" data-testid="section-manage-athlete-videos">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Posted media</p>
            <h3 className="mt-2 font-display text-2xl uppercase">Manage posted videos</h3>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">{hostedVideos.length} / {MAX_ATHLETE_HIGHLIGHT_VIDEOS}</span>
        </div>
        <OwnerVideoUpload
          key={invite.inviteToken}
          invite={invite}
          atLimit={hostedVideos.length >= MAX_ATHLETE_HIGHLIGHT_VIDEOS}
          onPosted={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: getListHypeCardSharesQueryKey(hostedVideoQuery) }),
              queryClient.invalidateQueries({ queryKey: getGetAthleteInviteQueryKey(invite.inviteToken) }),
            ]);
          }}
        />
        {mediaLoading ? (
          <p role="status" className="mt-4 text-sm text-white/55">Checking posted media…</p>
        ) : mediaError ? (
          <p className="mt-4 text-sm text-white/55">Posted media could not be loaded.</p>
        ) : hostedVideos.length > 0 ? (
          <ul className="mt-4 divide-y divide-white/15 border-y border-white/15" data-testid="hosted-video-list">
            {hostedVideos.map((video) => {
              const labels = hostedVideoLabels(video.manifest, video.mediaName);
              return (
                <li key={video.shareToken} className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center" data-testid="hosted-video-item">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold" data-testid="hosted-video-title">{labels.title}</p>
                    <p className="mt-1 text-[10px] text-white/45">Posted {new Date(video.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="rounded-none border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => void downloadMedia(video, 'video')} data-testid="button-download-hosted-video"><Download className="mr-2 h-4 w-4" />Download</Button>
                    <Button type="button" variant="outline" className="rounded-none border-white/30 bg-transparent text-red-300 hover:bg-red-500/10 hover:text-red-200" onClick={() => void removeMedia(video, hostedVideoQuery)} disabled={deleteHypeCard.isPending} data-testid="button-remove-hosted-video"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-white/55">No videos have been posted yet.</p>
        )}
        {hostedImage && !mediaError && (
          <div className="mt-5 border-t border-white/15 pt-4" data-testid="hosted-image-hype-card">
            <p className="text-sm font-bold">{hostedImage!.mediaName}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-none border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => void downloadMedia(hostedImage!, 'image')}><Download className="mr-2 h-4 w-4" />Download image</Button>
              <Button type="button" variant="outline" className="rounded-none border-white/30 bg-transparent text-red-300 hover:bg-red-500/10 hover:text-red-200" onClick={() => void removeMedia(hostedImage!, hostedImageQuery)} disabled={deleteHypeCard.isPending}><Trash2 className="mr-2 h-4 w-4" />Delete image</Button>
            </div>
          </div>
        )}
      </div>
      </HypeManagerTaskCard>}
      </div>
    </section>
  );
}

export function OwnerAthleteInviteManagePage({ params }: { params: { inviteToken?: string } }) {
  const inviteToken = params.inviteToken ?? '';
  const { user, isLoaded, isSignedIn } = useUser();
  const profile = getUserProfile(user);
  const { data: ownedInvites, isLoading } = useListAthleteInvites({
    query: {
      enabled: Boolean(isSignedIn && inviteToken),
      queryKey: getListAthleteInvitesQueryKey(),
      retry: false,
    },
  });
  const ownerInvite = ownedInvites?.find((item) => item.inviteToken === inviteToken) ?? null;

  if (!isLoaded || (isSignedIn && isLoading)) {
    return <PublicShell><div className="flex flex-col items-center gap-5"><p role="status" className="text-sm font-bold uppercase tracking-widest text-white/60">Loading management tools…</p><BackNavigationLink href="/" label="Return to Pixl Sports" testId="link-management-loading-home" variant="public" /></div></PublicShell>;
  }
  if (!isSignedIn) {
    const ownerDeepLink = window.location.hash === '#owner-notify-followers';
    const shareToken = new URLSearchParams(window.location.search).get('shareToken');
    const redirectUrl = `${basePath}/player/${encodeURIComponent(inviteToken)}/manage${ownerDeepLink && shareToken ? `?shareToken=${encodeURIComponent(shareToken)}` : ''}${ownerDeepLink ? '#owner-notify-followers' : '#owner-fan-hypes'}`;
    return (
      <PublicShell>
        <div className="max-w-md text-center">
          <h1 className="font-display text-5xl uppercase">Sign in to manage this Hype Page</h1>
          <Link href={`${basePath}/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`} className="mt-6 inline-flex min-h-11 items-center bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground">Sign in</Link>
          <BackNavigationLink href={`/fan/${inviteToken}`} label="Back to athlete Hype Card" testId="link-management-sign-in-athlete" variant="public" className="mx-auto mt-3" />
        </div>
      </PublicShell>
    );
  }
  if (!ownerInvite) {
    return <PublicShell><div className="max-w-md text-center"><Zap className="mx-auto h-12 w-12 text-primary" /><h1 className="mt-5 font-display text-5xl uppercase">Management unavailable</h1><p className="mt-3 text-sm font-medium leading-relaxed text-white/60">Only the account that owns this Hype Page can open these controls.</p><BackNavigationLink href={`/fan/${inviteToken}`} label="Back to athlete Hype Card" testId="link-management-unavailable-athlete" variant="public" className="mx-auto mt-6" /></div></PublicShell>;
  }

  return (
    <div className="noise min-h-dvh bg-[#0B1F3A] text-white" data-testid="owner-athlete-invite-management-page">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-9 sm:px-8 sm:py-12">
        <BackNavigationLink href={`/fan/${inviteToken}`} label="Back to athlete Hype Card" testId="link-back-to-athlete-hype-page" variant="public" />
         <OwnerHypePageManage invite={ownerInvite} profile={profile} />
      </main>
    </div>
  );
}

export function PublicAthleteInvitePage({ params }: { params: { inviteToken?: string } }) {
  const inviteToken = params.inviteToken ?? '';
  const { isSignedIn } = useUser();
  const [localReplies, setLocalReplies] = useState<Array<{ reaction: string; message: string | null; createdAt: string }>>([]);
  const [trendStatId, setTrendStatId] = useState('');
  const [selectedGameKey, setSelectedGameKey] = useState('');
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const videoCarouselRef = useRef<HTMLOListElement>(null);
  const { data: invite, isLoading, isError } = useGetAthleteInvite(inviteToken, {
    query: { enabled: Boolean(inviteToken), queryKey: getGetAthleteInviteQueryKey(inviteToken), retry: false },
  });
  const { data: ownedInvites } = useListAthleteInvites({
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getListAthleteInvitesQueryKey(),
      retry: false,
    },
  });
  const ownerInvite = ownedInvites?.find((item) => item.inviteToken === inviteToken) ?? null;
  useEffect(() => {
    setLocalReplies([]);
    setTrendStatId('');
    setSelectedGameKey('');
    setActiveVideoIndex(0);
  }, [inviteToken]);
  useEffect(() => {
    if (!invite) return;
    const previous = document.title;
    document.title = `${invite.athleteName} | Pixl Sports`;
    return () => { document.title = previous; };
  }, [invite]);
  useEffect(() => {
    if (!invite?.stats) return;
    setTrendStatId((current) => {
      if (current === 'score' || Object.prototype.hasOwnProperty.call(invite.stats?.stats ?? {}, current)) return current;
      return 'score';
    });
  }, [invite]);
  if (isLoading) return <PublicShell><div className="flex flex-col items-center gap-5"><p role="status" className="text-sm font-bold uppercase tracking-widest text-white/60">Loading athlete page…</p><BackNavigationLink href="/" label="Return to Pixl Sports" testId="link-athlete-loading-home" variant="public" /></div></PublicShell>;
  if (isError || !invite) return <PublicShell><div className="max-w-md text-center"><Zap className="mx-auto h-12 w-12 text-primary" /><h1 className="mt-5 font-display text-5xl uppercase">Athlete page unavailable</h1><p className="mt-3 text-sm font-medium leading-relaxed text-white/60">This invite may have ended, been revoked, or been copied incorrectly.</p><BackNavigationLink href="/" label="Return to Pixl Sports" testId="link-athlete-unavailable-home" variant="public" className="mx-auto mt-6" /></div></PublicShell>;
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
  const gameOptions = trendGames.map((game, index) => ({
    game,
    key: `${game.date}|${game.opponent}|${game.score}|${game.opponentScore}|${index}`,
    index,
  }));
  const selectedGameOption = gameOptions.find(({ key }) => key === selectedGameKey) ?? gameOptions.at(-1) ?? null;
  const selectedGameAthleteStats = selectedGameOption
    ? Object.entries(selectedGameOption.game.athleteStats).sort(([left], [right]) => left.localeCompare(right))
    : [];
  const hasHighlights = Boolean(invite.hypeCard?.posterUrl);
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
  const athleteGameStatsPanel = invite.stats ? (
    gameOptions.length > 0 ? (
      <div
        className="athlete-game-stats-panel overflow-hidden rounded-sm border border-orange-200/35 bg-gradient-to-br from-orange-400/10 via-blue-950/55 to-white/5 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.18)] sm:p-5"
        data-testid="athlete-game-stats"
        role="region"
        aria-labelledby="athlete-game-stats-title"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-orange-200/45 bg-orange-300/15 font-display text-2xl text-orange-100 shadow-[0_0_24px_rgba(251,146,60,0.15)]"
              aria-hidden="true"
              data-testid="athlete-game-stats-monogram"
            >
              {invite.athleteName.trim().charAt(0).toUpperCase() || 'A'}
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-orange-100">Player spotlight</p>
              <h3 id="athlete-game-stats-title" className="mt-1 font-display text-2xl uppercase text-white sm:text-3xl" data-testid="athlete-game-stats-title">
                {invite.athleteName}’s game stats
              </h3>
            </div>
          </div>
          <div className="w-full sm:max-w-sm">
            <label htmlFor="athlete-game-select" className="text-[10px] font-bold uppercase tracking-[.2em] text-orange-100">Choose a completed game</label>
            <select
              id="athlete-game-select"
              value={selectedGameOption?.key ?? ''}
              onChange={(event) => setSelectedGameKey(event.target.value)}
              className="mt-2 h-11 w-full border border-orange-200/35 bg-black/30 px-3 text-sm font-bold text-white outline-none focus:border-orange-200 focus:ring-2 focus:ring-orange-300/25"
              data-testid="select-athlete-game"
            >
              {[...gameOptions].reverse().map(({ game, key, index }) => {
                const date = game.date
                  ? new Date(`${game.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                  : `Game ${index + 1}`;
                return <option key={key} value={key}>{date} · {game.opponent ? `vs ${game.opponent}` : 'Opponent not listed'}</option>;
              })}
            </select>
          </div>
        </div>
        {selectedGameOption && (
          <div className="mt-4 border-t border-orange-200/15 pt-4" data-testid="athlete-game-stat-details">
            <p className="text-xs font-bold uppercase tracking-widest text-orange-100/90">
              {selectedGameOption.game.opponent ? `vs ${selectedGameOption.game.opponent}` : 'Opponent not listed'}
              {selectedGameOption.game.date && <> · {new Date(`${selectedGameOption.game.date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</>}
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-white/40">Scores are game results; the stats below count only plays credited to {invite.athleteName}.</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Stat label="Team score" value={selectedGameOption.game.score} primary />
              <Stat label="Opponent score" value={selectedGameOption.game.opponentScore} />
            </div>
            {selectedGameAthleteStats.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {selectedGameAthleteStats.map(([id, value]) => (
                  <Stat
                    key={id}
                    label={rule.stats.find((item) => item.id === id)?.shortLabel ?? id.replaceAll('-', ' ')}
                    value={value}
                    testId={`athlete-game-stat-${id}`}
                    spotlight
                  />
                ))}
              </div>
            ) : (
              <p className="mt-3 border border-orange-200/20 bg-black/20 p-4 text-sm leading-relaxed text-white/65" data-testid="athlete-game-stats-empty">
                No individual stats were recorded for {invite.athleteName} in this game.
              </p>
            )}
          </div>
        )}
      </div>
    ) : (
      <p className="border-t border-white/10 pt-5 text-sm leading-relaxed text-white/50" data-testid="athlete-game-stats-empty">
        Completed-game breakdowns will appear here after the first game is finalized.
      </p>
    )
  ) : null;
  return (
    <div className="noise min-h-dvh bg-[#0B1F3A] text-white" data-testid="public-athlete-invite">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl px-4 pb-10 pt-6 sm:px-8 sm:py-12">
        <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-5 border-l-4 border-primary pl-4 sm:pl-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,48%)] lg:items-end lg:gap-x-10 lg:gap-y-6">
          <div className="col-start-1 row-start-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary sm:text-xs">{invite.seasonName} · {rule.label}</p>
            <h1 className="mt-2 max-w-full font-display text-[clamp(2.75rem,13vw,4rem)] uppercase leading-[.88] [overflow-wrap:anywhere] sm:mt-3 sm:text-7xl">{invite.athleteName}</h1>
            <p className="mt-2 text-sm font-bold uppercase tracking-widest text-white/45 [overflow-wrap:anywhere] sm:mt-4">{invite.teamName || 'Athlete season page'}</p>
          </div>
          {hasHighlights && (
            <div className="athlete-highlights-heading col-span-2 row-start-2 flex min-w-0 flex-col gap-4 border-t border-white/15 pt-5 sm:flex-row sm:items-end sm:justify-between sm:gap-5 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:border-0 lg:pt-0" data-testid="athlete-highlights-heading">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Featured moments</p>
                <h2 id="athlete-video-highlights" className="mt-2 font-display text-4xl uppercase leading-none sm:text-5xl">Highlights</h2>
                <p className="mt-3 max-w-md text-xs font-medium leading-relaxed text-white/55">
                  A season moment, saved to revisit.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {false && (invite?.videos.length ?? 0) > 1 && (
                  <>
                    <button type="button" onClick={() => moveToVideo(activeVideoIndex - 1)} disabled={activeVideoIndex === 0} className="grid h-11 w-11 place-items-center border border-white/20 text-white transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30" aria-label="Previous video" data-testid="button-previous-athlete-video"><ChevronLeft className="h-5 w-5" /></button>
                    <span className="min-w-12 text-center text-[10px] font-bold uppercase tracking-widest text-white/50" aria-live="polite">{activeVideoIndex + 1} / {invite!.videos.length}</span>
                    <button type="button" onClick={() => moveToVideo(activeVideoIndex + 1)} disabled={activeVideoIndex === invite!.videos.length - 1} className="grid h-11 w-11 place-items-center border border-white/20 text-white transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30" aria-label="Next video" data-testid="button-next-athlete-video"><ChevronRight className="h-5 w-5" /></button>
                  </>
                )}
              </div>
            </div>
          )}
          {ownerInvite && (
            <Link
              href={`/player/${inviteToken}/manage`}
              className="col-start-2 row-start-1 inline-flex min-h-10 items-center self-center justify-self-end border border-primary bg-primary px-3 text-[10px] font-bold uppercase tracking-[.12em] text-primary-foreground transition-colors hover:bg-primary/90 sm:min-h-11 sm:px-5 sm:text-xs sm:tracking-widest lg:col-span-2 lg:col-start-1 lg:row-start-2"
              aria-label={`Manage ${invite.athleteName}'s Hype Page`}
              data-testid="link-manage-athlete-hype-page"
            >
              Manage <ChevronRight className="ml-1 h-3.5 w-3.5 sm:ml-2 sm:h-4 sm:w-4" />
            </Link>
          )}
        </header>

        <section
          className="mt-5"
          aria-labelledby={hasHighlights ? 'athlete-video-highlights' : undefined}
          aria-label={hasHighlights ? undefined : 'Athlete highlights'}
        >
          <div className="athlete-highlights-panel p-3 sm:p-4">
            {invite.hypeCard?.posterUrl && (
              <figure className="mx-auto mb-4 max-w-3xl overflow-hidden border border-white/15 bg-black/20" data-testid="athlete-image-highlight">
                <img
                  src={invite.hypeCard.posterUrl}
                  alt={`${invite.athleteName} — ${invite.hypeCard.title}`}
                  className="max-h-[70vh] w-full bg-black object-contain"
                  data-testid="athlete-highlight-image"
                />
                <figcaption className="border-t border-white/10 px-4 py-3">
                  <p className="font-display text-xl uppercase">{invite.hypeCard.title}</p>
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-[.2em] text-white/45">Photo highlight</p>
                </figcaption>
              </figure>
            )}
            {false && (invite?.videos.length ?? 0) > 0 ? (
              <ol
                ref={videoCarouselRef}
                className="athlete-video-carousel flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
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
                {invite!.videos.map((video, index) => {
                  const details = [video.jerseyNumber ? `#${video.jerseyNumber}` : '', video.position].filter(Boolean).join(' · ');
                  return (
                    <li key={video.shareToken} className="w-[82%] shrink-0 snap-start sm:w-[58%] lg:w-[50%]" aria-label={`Video ${index + 1} of ${invite!.videos.length}`} data-testid="athlete-video-slide">
                      <div className="athlete-video-stage">
                        <div className="athlete-video-frame">
                          <video
                            src={video.videoUrl}
                            poster={video.posterUrl ?? undefined}
                            controls
                            playsInline
                            preload="none"
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
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3">
                          <h3 className="font-display text-3xl uppercase leading-none">{video.title}</h3>
                          <a
                            href="#athlete-reply-composer"
                            className="inline-flex min-h-9 items-center border border-primary/60 px-3 text-[10px] font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                            aria-label={`Open media reply form from ${video.title}`}
                            data-testid="button-send-hype-for-video"
                          >
                            Leave a reply
                          </a>
                        </div>
                        {details && <p className="mt-3 text-xs font-bold uppercase tracking-[.16em] text-white/55">{details}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : !invite.hypeCard?.posterUrl ? (
              <div className="border border-white/10 bg-white/5 p-7" data-testid="athlete-video-empty-state">
                <p className="font-display text-3xl uppercase">Highlights are coming</p>
                <p className="mt-2 text-sm text-white/50">Check back after the next big moment.</p>
              </div>
            ) : null}
          </div>
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
            {invite.stats && athleteGameStatsPanel}
            {invite.stats && (
              <section className="border border-white/10 bg-white/5 p-5 sm:p-7" aria-labelledby="athlete-season-stats">
                <div className="flex items-center justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Finalized only</p><h2 id="athlete-season-stats" className="mt-2 font-display text-3xl uppercase">Season stats</h2></div><Trophy className="h-8 w-8 text-primary" /></div>
                <p className="mt-3 text-xs leading-relaxed text-white/50" data-testid="athlete-stat-source-note">Season stat totals and stat trends include both team- and athlete-attributed entries. Points / runs show team scores. Game breakdowns count only stats credited to {invite.athleteName}.</p>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Games" value={invite.stats.gamesPlayed} primary />
                  <Stat label="Points / runs" value={invite.stats.score} />
                  {Object.entries(invite.stats.stats).map(([id, value]) => <Stat key={id} label={rule.stats.find((item) => item.id === id)?.shortLabel ?? id.replaceAll('-', ' ')} value={value} />)}
                </div>
                {trendOptions.length > 0 && (
                    <div className="athlete-trends-panel mt-6 border-t border-white/10 p-4 pt-5 sm:p-5" data-testid="athlete-stat-trends">
                     <label htmlFor="athlete-trend-stat" className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Combined stat trends</label>
                     <select
                       id="athlete-trend-stat"
                       value={trendStatId}
                       onChange={(event) => setTrendStatId(event.target.value)}
                        className="mt-2 h-11 w-full border border-orange-300/40 bg-black/30 px-3 text-sm font-bold text-white outline-none focus:border-accent"
                       data-testid="select-athlete-trend-stat"
                     >
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
                                  <div className="athlete-trend-track h-2 min-w-0 flex-1 bg-white/10">
                                    <div className="athlete-trend-bar h-full" style={{ width: `${Math.max(6, (value / trendMax) * 100)}%` }} />
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
            {false && invite?.videos[0] && (
              <section className="border border-primary/40 bg-primary/10 p-5 sm:p-7" aria-labelledby="athlete-reply-composer">
                <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">For the athlete</p>
                <h2 id="athlete-reply-composer" className="mt-2 font-display text-3xl uppercase">Reply to the latest highlight</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/60">Choose a reaction and add an optional message for the latest shared video without leaving this athlete page.</p>
                <HypeCardReplyComposer
                  shareToken={invite!.videos[0].shareToken}
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
            {!invite.stats && <div className="border border-white/10 bg-white/5 p-8 text-center"><p className="font-display text-3xl uppercase">Season updates are coming</p><p className="mt-2 text-sm text-white/50">Save this page and check back after the next update.</p></div>}
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
            <p className="mt-6 border-t border-white/10 pt-4 text-[10px] font-bold uppercase tracking-widest text-white/30">HYPE Card page · season context {new Date(invite.seasonEndsAt).toLocaleDateString()}</p>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, primary = false, testId, spotlight = false }: { label: string; value: number; primary?: boolean; testId?: string; spotlight?: boolean }) {
  const cardColor = spotlight ? 'border-orange-200/25 bg-orange-300/10' : 'border-white/10 bg-black/20';
  const valueColor = primary ? 'text-primary' : spotlight ? 'text-orange-100' : 'text-white';
  return <div className={`border p-3 ${cardColor}`} data-testid={testId}><p className="truncate text-[9px] font-bold uppercase tracking-widest text-white/55">{label}</p><p className={`mt-1 font-display text-3xl ${valueColor}`}>{value}</p></div>;
}
function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="mt-5 flex items-start justify-between gap-4 border-t border-border pt-4"><div><p className="text-sm font-bold">{label}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p></div><Switch checked={checked} onCheckedChange={onChange} aria-label={label} /></div>;
}
function OwnerToggle({ label, detail, checked, disabled, onChange }: { label: string; detail: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <div className="mt-5 flex items-start justify-between gap-4 border-t border-white/15 pt-4"><div><p className="text-sm font-bold text-white">{label}</p><p className="mt-1 text-xs leading-relaxed text-white/50">{detail}</p></div><Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} /></div>;
}
function InviteShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background text-foreground"><header className="border-b border-border bg-card"><div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between gap-3 px-5 sm:px-8"><Link href="/studio"><img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-11 w-auto" /></Link><BackNavigationLink href="/studio" label="Back to Studio" testId="link-invite-shell-studio" className="shrink-0" /></div></header>{children}</div>;
}
function PublicHeader() {
  return <header className="border-b border-white/10 bg-[#11141b]"><div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8"><Link href="/"><img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-11 w-auto" /></Link><span className="text-[10px] font-bold uppercase tracking-[.2em] text-white/35">Athlete Hype Page</span></div></header>;
}
function PublicShell({ children }: { children: React.ReactNode }) {
  return <div className="noise min-h-dvh bg-[#0B1F3A] text-white"><PublicHeader /><main className="grid min-h-[calc(100dvh-72px)] place-items-center px-5 py-12">{children}</main></div>;
}