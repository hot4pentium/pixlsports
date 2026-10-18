import type { GearSport } from '@workspace/api-client-react';
import { getGetSportGearArtUrl } from '@workspace/api-client-react';
import { sportGearItems } from './sport-gear-collection';
import './jersey-gear-table.css';

export type JerseyTableGear = {
  sport: GearSport;
  earnedGear: readonly string[];
  equippedGear: readonly string[];
};

export function JerseyGearTable({ gear }: { gear: JerseyTableGear }) {
  const earned = new Set(gear.earnedGear);
  const equipped = new Set(gear.equippedGear);
  const items = sportGearItems(gear.sport).filter((item) => earned.has(item.id) && equipped.has(item.id));
  if (!items.length) return null;

  return (
    <div
      className="jersey-gear-table"
      role="img"
      aria-label={`Equipped gear on the display table: ${items.map((item) => item.label).join(', ')}`}
      data-testid={`jersey-gear-table-${gear.sport}`}
    >
      <div className="jersey-gear-table__surface" aria-hidden="true" />
      <div className="jersey-gear-table__items" aria-hidden="true">
        {items.map((item) => (
          <img
            key={item.id}
            src={getGetSportGearArtUrl(`${item.id}.webp`)}
            alt=""
            decoding="async"
            data-testid={`jersey-table-gear-${item.id}`}
          />
        ))}
      </div>
    </div>
  );
}
