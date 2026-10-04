// Keep this entry free of app imports so module-graph errors remain observable.
window.dispatchEvent(new Event('leagueMatrix:starting'));

void import('./main').catch((error: unknown) => {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  window.dispatchEvent(new CustomEvent('leagueMatrix:boot-error', { detail }));
});