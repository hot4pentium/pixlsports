import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetSportGearForAthleteQueryKey, useGetSportGearForAthlete, useSaveSportGear } from '@workspace/api-client-react';
import type { GearSport, SportGearLoadout, SportGearState } from '@workspace/api-client-react';
import { FootballJerseyPreview } from './football-jersey-preview';
import { SportGearArt, sportGearItems } from './sport-gear-collection';
import './sport-gear-builder.css';

const palette = [
  ['Pixl blue', '#2878F5'], ['Coral', '#F36E4C'], ['Lime', '#D7EF80'],
  ['Deep navy', '#173758'], ['Cloud', '#F6F5EA'], ['Violet', '#7455B8'],
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function SportGearBuilderPage({ accountId, sport, athleteName, jerseyNumber, athleteRestricted = false }: {
  accountId: string; sport: GearSport; athleteName: string; jerseyNumber: string; athleteRestricted?: boolean;
}) {
  const qc = useQueryClient();
  const params = { sport, ...(athleteName.trim() ? { athleteName: athleteName.trim() } : {}) };
  const scoped = [...getGetSportGearForAthleteQueryKey(params), accountId] as const;
  const q = useGetSportGearForAthlete(params, {
    query: { queryKey: [...getGetSportGearForAthleteQueryKey(params), accountId], enabled: !!accountId, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 20000, retry: false },
  });
  const save = useSaveSportGear();
  const [draft, setDraft] = useState<SportGearLoadout | null>(null);
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState<{ l: SportGearLoadout; s: boolean } | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const [cardRequired, setCardRequired] = useState(false);
  const identity = `${accountId}|${sport}|${athleteName.trim().toLowerCase()}`;
  const idRef = useRef(identity);
  const server = q.data as SportGearState | undefined;
  const athleteRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (idRef.current !== identity) {
      idRef.current = identity;
      setDraft(null); setSaved(null); setErr(''); setOk(false); setShow(false); setCardRequired(false);
      athleteRef.current = undefined;
    }
  }, [identity]);

  useEffect(() => {
    if (!server || server.sport !== sport) return;
    const s = { l: server.loadout, s: server.showOnHypeCard };
    const changedAthlete = athleteRef.current !== server.athleteId;
    athleteRef.current = server.athleteId;
    if (server.athleteId) setCardRequired(false);
    const dirty = !changedAthlete && draft && saved && (JSON.stringify(draft) !== JSON.stringify(saved.l) || (!athleteRestricted && show !== saved.s));
    setSaved(s);
    if (!draft || !dirty) { setDraft(server.loadout); setShow(server.showOnHypeCard); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  const items = useMemo(() => {
    const base = sportGearItems(sport);
    return base.map((b) => ({ ...b, requirement: '', earned: false, ...(server?.items.find((i) => i.id === b.id) ?? {}) }));
  }, [server, sport]);

  const name = server?.athleteName || athleteName;
  const head = (
    <>
      <div><Link href="/studio/player-showcase" data-testid="link-sport-gear-back">Back to showcase</Link>
        {sport === 'soccer' && <> · <Link href={athleteRestricted ? '/studio/player-showcase/soccer-kit' : '/studio/soccer-gear'} data-testid="link-soccer-gear">Soccer kit builder</Link></>}</div>
      <h1 data-testid="text-sport-gear-title">{cap(sport)} gear</h1>
      <p>Locked equipment stays a white outline. Earn it through your family’s activity, then equip the full-color gear.</p>
    </>
  );

  if (q.isLoading) return <main className="sgb">{head}<div className="sgb-skel" data-testid="status-sport-gear-loading" /></main>;
  if (q.isError) return (
    <main className="sgb">{head}
      <div role="alert" className="sgb-err" data-testid="status-sport-gear-error">Couldn’t open your gear right now.{' '}
        <button className="sgb-btn" type="button" onClick={() => q.refetch()} data-testid="button-retry-sport-gear">Try again</button></div>
    </main>
  );
  if (!server || !draft || !saved) return <main className="sgb">{head}<div className="sgb-skel" /></main>;

  const earned = new Set(items.filter((i) => i.earned).map((i) => i.id));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.l) || (!athleteRestricted && show !== saved.s);
  const canSave = server.canSave && !!server.athleteId;
  const busy = save.isPending;
  const set = (l: SportGearLoadout) => { if (busy) return; setDraft(l); setErr(''); setOk(false); };
  const toggle = (id: string) => {
    if (!earned.has(id)) return;
    const has = draft.equippedGear.includes(id);
    set({ ...draft, equippedGear: has ? draft.equippedGear.filter((x) => x !== id) : [...draft.equippedGear, id].slice(-4) });
  };
  const doSave = () => {
    if (!server.athleteId) { setCardRequired(true); return; }
    setErr('');
    const equippedGear = draft.equippedGear.filter((id) => earned.has(id));
    save.mutate({ sport, data: { athleteId: server.athleteId, loadout: { ...draft, equippedGear }, showOnHypeCard: athleteRestricted ? server.showOnHypeCard : show } }, {
      onSuccess: (next) => {
        qc.setQueryData(scoped, next);
        setDraft(next.loadout); setShow(next.showOnHypeCard); setSaved({ l: next.loadout, s: next.showOnHypeCard }); setOk(true); setCardRequired(false);
        void qc.invalidateQueries({ predicate: (k) => { const f = k.queryKey[0]; return typeof f === 'string' && (f === getGetSportGearForAthleteQueryKey(params)[0] || f.startsWith('/api/sport-gear') || (f.startsWith('/api/athlete-invites/') && f.endsWith('/fan'))); } });
      },
      onError: () => setErr('That save didn’t stick. Check your connection and try again.'),
    });
  };
  const color = draft.jerseyColor;
  const statusText = busy ? 'Saving' : err ? err : dirty ? 'Unsaved changes' : ok ? 'Saved' : 'All changes saved';

  return (
    <main className="sgb" data-testid={`page-sport-gear-${sport}`}>
      {head}
      <div className="sgb-grid">
        <section className="sgb-card" aria-label="Preview">
          <strong data-testid="text-sport-gear-athlete">{name.trim() || 'Your player'}</strong>
          {sport === 'football' && <FootballJerseyPreview name={name.trim().split(/\s+/)[0] || 'Player'} number={jerseyNumber.replace(/^#/, '')} label={`${name} football jersey`} accent={color} />}
          <div className="sgb-items" style={{ marginTop: 10 }}>
            {items.filter((i) => draft.equippedGear.includes(i.id) && i.earned).map((i) => <SportGearArt key={i.id} id={i.id} label={i.label} earned />)}
          </div>
          {sport !== 'football' && !draft.equippedGear.some((id) => earned.has(id)) && <p>Equip earned equipment to build your look.</p>}
          {sport === 'football' && <div className="sgb-colors" role="group" aria-label="Jersey color">
            {palette.map(([label, c]) => (
              <button key={c} type="button" className="sgb-swatch" style={{ background: c }} aria-label={label} disabled={busy}
                aria-pressed={color.toLowerCase() === c.toLowerCase()} onClick={() => set({ ...draft, jerseyColor: c })} data-testid={`button-sport-color-${label.toLowerCase().replace(' ', '-')}`} />
            ))}
            <input type="color" aria-label="Custom jersey color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#2878F5'} disabled={busy}
              onChange={(e) => set({ ...draft, jerseyColor: e.target.value.toUpperCase() })} data-testid="input-sport-jersey-color" />
          </div>}
        </section>
        <section className="sgb-card" aria-label="Gear">
          <div className="sgb-items">
            {items.map((i) => {
              const on = draft.equippedGear.includes(i.id) && i.earned;
              const inner = (<>
                <SportGearArt id={i.id} label={i.label} earned={i.earned} />
                <strong>{i.label}</strong>
                <small>{i.earned ? (on ? 'Equipped, tap to remove' : 'Tap to equip') : `Locked${i.requirement ? ': ' + i.requirement : ''}`}</small>
              </>);
              return (
                <button key={i.id} type="button" className="sgb-item" aria-pressed={on} disabled={!i.earned || busy}
                  aria-label={i.earned ? `${on ? 'Unequip' : 'Equip'} ${i.label}` : `${i.label}, locked. ${i.requirement}`} onClick={() => toggle(i.id)} data-testid={`button-equip-${i.id}`}>{inner}</button>
              );
            })}
          </div>
          {!athleteRestricted && (
            <label className="sgb-row">
              <input type="checkbox" checked={show} disabled={busy} onChange={(e) => { setShow(e.target.checked); setOk(false); setCardRequired(false); }} data-testid="toggle-sport-gear-public" />
              Show gear on the public HYPE Card and Showcase
            </label>
          )}
          {!canSave && <p data-testid="text-sport-gear-cannot-save">{athleteRestricted
            ? 'Your parent or guardian needs to finish athlete setup before saving.'
            : <>No HYPE Card matches {name.trim() ? `${name}’s` : 'this athlete’s'} {sport} gear. <Link href="/studio/hype-card" data-testid="link-sport-gear-create-card">Open HYPE Cards</Link> to create or finish the matching card before saving.</>}</p>}
          {cardRequired && <p role="status" data-testid="status-sport-gear-card-required">
            {athleteRestricted ? 'Ask your parent or guardian to finish your HYPE Card setup before saving.' : <>This gear is not saved yet. Create or finish the matching HYPE Card, then return to save it. <Link href="/studio/hype-card" data-testid="link-sport-gear-save-card">Open HYPE Cards</Link>.</>}
          </p>}
          <div className="sgb-row">
            <span role="status" className={err ? 'sgb-err' : ''} data-testid="status-sport-gear-save">{statusText}</span>
            {err && <button type="button" className="sgb-btn alt" onClick={doSave} data-testid="button-retry-sport-gear-save">Retry</button>}
            <button type="button" className="sgb-btn alt" disabled={!dirty || busy} onClick={() => { setDraft(saved.l); setShow(saved.s); setErr(''); }} data-testid="button-reset-sport-gear">Reset</button>
            <button type="button" className="sgb-btn" disabled={!dirty || busy} onClick={doSave} data-testid="button-save-sport-gear">{busy ? 'Saving…' : 'Save gear'}</button>
          </div>
          <div data-testid="text-sport-gear-progress" style={{ fontSize: 12, opacity: .75, marginTop: 10 }}>
            {server.progress.activeWeeks} active weeks · {server.progress.eventCardsCreated} event cards · {server.progress.trackerGamesCompleted} tracker games · HYPE card {server.progress.hypeCardShared ? 'shared' : 'not shared'}
          </div>
        </section>
      </div>
    </main>
  );
}
