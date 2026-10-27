/** Keep owner navigation separate from recipient-facing Showcase links. */
export function getHypeCardBackNavigation(inviteToken: string, ownerView = false, search = '') {
  const returnToOwner = ownerView
    || new URLSearchParams(search).get('from') === 'player-showcase';
  return {
    href: returnToOwner ? '/studio/player-showcase' : `/showcase/${encodeURIComponent(inviteToken)}`,
    label: returnToOwner ? 'Back to Showcase' : 'Back to Dynamic Showcase',
    testId: returnToOwner ? 'link-back-owner-showcase' : 'link-back-public-showcase',
  };
}
