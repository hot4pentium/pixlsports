import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, Pause, Play, Send, Volume2, VolumeX, Zap } from 'lucide-react';
import { Link } from 'wouter';
import { useCreateHypeCardShareReply, useGetHypeCardShare } from '@workspace/api-client-react';

import { PreviewArtwork } from './hype-card';
import { getDimensions, normalizeHypeCardProject } from './hype-card-types';
import { getSportRule, isSport } from './stat-tracker';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const reactions = ['🔥', '👏', '💪', '⭐', '❤️'] as const;

export function PublicHypeCardPage({ params }: { params: { slug?: string; shareToken?: string } }) {
  const shareToken = params.shareToken ?? '';
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [reaction, setReaction] = useState<(typeof reactions)[number]>('🔥');
  const [message, setMessage] = useState('');
  const [replySent, setReplySent] = useState(false);
  const [replyError, setReplyError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const { data: share, isLoading, isError } = useGetHypeCardShare(shareToken, {
    query: { enabled: Boolean(shareToken), queryKey: ['/api/hype-card-shares', shareToken], retry: false },
  });
  const createReply = useCreateHypeCardShareReply();
  const project = useMemo(() => {
    const manifestProject = share?.manifest && typeof share.manifest.project === 'object'
      ? share.manifest.project
      : share?.manifest;
    return normalizeHypeCardProject({
      ...manifestProject,
      mediaType: share?.mediaType === 'image' ? 'image' : 'video',
      mediaId: share?.mediaType === 'video' ? 'shared-video' : null,
      photo: share?.mediaType === 'image' ? share.mediaUrl : null,
    });
  }, [share]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || share?.mediaType !== 'video') return;
    const syncPlaying = () => setIsPlaying(!video.paused && !video.ended);
    video.addEventListener('play', syncPlaying);
    video.addEventListener('pause', syncPlaying);
    video.addEventListener('ended', syncPlaying);
    video.addEventListener('error', syncPlaying);
    return () => {
      video.removeEventListener('play', syncPlaying);
      video.removeEventListener('pause', syncPlaying);
      video.removeEventListener('ended', syncPlaying);
      video.removeEventListener('error', syncPlaying);
    };
  }, [share?.mediaType, share?.videoUrl]);

  useEffect(() => {
    if (!share) return;
    const previousTitle = document.title;
    document.title = `${share.title} | Pixl Sports`;
    const upsert = (property: string, content: string) => {
      let element = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute('property', property);
        document.head.appendChild(element);
      }
      const previous = element.content;
      element.content = content;
      return () => { if (element) element.content = previous; };
    };
    const cleanups = [
      upsert('og:title', share.title),
      upsert('og:description', 'Watch this Hype Card from Pixl Sports.'),
      upsert('og:image', new URL(share.posterUrl, window.location.origin).href),
      upsert('og:type', share.mediaType === 'video' ? 'video.other' : 'website'),
      upsert('og:video', share.videoUrl ? new URL(share.videoUrl, window.location.origin).href : ''),
      upsert('og:url', window.location.href),
    ];
    return () => {
      document.title = previousTitle;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [share]);

  if (isLoading) return <PublicShell><p className="text-sm font-bold uppercase tracking-widest text-white/60" role="status">Loading Hype Card…</p></PublicShell>;
  if (isError || !share) {
    return (
      <PublicShell>
        <div className="max-w-md text-center">
          <Zap className="mx-auto h-12 w-12 text-primary" />
          <h1 className="mt-5 font-display text-5xl uppercase text-white">Hype Card not found</h1>
          <p className="mt-3 text-sm font-medium leading-relaxed text-white/60">This link may have expired, been revoked, or been copied incorrectly.</p>
          <Link href="/" className="mt-7 inline-flex items-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground">Go to Pixl Sports <ArrowUpRight className="h-4 w-4" /></Link>
        </div>
      </PublicShell>
    );
  }

  const dimensions = getDimensions(project.format);
  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };
  const submitReply = async (event: React.FormEvent) => {
    event.preventDefault();
    setReplyError('');
    try {
      await createReply.mutateAsync({
        shareToken,
        data: { reaction, message: message.trim() || null },
      });
      setMessage('');
      setReplySent(true);
    } catch (error) {
      const detail = error && typeof error === 'object' && 'data' in error
        ? (error as { data?: { error?: string } }).data?.error
        : null;
      setReplyError(detail || 'Your reply could not be sent. Please try again.');
    }
  };
  return (
    <div className="noise min-h-dvh bg-[#080a0f] text-white">
      <header className="border-b border-white/10 bg-[#11141b]">
        <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8">
          <Link href="/"><img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-11 w-auto max-w-[176px] object-contain" /></Link>
          <Link href="/studio" className="text-xs font-bold uppercase tracking-widest text-white/60 hover:text-white">Create yours <ArrowUpRight className="ml-1 inline h-4 w-4" /></Link>
        </div>
      </header>
      <main className="mx-auto grid min-h-[calc(100dvh-72px)] max-w-[1280px] items-center gap-8 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
        <div className="relative mx-auto w-full max-w-[660px] overflow-hidden rounded-[22px] shadow-[0_30px_100px_rgba(0,0,0,.65)]" style={{ aspectRatio: `${dimensions.width}/${dimensions.height}` }}>
          {share.mediaType === 'image' ? (
            <img src={share.mediaUrl} alt={share.title} className="h-full w-full object-contain" />
          ) : (
            <>
              <PreviewArtwork project={project} videoUrl={share.videoUrl ?? undefined} videoRef={videoRef} poster={share.posterUrl} ns="public-share" testId="public-hype-card" muted={isMuted} />
              <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 bg-black/75 p-2 backdrop-blur">
                <button
                  type="button"
                  onClick={togglePlayback}
                  className="flex min-h-10 items-center gap-2 px-3 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-primary hover:text-primary-foreground"
                  aria-label={isPlaying ? 'Pause highlight' : 'Play highlight'}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMuted((muted) => !muted);
                    if (isMuted && videoRef.current?.paused) void togglePlayback();
                  }}
                  className="flex min-h-10 items-center gap-2 px-3 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-primary hover:text-primary-foreground"
                  aria-label={isMuted ? 'Enable audio' : 'Mute audio'}
                >
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  {isMuted ? 'Audio' : 'Mute'}
                </button>
              </div>
            </>
          )}
        </div>
        <aside className="border-l-4 border-primary pl-5">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Shared Hype Card</p>
          <h1 className="mt-3 font-display text-5xl uppercase leading-[.9] sm:text-6xl">{share.title}</h1>
          <p className="mt-5 text-sm font-medium leading-relaxed text-white/60">
            {share.mediaType === 'video' ? 'The selected highlight plays directly in the card.' : 'High quality Hype Card featured.'} No Pixl Sports account is required.
          </p>
          {share.stats && (
            <div className="mt-6 border border-white/10 bg-white/5 p-4 clip-angled-sm">
              <p className="text-[10px] font-bold uppercase tracking-[.15em] text-primary">Season Stats</p>
              <h2 className="mt-1 font-display text-2xl uppercase text-white">{share.stats.athleteName}</h2>
              <p className="text-xs font-bold uppercase tracking-widest text-white/40">
                {isSport(share.stats.sport) ? getSportRule(share.stats.sport).label : share.stats.sport}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="border border-white/10 bg-white/5 p-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Games</p>
                  <p className="font-display text-xl text-white">{share.stats.gamesPlayed}</p>
                </div>
                <div className="border border-white/10 bg-white/5 p-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Score</p>
                  <p className="font-display text-xl text-primary">{share.stats.score}</p>
                </div>
                {Object.entries(share.stats.stats).map(([statId, count]) => {
                  const rule = isSport(share.stats?.sport) ? getSportRule(share.stats.sport) : null;
                  const definition = rule?.stats.find((s) => s.id === statId);
                  const label = definition?.shortLabel || statId.replace(/-/g, ' ');
                  return (
                    <div key={statId} className="border border-white/10 bg-white/5 p-2">
                      <p className="truncate text-[10px] font-bold uppercase tracking-widest text-white/60">{label}</p>
                      <p className="font-display text-xl text-white">{count}</p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-right text-[9px] font-bold uppercase tracking-widest text-white/30">Last updated {new Date(share.stats.updatedAt).toLocaleDateString()}</p>
            </div>
          )}
          <form onSubmit={submitReply} className="mt-6 border border-white/10 bg-white/5 p-4" aria-label="Reply to this Hype Card">
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">Send some hype</p>
            <div className="mt-3 flex gap-2" role="group" aria-label="Choose a reaction">
              {reactions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => { setReaction(item); setReplySent(false); }}
                  className={`grid h-10 w-10 place-items-center border text-xl transition ${reaction === item ? 'border-primary bg-primary/20' : 'border-white/10 bg-black/20 hover:border-white/40'}`}
                  aria-pressed={reaction === item}
                  aria-label={`React ${item}`}
                >
                  {item}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-[10px] font-bold uppercase tracking-widest text-white/50" htmlFor="hype-reply-message">Message (optional)</label>
            <textarea
              id="hype-reply-message"
              value={message}
              onChange={(event) => { setMessage(event.target.value); setReplySent(false); }}
              maxLength={240}
              rows={3}
              placeholder="Add a short message…"
              className="mt-2 w-full resize-none border border-white/15 bg-black/30 p-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-primary"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold text-white/35">{message.length}/240</span>
              <button type="submit" disabled={createReply.isPending || replySent} className="inline-flex min-h-10 items-center gap-2 bg-primary px-4 text-[10px] font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-60">
                {replySent ? <><Check className="h-4 w-4" /> Sent</> : <><Send className="h-4 w-4" /> {createReply.isPending ? 'Sending…' : 'Send reply'}</>}
              </button>
            </div>
            {replyError && <p className="mt-2 text-xs font-bold text-red-300" role="alert">{replyError}</p>}
          </form>
          <p className="mt-6 text-[10px] font-bold uppercase tracking-[.18em] text-white/40">Available until {new Date(share.expiresAt).toLocaleDateString()}</p>
        </aside>
      </main>
    </div>
  );
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="noise min-h-dvh bg-[#080a0f] text-white">
      <header className="border-b border-white/10 bg-[#11141b]"><div className="mx-auto flex h-[72px] max-w-[1400px] items-center px-5 sm:px-8"><Link href="/"><img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-11 w-auto" /></Link></div></header>
      <main className="grid min-h-[calc(100dvh-72px)] place-items-center px-5 py-12">{children}</main>
    </div>
  );
}