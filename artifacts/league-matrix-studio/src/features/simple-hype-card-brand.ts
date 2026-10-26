import brandLogo from '../assets/pixlsports-logo-640.png?inline';
import { buildSimpleHypeCardArtwork, type SimpleCardInput } from './simple-hype-card-artwork';

export function buildBrandedSimpleArtwork(input: SimpleCardInput, ns?: string): string {
  return buildSimpleHypeCardArtwork({ ...input, logoUrl: input.logoUrl || brandLogo, brandLogoUrl: brandLogo }, ns);
}
export const simpleCardLogoSrc = brandLogo;
