import {useEffect, useRef, useState} from 'react';
import {refreshMapDemand, type MapDemandSnapshot} from '../game/mapDemand';
import type {GameState, SurgeArea} from '../game/types';

const EMPTY: SurgeArea[] = [];

export function useDemandDisplay(game: GameState | null, session: string, ready: boolean, online: boolean): SurgeArea[] {
  const latest = useRef(game);
  latest.current = game;
  const [held, setHeld] = useState<{session: string; value?: MapDemandSnapshot}>();
  const requestCount = game?.mapDemandRequests?.length ?? 0;
  useEffect(() => {
    if (online || !ready) return;
    const refresh = () => {
      const state = latest.current;
      if (!state) return;
      setHeld(previous => {
        const sameSession = previous?.session === session ? previous : undefined;
        const value = refreshMapDemand(sameSession?.value, state, state.mapDemandRequests ?? [], Date.now());
        return sameSession?.value === value ? sameSession : {session, value};
      });
    };
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [online, ready, session, requestCount > 0]);
  if (online) return game?.mapDemandDisplay?.areas ?? EMPTY;
  return held?.session === session ? held.value?.areas ?? EMPTY : EMPTY;
}
