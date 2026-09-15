import { escapeXml } from './hype-card-types';

const POSITION_BADGE_RIGHT = 938;
const POSITION_BADGE_MIN_WIDTH = 152;
const POSITION_BADGE_MAX_WIDTH = 310;
const POSITION_BADGE_TEXT_X = 890;
const POSITION_BADGE_TEXT_PADDING = 82;

function estimateTextWidth(text: string, fontSize: number, charWidthRatio: number, letterSpacing: number) {
  return text.length * fontSize * charWidthRatio + (text.length > 1 ? (text.length - 1) * letterSpacing : 0);
}

export function fitPositionBadgeText(text: string, maxWidth: number, baseSize: number) {
  if (!text) return baseSize;
  const estimated = estimateTextWidth(text, baseSize, 0.58, 1);
  if (estimated <= maxWidth) return baseSize;
  const fitted = (maxWidth - (text.length > 1 ? (text.length - 1) : 0)) / (text.length * 0.58);
  return Math.floor(Math.max(12, Math.min(baseSize, fitted)));
}

export function getPositionBadgeLayout(position: string) {
  const text = (position || 'GAME DAY').toUpperCase();
  const estimatedWidth = estimateTextWidth(text, 19, 0.58, 1);
  const width = Math.max(
    POSITION_BADGE_MIN_WIDTH,
    Math.min(POSITION_BADGE_MAX_WIDTH, Math.ceil(estimatedWidth + POSITION_BADGE_TEXT_PADDING)),
  );
  const maxTextWidth = width - POSITION_BADGE_TEXT_PADDING;
  const fontSize = fitPositionBadgeText(text, maxTextWidth, 19);
  const fittedTextWidth = estimateTextWidth(text, fontSize, 0.58, 1);

  return {
    width,
    x: POSITION_BADGE_RIGHT - width,
    right: POSITION_BADGE_RIGHT,
    textX: POSITION_BADGE_TEXT_X,
    maxTextWidth,
    fontSize,
    // Keep the minimum font size readable, then compress only labels that
    // still exceed the badge after reaching that minimum.
    textLength: fittedTextWidth > maxTextWidth ? maxTextWidth : null,
  };
}

export function buildPositionBadgeMarkup(position: string, stroke: string, textFill: string) {
  const text = escapeXml((position || 'GAME DAY').toUpperCase());
  const layout = getPositionBadgeLayout(position);
  const textSizing = layout.textLength
    ? ` textLength="${layout.textLength}" lengthAdjust="spacingAndGlyphs"`
    : '';

  return `<path d="M${layout.x} 46 H${layout.right} V114 H${layout.x + 18} L${layout.x} 96 Z" fill="#020811" stroke="${stroke}" stroke-width="3"/><text x="${layout.textX}" y="95" text-anchor="end" font-family="DM Sans,sans-serif" font-size="${layout.fontSize}" font-weight="800" letter-spacing="2"${textSizing} fill="${textFill}">${text}</text>`;
}