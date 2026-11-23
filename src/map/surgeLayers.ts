import type { FeatureCollection, Point } from 'geojson';
import type { HeatmapLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { SurgeArea } from '../game/types';

export const SURGE_COLORS = { quiet: '#FFC44D', normal: '#FF923F', busy: '#F56716', surge: '#AE3E9D' } as const;
/** Darker badge surfaces keep small white wait labels legible. */
export const WAIT_PILL_COLORS = { normal: '#B75A1B', busy: '#C04B08', surge: '#92328C' } as const;
function hash(value: string): number { let h=2166136261;for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619);return h>>>0; }
export function surgeLevel(area: SurgeArea): keyof typeof SURGE_COLORS {
  return area.level ?? (area.waitMinutesMin >= 6 ? 'quiet' : area.multiplier >= 1.3 ? 'surge' : area.multiplier > 1 ? 'busy' : 'normal');
}

/** An optimistic lower bound, with the world's upper estimate preserved. */
export function demandWaitLabel(area: SurgeArea): string {
  const maximum=surgeLevel(area)==='surge'?1:Math.max(1,Math.ceil(Number.isFinite(area.waitMinutesMax)?area.waitMinutesMax:1));
  return maximum===1?'1 分鐘':`1–${maximum} 分鐘`;
}

/** Keep low/medium fields yellow/orange even when neighbouring lobes overlap. */
export function demandHeatLayers(dark: boolean): HeatmapLayerSpecification[] {
  const ramps = {
    quiet: ['rgba(255,211,87,0)','rgba(255,211,87,0.24)','rgba(255,211,87,0.43)','rgba(255,211,87,0.58)'],
    normal: ['rgba(255,171,90,0)','rgba(255,171,90,0.28)','rgba(255,147,63,0.55)','rgba(255,147,63,0.70)'],
    busy: ['rgba(248,139,49,0)','rgba(248,139,49,0.30)','rgba(240,103,28,0.60)','rgba(237,88,15,0.77)'],
    surge: ['rgba(246,80,69,0)','rgba(246,80,69,0.35)','rgba(220,52,125,0.73)','rgba(152,43,173,0.90)'],
  } as const;
  return (Object.keys(ramps) as Array<keyof typeof ramps>).map(level=>({
    id:`demand-soft-${level}`,type:'heatmap',source:'demand-heat',filter:['==',['get','level'],level],paint:{
      'heatmap-weight':['get','weight'],'heatmap-intensity':1.5,
      'heatmap-radius':['interpolate',['exponential',2],['zoom'],8,['*',['get','radiusAtZoom14'],1/64],14,['get','radiusAtZoom14'],18.5,['*',['get','radiusAtZoom14'],2**4.5]],
      'heatmap-opacity':dark?.42:.48,
      'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,ramps[level][0],.12,ramps[level][1],.5,ramps[level][2],1,ramps[level][3]],
    },
  }));
}

/** Local soft demand pockets, derived from the same deterministic world field. */
export function makeSurgeLayers(areas: SurgeArea[]) {
  const heat: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
  const labels: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
  for (const area of areas) {
    const level=surgeLevel(area),seed=hash(area.id);
    const strength=Math.max(0,Math.min(1,Number.isFinite(area.intensity)?area.intensity!:{quiet:.12,normal:.28,busy:.58,surge:.95}[level]));
    const footprint=Number.isFinite(area.radiusM)&&area.radiusM!>0?area.radiusM!:{quiet:1400,normal:2000,busy:2800,surge:3600}[level];
    // Native heatmap radius is in screen points. A per-feature radius at zoom
    // 14, combined with the layer's exponential zoom expression, preserves the
    // engine's metre footprint while inspecting or pitching the map.
    const radiusAtZoom14=footprint*.6/(78271.51696*Math.cos(area.center.lat*Math.PI/180)/2**14);
    const properties={id:area.id,level,multiplier:area.multiplier,color:SURGE_COLORS[level],label:demandWaitLabel(area)};
    const marker = area.pickupDot ?? area.center;
    labels.features.push({type:'Feature',id:area.id,properties,geometry:{type:'Point',coordinates:[marker.lon,marker.lat]}});
    // Uneven overlapping lobes form a soft local patch, never a district fill.
    // Quiet areas get a faint yellow cloud, never an orange/red hot spot. The area
    // stays anchored; a new supply/demand sample changes its strength.
    for(let i=0;i<9;i++) {
      const angle=((seed%360)+i*137.508)*Math.PI/180;
      const radius=i===0?0:footprint*(.16+((seed>>>((i%4)*5))%25)/100);
      const stretch=.6+((seed>>>8)%65)/100;
      const lat=area.center.lat+Math.sin(angle)*radius*stretch/111195;
      const lon=area.center.lon+Math.cos(angle)*radius/(111195*Math.cos(area.center.lat*Math.PI/180));
      heat.features.push({type:'Feature',properties:{level,weight:strength*(i===0?1:.45+((seed>>>i)%30)/100),radiusAtZoom14},geometry:{type:'Point',coordinates:[lon,lat]}});
    }
  }
  return {heat:JSON.stringify(heat),labels:JSON.stringify(labels)};
}
export const surgeSignature=(areas:SurgeArea[])=>areas.map(area=>[
  area.id,area.pickupDot?.lat,area.pickupDot?.lon,area.level,area.multiplier,area.waitMinutesMin,area.waitMinutesMax,
  Math.round(area.center.lat*111195/50),Math.round(area.center.lon*111195*Math.cos(area.center.lat*Math.PI/180)/50),
  Math.round((area.radiusM||0)/80),Math.round((area.intensity||0)*100),Math.floor((area.sampledAtMinute||0)*2),
].join(':')).join('|');
