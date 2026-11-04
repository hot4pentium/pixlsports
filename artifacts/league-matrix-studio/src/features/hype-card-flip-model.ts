/**
 * Side availability and Y-axis flip state for the shared HYPE Card.
 * Mirrors ios/PIXL Sports/SupporterHypeCardView.swift: Front, Videos, Stats and
 * Events are the attached tabs; switching between two non-Front sections flips
 * directly from the outgoing section to the incoming one and never shows Front.
 */
export type CardSide = 'front' | 'videos' | 'stats' | 'events' | 'responses' | 'live-taps';
export type PrimaryCardSide = 'front' | 'videos' | 'stats' | 'events';
export type SecondaryCardSide = 'responses' | 'live-taps';

export const flipDurationMs = 440;

export const requestableSides: readonly CardSide[] = ['front', 'videos', 'stats', 'events', 'responses', 'live-taps'];

export function parseRequestedSide(value: string | null | undefined): CardSide {
  return requestableSides.includes(value as CardSide) ? (value as CardSide) : 'front';
}

export function availableCardSides(card: {
  hasStats: boolean;
  hasLiveScoreboard?: boolean;
  showEvents: boolean;
}): CardSide[] {
  // Native: [.front, .videos] + stats (when shared) + events (when shared).
  const sides: CardSide[] = ['front', 'videos'];
  if (card.hasStats || card.hasLiveScoreboard) sides.push('stats');
  if (card.showEvents) sides.push('events');
  // Web-only secondary sides that keep Shoutouts and private Live Taps reachable.
  sides.push('responses', 'live-taps');
  return sides;
}

export function primaryTabs(available: readonly CardSide[]): PrimaryCardSide[] {
  return available.filter((side): side is PrimaryCardSide => (
    side === 'front' || side === 'videos' || side === 'stats' || side === 'events'
  ));
}

export type FlipState = {
  /** The section the viewer chose (drives tab selection). */
  selected: CardSide;
  /** Content of the 0deg face: the photo front, or the outgoing section during a section-to-section flip. */
  frontFace: CardSide;
  /** Content of the 180deg face. */
  backFace: CardSide | null;
  rotated: boolean;
  /** When false the rotation is applied instantly (no CSS transition). */
  animate: boolean;
  busy: boolean;
};

export function initialFlipState(side: CardSide = 'front'): FlipState {
  return side === 'front'
    ? { selected: 'front', frontFace: 'front', backFace: null, rotated: false, animate: false, busy: false }
    : { selected: side, frontFace: 'front', backFace: side, rotated: true, animate: false, busy: false };
}

export function visibleFace(state: FlipState): CardSide {
  return state.rotated ? state.backFace ?? 'front' : state.frontFace;
}

export function beginFlip(state: FlipState, next: CardSide, available: readonly CardSide[], reducedMotion = false): FlipState {
  if (!available.includes(next) || next === state.selected || state.busy) return state;
  if (reducedMotion) return initialFlipState(next);
  if (next === 'front') {
    return { ...state, selected: 'front', frontFace: 'front', rotated: false, animate: true, busy: true };
  }
  if (state.selected === 'front') {
    return { selected: next, frontFace: 'front', backFace: next, rotated: true, animate: true, busy: true };
  }
  // Section to section: instantly park the outgoing section on the 0deg face,
  // then (armFlip) rotate to the incoming section on the 180deg face.
  return { selected: next, frontFace: state.selected, backFace: next, rotated: false, animate: false, busy: true };
}

export function armFlip(state: FlipState): FlipState {
  if (!state.busy || state.animate) return state;
  return { ...state, rotated: true, animate: true };
}

export function settleFlip(state: FlipState): FlipState {
  if (!state.busy) return state;
  return {
    selected: state.selected,
    frontFace: 'front',
    backFace: state.selected === 'front' ? null : state.backFace,
    rotated: state.selected !== 'front',
    animate: false,
    busy: false,
  };
}

export function reconcileFlip(state: FlipState, available: readonly CardSide[]): FlipState {
  const faces = [state.selected, state.backFace, state.frontFace].filter(Boolean) as CardSide[];
  return faces.every((side) => available.includes(side)) ? state : initialFlipState('front');
}
