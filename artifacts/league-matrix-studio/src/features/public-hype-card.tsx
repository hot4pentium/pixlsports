import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, PlayCircle, Zap } from 'lucide-react';
import { Link } from 'wouter';
import { useGetHypeCardShare } from '@workspace/api-client-react';

import { PreviewArtwork } from './hype-card';
import { FullSizeVideoDialog, OpenFullSizeButton } from './hype-card-share';
import { getDimensions, normalizeHypeCardProject } from './hype-card-types';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function PublicHypeCardPage({ params }: { params: { slug?: string; shareToken?: string } }) {
  const shareToken = params.shareToken ?? '';
  const [fullSizeOpen, setFullSizeOpen] = useState(false);
  const { data: share, isLoading, isError } = useGetHypeCardShare(shareToken, {
    query: { enabled: Boolean(shareToken), queryKey: ['/api/hype-card-shares', shareToken], retry: false },
  });
  const project = useMemo(() => {
    const manifestProject = share?.manifest && typeof share.manifest.project === 'object'
      ? share.manifest.project
      : share?.manifest;
    return normalizeHypeCardProject({
      ...manifestProject,
      mediaType: 'video',
      mediaId: 'shared-video',
      photo: null,
    });
  }, [share]);

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
      upsert('og:type', 'video.other'),
      upsert('og:video', new URL(share.videoUrl, window.location.origin).href),
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
          <PreviewArtwork project={project} videoUrl={share.videoUrl} poster={share.posterUrl} ns="public-share" testId="public-hype-card" />
          <OpenFullSizeButton onClick={() => setFullSizeOpen(true)} />
          <button type="button" className="absolute inset-0 z-10 grid place-items-center bg-black/0 text-white transition hover:bg-black/10" onClick={() => setFullSizeOpen(true)} aria-label="Play shared Hype Card video full size">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-black/65 backdrop-blur transition hover:scale-105 hover:bg-primary"><PlayCircle className="h-9 w-9" /></span>
          </button>
        </div>
        <aside className="border-l-4 border-primary pl-5">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Shared Hype Card</p>
          <h1 className="mt-3 font-display text-5xl uppercase leading-[.9] sm:text-6xl">{share.title}</h1>
          <p className="mt-5 text-sm font-medium leading-relaxed text-white/60">Tap the card to watch the selected highlight full size. No Pixl Sports account is required.</p>
          <p className="mt-6 text-[10px] font-bold uppercase tracking-[.18em] text-white/40">Available until {new Date(share.expiresAt).toLocaleDateString()}</p>
        </aside>
      </main>
      <FullSizeVideoDialog open={fullSizeOpen} onOpenChange={setFullSizeOpen} src={share.videoUrl} poster={share.posterUrl} title={share.title} />
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