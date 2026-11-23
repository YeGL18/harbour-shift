import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import type { Coordinate } from '../game/types';

export interface TripOverviewRequest { id: string; coordinates: Coordinate[] }
export interface SavedMapView { zoom: number; pitch: number; bearing: number }
interface Options {
  request?: TripOverviewRequest | null;
  loaded: boolean;
  reducedMotion: boolean;
  cameraRef: RefObject<CameraRef | null>;
  position: Coordinate;
  userView: RefObject<SavedMapView>;
  topInset: number;
  bottomInset: number;
  selectorSpace: number;
  padding: { top: number; right: number; bottom: number; left: number };
  restoreBearing: () => number;
  /** Airport inspection can restore its previous free-view centre. */
  restoreCenter?: () => Coordinate;
  onStart: () => void;
  onRestore: (view: SavedMapView, bearing: number) => void;
  /** null keeps an offer preview open until its request disappears. */
  durationMilliseconds?: number | null;
  debugName?: string;
}

/** A real-time camera interlude; simulation speed never changes its five seconds. */
export function useTripOverview(options: Options) {
  const latest = useRef(options); latest.current = options;
  const seenId = useRef<string | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saved = useRef<SavedMapView | null>(null);
  const deadline = useRef<number | null>(null);
  const activeRef = useRef(false);
  const [coordinates, setCoordinates] = useState<Coordinate[] | null>(null);

  const cancel = (restore = false) => {
    if (!activeRef.current) return false;
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    deadline.current = null;
    activeRef.current = false;
    console.info(`[${latest.current.debugName || 'TripOverview'}] finish`, { id: seenId.current, restore, at: Date.now() });
    setCoordinates(null);
    if (restore) {
      const current = latest.current;
      const view = saved.current || current.userView.current;
      const bearing = current.restoreBearing();
      const center = current.restoreCenter?.() || current.position;
      current.onRestore(view, bearing);
      current.cameraRef.current?.easeTo({
        center: [center.lon, center.lat],
        zoom: view.zoom, pitch: view.pitch, bearing,
        padding: current.padding,
        duration: current.reducedMotion ? 0 : 450,
      });
    }
    return true;
  };

  const canFit = Boolean(options.request && options.request.coordinates.length > 1);
  const scheduleExpiry = () => {
    if(timer.current || !activeRef.current || deadline.current===null)return;
    timer.current=setTimeout(()=>{timer.current=null;cancel(true);},Math.max(0,deadline.current-Date.now()));
  };
  useEffect(() => {
    const current = latest.current;
    if (!current.request || !canFit) { cancel(true); if(current.durationMilliseconds===null)seenId.current=null; return; }
    if (!current.loaded) return;
    if(seenId.current===current.request.id){scheduleExpiry();return;}
    if(timer.current)clearTimeout(timer.current);
    timer.current=null;
    seenId.current = current.request.id;
    const token = ++generation.current;
    const route = current.request.coordinates.map(point => ({ ...point }));
    saved.current = { ...current.userView.current };
    activeRef.current = true;
    setCoordinates(route);
    current.onStart();
    // Capture the settled user viewport synchronously before the fit begins.
    // A getter during style/camera transitions is not a user preference.
    // Overview viewport events must never overwrite this saved value.
    {
      if (generation.current !== token) return;
      let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
      for (const point of route) {
        west = Math.min(west, point.lon); east = Math.max(east, point.lon);
        south = Math.min(south, point.lat); north = Math.max(north, point.lat);
      }
      // Give a tiny/straight trip a usable bounding box as well.
      const dx = Math.max(.00035, (east - west) * .06), dy = Math.max(.00035, (north - south) * .06);
      const now = latest.current;
      now.cameraRef.current?.fitBounds([west - dx, south - dy, east + dx, north + dy], {
        bearing: 0, pitch: 0,
        padding: { top: now.topInset + 24, right: 76, bottom: now.bottomInset + now.selectorSpace + 24, left: 28 },
        duration: now.reducedMotion ? 0 : 450,
      });
      const duration = current.durationMilliseconds === undefined ? 5000 : current.durationMilliseconds;
      deadline.current=duration === null ? null : Date.now()+duration;
      console.info(`[${current.debugName || 'TripOverview'}] start`, { id:current.request.id, zoom:saved.current?.zoom, deadline:deadline.current });
      scheduleExpiry();
    }
    // Dependency changes are handled explicitly above. Clearing here can leave
    // a preserved active view without a timer when seenId blocks a restart.
  }, [options.loaded, options.request?.id, canFit, options.durationMilliseconds]);
  useEffect(()=>{
    return () => {
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  },[]);

  return { coordinates, activeRef, cancel };
}
