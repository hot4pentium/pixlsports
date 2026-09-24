import { useCallback, useMemo, useState } from 'react';

export function useSceneControls(baseDurations: Record<string, number>) {
  const sceneKeys = useMemo(() => Object.keys(baseDurations), [baseDurations]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [locked, setLocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mountKey, setMountKey] = useState(0);
  const [tick, setTick] = useState(0);

  const durations = useMemo(() => {
    const key = sceneKeys[activeIndex];
    if (locked) return { [`${key}_r1`]: baseDurations[key], [`${key}_r2`]: baseDurations[key] };
    return Object.fromEntries(
      [...sceneKeys.slice(activeIndex), ...sceneKeys.slice(0, activeIndex)].map((name) => [name, baseDurations[name]]),
    );
  }, [activeIndex, baseDurations, locked, sceneKeys]);
  const onSceneChange = useCallback((rawKey: string) => {
    const index = sceneKeys.indexOf(rawKey.replace(/_r[12]$/, ''));
    if (index >= 0) setActiveIndex(index);
    setTick((value) => value + 1);
  }, [sceneKeys]);
  const jumpTo = useCallback((index: number) => {
    setActiveIndex(index);
    setPaused(false);
    setMountKey((value) => value + 1);
    setTick((value) => value + 1);
  }, []);
  const toggleLock = useCallback(() => {
    setLocked((value) => !value);
    setPaused(false);
    setMountKey((value) => value + 1);
    setTick((value) => value + 1);
  }, []);
  const togglePause = useCallback(() => setPaused((value) => !value), []);
  return {
    sceneKeys, activeIndex, locked, paused, mountKey, tick, durations,
    activeDuration: baseDurations[sceneKeys[activeIndex]] ?? 0,
    activeStartTime: sceneKeys.slice(0, activeIndex).reduce((sum, key) => sum + baseDurations[key], 0),
    totalDuration: Object.values(baseDurations).reduce((sum, value) => sum + value, 0),
    onSceneChange, jumpTo, toggleLock, togglePause,
  };
}