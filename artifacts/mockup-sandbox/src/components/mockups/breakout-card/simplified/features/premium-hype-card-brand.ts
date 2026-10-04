import brandLogo from '../assets/pixlsports-logo-640.png?inline';
import { buildPremiumHypeCardArtwork, type PremiumHypeCardInput, type PremiumHypeCardLayer } from './premium-hype-card-artwork';

export const pixlSportsLogoSrc = brandLogo;

/** Browser wrapper: injects the real Pixl Sports logo asset into the pure renderer. */
export function buildBrandedPremiumHypeCardArtwork(input: PremiumHypeCardInput, layer: PremiumHypeCardLayer = 'all', ns?: string): string {
  return buildPremiumHypeCardArtwork({ ...input, logoUrl: input.logoUrl || brandLogo }, layer, ns);
}
