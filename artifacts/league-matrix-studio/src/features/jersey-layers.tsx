import type { SoccerGearLoadout, SoccerGearStateUnlockedGearItem } from '@workspace/api-client-react';
import jerseyPhoto from '@/assets/player-showcase-jersey-base.webp';
import './jersey-layers.css';

export type GearSlot = 'cleats' | 'socks' | 'shorts' | 'shinGuards' | 'sweatband';
/** Supplied art can be tied to a saved style and its server-owned unlock. */
export interface GearAsset {
  src: string;
  label: string;
  style?: string;
  unlock?: SoccerGearStateUnlockedGearItem;
}
export type GearAssetSlots = Partial<Record<GearSlot, GearAsset | null>>;
export const GEAR_ASSET_SLOTS: GearAssetSlots = { cleats: null, socks: null, shorts: null, shinGuards: null, sweatband: null };

export const DEFAULT_JERSEY_COLOR = '#2878F5';
// Match the existing photograph's fabric silhouette, preserving its white trim
// and the blue studio background instead of recoloring the entire photograph.
const SHIRT_MASK = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path fill="white" d="M380 113 Q488 132 594 113 L739 179 C793 214 821 298 852 377 Q786 407 718 422 L700 372 C686 457 672 544 681 643 L714 830 Q488 909 262 833 C274 757 285 704 292 641 C300 547 286 442 274 374 L255 423 Q185 409 122 378 C145 320 170 227 237 179 Q310 149 380 113Z"/></svg>')}")`;

/** Client-side defense only; the server stays authoritative. */
export function gateLoadout(loadout: SoccerGearLoadout, unlocked?: readonly string[] | null): SoccerGearLoadout {
  if (!unlocked) return loadout;
  const has = (item: string) => unlocked.includes(item);
  return {
    ...loadout,
    jerseyStyle: loadout.jerseyStyle === 'stripes' && !has('stripe-jersey') ? 'classic' : loadout.jerseyStyle,
    shortsStyle: loadout.shortsStyle === 'contrast' && !has('contrast-shorts') ? 'classic' : loadout.shortsStyle,
    socksStyle: loadout.socksStyle === 'stripe' && !has('striped-socks') ? 'plain' : loadout.socksStyle,
    cleatsStyle: loadout.cleatsStyle === 'speed' && !has('speed-cleats') ? 'classic' : loadout.cleatsStyle,
    sweatband: loadout.sweatband !== 'none' && !has('sweatbands') ? 'none' : loadout.sweatband,
  };
}

export interface JerseyLayerStageProps {
  loadout: SoccerGearLoadout | null;
  unlockedGear?: readonly string[] | null;
  name: string;
  number: string;
  label: string;
  assets?: GearAssetSlots;
}

export function JerseyLayerStage({ loadout, unlockedGear, name, number, label, assets = GEAR_ASSET_SLOTS }: JerseyLayerStageProps) {
  const gated = loadout ? gateLoadout(loadout, unlockedGear) : null;
  const color = gated?.jerseyColor ?? DEFAULT_JERSEY_COLOR;
  const dyed = Boolean(gated) && color.toLowerCase() !== DEFAULT_JERSEY_COLOR.toLowerCase();
  const striped = gated?.jerseyStyle === 'stripes';
  const styleKeys: Record<GearSlot, keyof SoccerGearLoadout> = {
    cleats: 'cleatsStyle', socks: 'socksStyle', shorts: 'shortsStyle',
    shinGuards: 'shinGuards', sweatband: 'sweatband',
  };
  const styleForSlot = (slot: GearSlot) => gated?.[styleKeys[slot]];
  const slots = (Object.keys(assets) as GearSlot[]).filter((slot) => {
    const asset = assets[slot];
    return gated && asset && (slot !== 'sweatband' || gated.sweatband !== 'none')
      && (!asset.style || asset.style === styleForSlot(slot))
      && (!asset.unlock || Boolean(unlockedGear?.includes(asset.unlock)));
  });
  return (
    <div className="ps__photo-wrap pjk" data-testid="jersey-layer-stage" data-jersey-color={color} data-jersey-style={gated?.jerseyStyle ?? 'classic'} data-gear-fallback={slots.length ? 'images' : 'clear'}>
      <img className="ps__jersey-photo" src={jerseyPhoto} alt={label} data-testid="image-showcase-jersey" />
      {(dyed || striped) && (
        <div className="pjk__shirt" style={{ maskImage: SHIRT_MASK, WebkitMaskImage: SHIRT_MASK }} aria-hidden="true" data-testid="layer-jersey-shirt">
          {dyed && <img className="pjk__gray" src={jerseyPhoto} alt="" />}
          {dyed && <span className="pjk__dye" style={{ backgroundColor: color }} data-testid="layer-jersey-dye" />}
          {striped && <span className="pjk__stripes" data-testid="layer-jersey-stripes" />}
        </div>
      )}
      <span className="ps__photo-name" aria-hidden="true">{name.toUpperCase().slice(0, 14)}</span>
      <span className="ps__photo-number" aria-hidden="true">{number}</span>
      {slots.length > 0 && gated && (
        <div className="pjk__gear" data-testid="layer-gear-row">
          {slots.map((slot) => (
            <img key={slot} src={assets[slot]!.src} alt={assets[slot]!.label} className="pjk__gear-img" data-testid={`layer-gear-${slot}`} data-style={String(styleForSlot(slot))} />
          ))}
        </div>
      )}
    </div>
  );
}
