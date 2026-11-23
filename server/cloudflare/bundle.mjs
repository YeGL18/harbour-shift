import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.env.HARBOUR_WORKER_OUTPUT ? resolve(process.env.HARBOUR_WORKER_OUTPUT) : resolve(project, '../harbour-shift-backend/worker/index.js');
await mkdir(dirname(output), { recursive: true });
const precompute=await tsImport(resolve(project,'server/cloudflare/precompute.ts'),{parentURL:import.meta.url});
const exclusions=precompute.legalGraphExclusions();
console.log(`Precomputed legal profiles: taxi ${exclusions.taxi.nodeCount}/${exclusions.taxi.edgeCount}, private ${exclusions.private.nodeCount}/${exclusions.private.edgeCount}`);
const result = await build({
  entryPoints: [resolve(project, 'server/cloudflare/index.ts')], outfile: output,
  // Build an authority factory rather than evaluating the complete HK graph
  // and catalog at module startup. The native loaders themselves are unchanged.
  bundle: true, format: 'iife', globalName:'HarbourAuthority', write:false, platform: 'browser', target: 'es2022', minify: true,
  metafile: true, legalComments: 'none',
  plugins: [{
    name: 'release-worker-only-raw-data',
    setup(build) {
      build.onResolve({filter:/^harbour:legal-exclusions$/},()=>({path:'legal-exclusions',namespace:'precomputed-hk'}));
      build.onLoad({filter:/.*/,namespace:'precomputed-hk'},()=>({contents:`export default JSON.parse(${JSON.stringify(JSON.stringify(exclusions))});`,loader:'js'}));
      // Keep the compact road/POI module format. A JSON.parse string variant
      // retained large raw constants and failed the populated 112MiB heap gate.
      build.onLoad({filter:/\/src\/data\/vehicleAccess\.ts$/},async({path})=>{
        let source=await readFile(path,'utf8');
        const signature='export function getVehicleAccessGraph(graph: RoadGraph, vehicleId: VehicleId): RoadGraph {';
        if(!source.includes(signature))throw new Error('Vehicle-access entry changed; verify server-only precomputed hook');
        source=source.replace(signature,signature+'\n  preparePrecomputedProfiles(graph);');
        source=`import profiles from 'harbour:legal-exclusions';\n${source}\nfunction preparePrecomputedProfiles(graph:RoadGraph):void {\n if(graph!==ROAD_GRAPH||graphCache.has(graph))return;\n const cache=new Map<string,RoadGraph>();\n for(const [key,excluded] of [['urban-taxi',profiles.taxi],['private',profiles.private]] as const){\n  const nodes={...graph.nodes},edges={...graph.edges},outgoing={[excluded.firstNode]:graph.outgoing[excluded.firstNode],...graph.outgoing};\n  for(const id of excluded.nodes){delete nodes[id];delete outgoing[id];}\n  const changed=new Set<string>();\n  for(const id of excluded.edges){const edge=graph.edges[id];if(!edge)throw new Error('Precomputed road ID mismatch');changed.add(edge.from);delete edges[id];}\n  for(const id of changed)if(outgoing[id])outgoing[id]=outgoing[id].filter(edgeId=>!!edges[edgeId]);\n  const result:RoadGraph={nodes,edges,outgoing};\n  graphCache.set(result,new Map([[key,result]]));cache.set(key,result);\n  excluded.nodes.length=0;excluded.edges.length=0;\n }\n graphCache.set(graph,cache);\n}\n`;
        return{contents:source,loader:'ts',resolveDir:dirname(path)};
      });
      build.onLoad({ filter: /\/src\/(map\/roadGraph|data\/landmarks)\.ts$/ }, async ({ path }) => {
        const text = await readFile(path, 'utf8');
        // These changes apply only to the server bundle, never the mobile game.
        const release = path.endsWith('/roadGraph.ts') ? '\nsource.roads.length = 0;' : '\ncatalog.rows.length = 0;';
        return { contents: text + release, loader: 'ts', resolveDir: dirname(path) };
      });
    },
  }],
});
const factory=result.outputFiles[0].text;
const version=`v6-${createHash('sha256').update(factory).digest('hex').slice(0,12)}`;
const source=`let instance;\nfunction initializeAuthority(){\n${factory}\nreturn HarbourAuthority.default;\n}\nexport default {async fetch(request,env,ctx,trustedIngressAt){const receivedAt=Number.isFinite(trustedIngressAt)?trustedIngressAt:Date.now();const cold=!instance;const started=Date.now();if(cold){instance=initializeAuthority();await new Promise(resolve=>setTimeout(resolve,1));}const initMs=cold?Math.max(0,Date.now()-started):0;const response=await instance.fetch(request,env,ctx,receivedAt);const headers=new Headers(response.headers);headers.set('X-Harbour-Build',${JSON.stringify(version)});headers.set('X-Harbour-Cold-Init',cold?'1':'0');headers.append('Server-Timing','lazyinit;dur='+initMs);return new Response(response.body,{status:response.status,statusText:response.statusText,headers,encodeBody:'manual'});}};\n`;
await writeFile(output,source);
await writeFile(resolve(dirname(output), 'bundle-inputs.json'), JSON.stringify(result.metafile, null, 2) + '\n');
console.log(`Bundled Worker: ${output}`);
console.log(`Uncompressed bytes: ${Buffer.byteLength(source)}`);
console.log(`Build header: ${version}`);
