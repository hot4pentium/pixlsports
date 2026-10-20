import type { GearSport, SportGearItem } from '@workspace/api-client-react';
import { getGetSportGearArtUrl } from '@workspace/api-client-react';
import './sport-gear-collection.css';

const ids: Record<GearSport, string[]> = {
  football: ['helmet', 'pads', 'gloves', 'cleats'],
  soccer: ['ball', 'shin-guards', 'cleats', 'wristbands'],
  basketball: ['ball', 'shoes', 'arm-sleeve', 'headband'],
  baseball: ['glove', 'bat', 'ball', 'jersey'],
  softball: ['glove', 'bat', 'helmet', 'cleats'],
  volleyball: ['ball', 'knee-pads', 'shoes', 'wristbands'],
};
const title = (sport: GearSport, id: string) => {
  if (sport === 'baseball') {
    if (id === 'ball') return 'Baseball';
    if (id === 'jersey') return 'Baseball jersey';
  }
  return id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
};

export function sportGearItems(sport: GearSport): { id: string; label: string }[] {
  return ids[sport].map((n) => ({ id: `${sport}-${n}`, label: title(sport, n) }));
}

// The API is its own artifact mounted at /api, independent of the studio base.
const baseballPackIds = new Set(['baseball-ball', 'baseball-bat', 'baseball-glove', 'baseball-jersey']);
const url = (id: string, outline: boolean) => {
  const asset = baseballPackIds.has(id) ? `${id}-pack` : id;
  return getGetSportGearArtUrl(`${asset}${outline ? '-outline' : ''}.webp`);
};

export function SportGearArt({ id, label, earned }: { id: string; label: string; earned: boolean }) {
  return (
    <img
      className="sgc-art"
      src={url(id, !earned)}
      alt={earned ? label : `${label}, locked outline`}
      loading="lazy"
      data-testid={`gear-art-${id}`}
      data-earned={earned ? 'true' : 'false'}
    />
  );
}

export function SportGearCollection({ sport, earnedGear, equippedGear = [], items }: { sport: GearSport; earnedGear: string[]; equippedGear?: string[]; items?: SportGearItem[] }) {
  const list = items?.length ? items : sportGearItems(sport);
  return (
    <div className="sgc" data-testid={`collection-sport-gear-${sport}`}>
      {list.map((i) => {
        const earned = earnedGear.includes(i.id);
        const eq = earned && equippedGear.includes(i.id);
        return (
          <figure className="sgc-item" key={i.id} data-equipped={eq} data-testid={`collection-item-${i.id}`}>
            <SportGearArt id={i.id} label={i.label} earned={earned} />
            <figcaption>{i.label}<small>{eq ? 'Equipped' : earned ? 'Earned' : 'Locked'}</small></figcaption>
          </figure>
        );
      })}
    </div>
  );
}
