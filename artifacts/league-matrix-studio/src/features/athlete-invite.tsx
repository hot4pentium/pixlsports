import { useEffect, useMemo, useState } from 'react';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus,
  Check,
  Clipboard,
  ExternalLink,
  AlertTriangle,
  Link2,
  Link2Off,
  MapPin,
  Share2,
  Smartphone,
  Trophy,
  Zap,
} from 'lucide-react';
import { Link } from 'wouter';
import {
  getListAthleteInvitesQueryKey,
  getGetAthleteInviteQueryKey,
  getListProjectsQueryKey,
  useCreateAthleteInvite,
  useDeleteAthleteInvite,
  useGetAthleteInvite,
  useListAthleteInvites,
  useListProjects,
  useUpdateAthleteInvite,
  type AthleteInviteInput,
  type AthleteInviteScheduleEvent,
} from '@workspace/api-client-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getSportRule, sports, type Sport } from './stat-tracker';
import { getUserProfile } from './supporter-dashboard-model';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const supportedSports = sports.filter((sport) => sport !== 'softball');

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

export function AthleteInviteManager() {
  const { user, isLoaded, isSignedIn } = useUser();
  const queryClient = useQueryClient();
  const profile = getUserProfile(user);
  const { data: invites, isLoading } = useListAthleteInvites({
    query: { enabled: Boolean(isSignedIn), queryKey: getListAthleteInvitesQueryKey() },
  });
  const { data: projects, isFetched: projectsLoaded } = useListProjects({ query: { enabled: Boolean(isSignedIn), queryKey: getListProjectsQueryKey() } });
  const existing = invites?.[0] ?? null;
  const trackerProjects = projects?.filter((project) => project.project.tool === 'stat-tracker') ?? [];
  const scheduleProjects = projects?.filter((project) => project.project.tool === 'schedule') ?? [];
  const defaultSport = profile.sport && profile.sport !== 'softball' ? profile.sport : 'basketball';
  const [athleteName, setAthleteName] = useState(profile.athleteName);
  const [teamName, setTeamName] = useState(profile.teamName);
  const [seasonName, setSeasonName] = useState('');
  const [seasonEndsAt, setSeasonEndsAt] = useState(defaultSeasonEnd);
  const [sport, setSport] = useState<Exclude<Sport, 'softball'>>(defaultSport);
  const [trackerProjectId, setTrackerProjectId] = useState('none');
  const [scheduleProjectId, setScheduleProjectId] = useState('none');
  const [showHypeCard, setShowHypeCard] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [showSchedule, setShowSchedule] = useState(true);
  const [notice, setNotice] = useState('');
  const createInvite = useCreateAthleteInvite();
  const updateInvite = useUpdateAthleteInvite();
  const deleteInvite = useDeleteAthleteInvite();
  const missingTrackerProject = Boolean(
    projectsLoaded
    && trackerProjectId !== 'none'
    && !trackerProjects.some((project) => project.id === trackerProjectId),
  );
  const missingScheduleProject = Boolean(
    projectsLoaded
    && scheduleProjectId !== 'none'
    && !scheduleProjects.some((project) => project.id === scheduleProjectId),
  );

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
    trackerProjectId: trackerProjectId === 'none' ? null : trackerProjectId,
    scheduleProjectId: scheduleProjectId === 'none' ? null : scheduleProjectId,
    showHypeCard,
    showStats,
    showSchedule,
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
  const revoke = async () => {
    if (!existing || !window.confirm('Revoke this athlete invite? The old URL will stop working immediately.')) return;
    await deleteInvite.mutateAsync({ inviteToken: existing.inviteToken });
    await queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() });
    setNotice('Invite revoked. Creating another page will generate a new URL.');
  };

  return (
    <InviteShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
        <div className="flex flex-col justify-between gap-5 border-l-4 border-primary pl-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Athlete invite</p>
            <h1 className="mt-2 font-display text-5xl uppercase leading-none sm:text-6xl">One page for the season</h1>
            <p className="mt-4 max-w-2xl text-sm font-medium leading-relaxed text-muted-foreground">Share one owner-controlled URL. It updates when finalized stats, Hype Cards, or the selected schedule project change.</p>
          </div>
          <Link href="/studio/profile" className="text-xs font-bold uppercase tracking-widest text-primary hover:underline">Profile settings</Link>
        </div>

        {existing && (
          <section className="mt-8 border border-primary/40 bg-primary/5 p-4 sm:p-5" aria-label="Active athlete invite">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link2 className="h-5 w-5 shrink-0 text-primary" />
              <input readOnly value={inviteUrl(existing.inviteToken)} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 border border-border bg-background px-3 py-3 text-xs font-medium" aria-label="Athlete invite URL" />
              <Button type="button" variant="outline" className="rounded-none" onClick={copy}><Clipboard className="mr-2 h-4 w-4" />Copy</Button>
              <Button type="button" className="rounded-none" onClick={share}><Share2 className="mr-2 h-4 w-4" />Share</Button>
              <Link href={`/player/${existing.inviteToken}`} target="_blank" className="inline-flex min-h-10 items-center justify-center border border-border px-3 text-xs font-bold uppercase tracking-widest"><ExternalLink className="mr-2 h-4 w-4" />Open</Link>
            </div>
            <p className="mt-3 text-xs font-medium text-muted-foreground">Active through {new Date(existing.seasonEndsAt).toLocaleDateString()}. Updating the settings below does not change this URL.</p>
          </section>
        )}

        <form onSubmit={save} className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-5 border border-border bg-card p-5 sm:p-7">
            <h2 className="font-display text-3xl uppercase">Page details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Athlete name" value={athleteName} onChange={setAthleteName} required />
              <Field label="Team" value={teamName} onChange={setTeamName} />
              <Field label="Season" value={seasonName} onChange={setSeasonName} placeholder="Fall 2026" required />
              <label className="block"><Label className="text-xs font-bold uppercase tracking-widest">Season ends</Label><Input type="date" min={new Date().toISOString().slice(0, 10)} value={seasonEndsAt} onChange={(event) => setSeasonEndsAt(event.target.value)} className="mt-2 h-12 rounded-none" required /></label>
            </div>
            <label className="block"><Label className="text-xs font-bold uppercase tracking-widest">Sport</Label><select value={sport} onChange={(event) => setSport(event.target.value as Exclude<Sport, 'softball'>)} className="mt-2 h-12 w-full border border-border bg-background px-3 text-sm font-bold">{supportedSports.map((item) => <option key={item} value={item}>{getSportRule(item).label}</option>)}</select></label>
            {missingTrackerProject && (
              <MissingSourceWarning
                section="Finalized stats"
                detail="The selected stats project was deleted or is no longer available to this account. Stats are currently omitted from the public page."
                onHide={() => {
                  setTrackerProjectId('none');
                  setShowStats(false);
                }}
              />
            )}
            <ProjectSelect label="Finalized stats project" value={trackerProjectId} onChange={setTrackerProjectId} projects={trackerProjects} emptyLabel="Do not link stats" />
            {missingScheduleProject && (
              <MissingSourceWarning
                section="Upcoming schedule"
                detail="The selected schedule project was deleted or is no longer available to this account. Schedule events are currently omitted from the public page."
                onHide={() => {
                  setScheduleProjectId('none');
                  setShowSchedule(false);
                }}
              />
            )}
            <ProjectSelect label="Schedule project" value={scheduleProjectId} onChange={setScheduleProjectId} projects={scheduleProjects} emptyLabel="Do not link a schedule" />
          </section>
          <aside className="space-y-5">
            <section className="border border-border bg-card p-5">
              <h2 className="font-display text-2xl uppercase">Visible sections</h2>
              <Toggle label="Latest Hype Card" detail="Shows the newest active hosted Hype Card." checked={showHypeCard} onChange={setShowHypeCard} />
              <Toggle label="Finalized stats" detail="Never exposes live tracker activity." checked={showStats} onChange={setShowStats} />
              <Toggle label="Upcoming schedule" detail="Uses event cards with Add to Calendar." checked={showSchedule} onChange={setShowSchedule} />
            </section>
            <Button type="submit" disabled={createInvite.isPending || updateInvite.isPending} className="h-12 w-full rounded-none text-xs font-bold uppercase tracking-widest"><Check className="mr-2 h-4 w-4" />{existing ? 'Update athlete page' : 'Create athlete page'}</Button>
            {existing && <Button type="button" variant="outline" onClick={revoke} disabled={deleteInvite.isPending} className="h-12 w-full rounded-none border-destructive/50 text-destructive"><Link2Off className="mr-2 h-4 w-4" />Revoke invite</Button>}
            {notice && <p role="status" className="border-l-2 border-primary bg-primary/5 px-3 py-3 text-xs font-bold leading-relaxed">{notice}</p>}
          </aside>
        </form>
      </main>
    </InviteShell>
  );
}

export function PublicAthleteInvitePage({ params }: { params: { inviteToken?: string } }) {
  const inviteToken = params.inviteToken ?? '';
  const { data: invite, isLoading, isError } = useGetAthleteInvite(inviteToken, {
    query: { enabled: Boolean(inviteToken), queryKey: getGetAthleteInviteQueryKey(inviteToken), retry: false },
  });
  useEffect(() => {
    if (!invite) return;
    const previous = document.title;
    document.title = `${invite.athleteName} | Pixl Sports`;
    return () => { document.title = previous; };
  }, [invite]);
  if (isLoading) return <PublicShell><p role="status" className="text-sm font-bold uppercase tracking-widest text-white/60">Loading athlete page…</p></PublicShell>;
  if (isError || !invite) return <PublicShell><div className="max-w-md text-center"><Zap className="mx-auto h-12 w-12 text-primary" /><h1 className="mt-5 font-display text-5xl uppercase">Athlete page unavailable</h1><p className="mt-3 text-sm font-medium leading-relaxed text-white/60">This invite may have ended, been revoked, or been copied incorrectly.</p></div></PublicShell>;
  const rule = getSportRule(invite.sport);
  return (
    <div className="noise min-h-dvh bg-[#080a0f] text-white" data-testid="public-athlete-invite">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-9 sm:px-8 sm:py-12">
        <header className="border-l-4 border-primary pl-5">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">{invite.seasonName} · {rule.label}</p>
          <h1 className="mt-3 font-display text-6xl uppercase leading-[.85] sm:text-7xl">{invite.athleteName}</h1>
          <p className="mt-4 text-sm font-bold uppercase tracking-widest text-white/45">{invite.teamName || 'Athlete season page'}</p>
        </header>

        {invite.hypeCard && (
          <section className="mt-10 grid overflow-hidden border border-white/10 bg-white/5 lg:grid-cols-[minmax(0,1fr)_360px]" aria-labelledby="latest-hype-card">
            {invite.hypeCard.posterUrl && <img src={invite.hypeCard.posterUrl} alt="" className="aspect-video h-full max-h-[460px] w-full bg-black object-contain" />}
            <div className="flex flex-col justify-center p-6 sm:p-8">
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Latest Hype Card</p>
              <h2 id="latest-hype-card" className="mt-3 font-display text-4xl uppercase leading-none">{invite.hypeCard.title}</h2>
              <Link href={`/h/${invite.hypeCard.shareToken}`} className="mt-6 inline-flex min-h-11 w-fit items-center gap-2 bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground">Open Hype Card <ExternalLink className="h-4 w-4" /></Link>
            </div>
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
            {!invite.hypeCard && !invite.stats && invite.scheduleEvents.length === 0 && <div className="border border-white/10 bg-white/5 p-8 text-center"><p className="font-display text-3xl uppercase">Season updates are coming</p><p className="mt-2 text-sm text-white/50">Save this page and check back after the next update.</p></div>}
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
            <p className="mt-6 border-t border-white/10 pt-4 text-[10px] font-bold uppercase tracking-widest text-white/30">Invite active through {new Date(invite.seasonEndsAt).toLocaleDateString()}</p>
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
function Field({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean }) {
  return <label className="block"><Label className="text-xs font-bold uppercase tracking-widest">{label}</Label><Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} className="mt-2 h-12 rounded-none" /></label>;
}
function ProjectSelect({ label, value, onChange, projects, emptyLabel }: { label: string; value: string; onChange: (value: string) => void; projects: Array<{ id: string; name: string }>; emptyLabel: string }) {
  const selectedProjectExists = value === 'none' || projects.some((project) => project.id === value);
  return <label className="block"><Label className="text-xs font-bold uppercase tracking-widest">{label}</Label><select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-12 w-full border border-border bg-background px-3 text-sm font-bold">{!selectedProjectExists && <option value={value}>Unavailable project — choose a replacement</option>}<option value="none">{emptyLabel}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>;
}
function MissingSourceWarning({ section, detail, onHide }: { section: string; detail: string; onHide: () => void }) {
  return (
    <div role="alert" className="border border-amber-500/50 bg-amber-500/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <p className="text-sm font-bold">{section} source unavailable</p>
          <p className="mt-1 text-xs font-medium leading-relaxed text-muted-foreground">{detail} Select a replacement below, or hide this section.</p>
          <Button type="button" variant="outline" className="mt-3 h-9 rounded-none border-amber-500/50 text-[10px] font-bold uppercase tracking-widest" onClick={onHide}>Hide {section}</Button>
        </div>
      </div>
    </div>
  );
}
function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="mt-5 flex items-start justify-between gap-4 border-t border-border pt-4"><div><p className="text-sm font-bold">{label}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p></div><Switch checked={checked} onCheckedChange={onChange} aria-label={label} /></div>;
}
function InviteShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background text-foreground"><header className="border-b border-border bg-card"><div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8"><Link href="/studio"><img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-11 w-auto" /></Link><Link href="/studio" className="text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">Back to studio</Link></div></header>{children}</div>;
}
function PublicHeader() {
  return <header className="border-b border-white/10 bg-[#11141b]"><div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8"><Link href="/"><img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-11 w-auto" /></Link><span className="text-[10px] font-bold uppercase tracking-[.2em] text-white/35">Athlete season page</span></div></header>;
}
function PublicShell({ children }: { children: React.ReactNode }) {
  return <div className="noise min-h-dvh bg-[#080a0f] text-white"><PublicHeader /><main className="grid min-h-[calc(100dvh-72px)] place-items-center px-5 py-12">{children}</main></div>;
}