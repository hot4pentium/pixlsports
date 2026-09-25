export const GAME_ON_COLLECTION_ID = 'game-on-dashboard-collection';

type Navigate = (path: string) => void;

export function navigateToGameOnSection(navigate: Navigate) {
  navigate('/studio');

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let attempts = 0;
  const scrollWhenReady = () => {
    const section = document.getElementById(GAME_ON_COLLECTION_ID);
    if (section?.getClientRects().length) {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      return;
    }

    if (attempts < 30) {
      attempts += 1;
      window.requestAnimationFrame(scrollWhenReady);
    }
  };

  window.requestAnimationFrame(scrollWhenReady);
}