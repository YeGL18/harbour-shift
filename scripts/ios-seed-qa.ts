/** Simulator-only fixture. This is not imported by, or shipped in, the app. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { acceptOffer, advanceGame, createInitialState, declineOffer, VEHICLE_BY_ID } from '../src/game';

const device = process.env.HARBOUR_SIMULATOR_ID;
if (!device) throw new Error('Set HARBOUR_SIMULATOR_ID to the UUID of a dedicated test simulator');
const bundle = 'com.ygl100.harbourshift';
const key = 'harbour-shift.session.v2';
const mode = process.argv[2] || 'summary';
if (!['summary', 'boundary', 'waiting', 'driving', 'clear'].includes(mode)) throw new Error('Use summary, boundary, waiting, driving or clear');
try { execFileSync('xcrun', ['simctl', 'terminate', device, bundle], { stdio: 'ignore' }); } catch {}
const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, bundle, 'data'], { encoding: 'utf8' }).trim();
const folder = join(container, 'Library', 'Application Support', bundle, 'RCTAsyncLocalStorage_V1');
mkdirSync(folder, { recursive: true });
const manifestPath = join(folder, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const payloadPath = join(folder, createHash('md5').update(key).digest('hex'));
if (mode === 'clear') {
  delete manifest[key];
  if (existsSync(payloadPath)) unlinkSync(payloadPath);
} else {
  const initial = createInitialState({ vehicleId: 'kam-fung', seed: 20261118 });
  let game = mode === 'boundary' ? advanceGame(declineOffer(initial), 17.5) : mode === 'waiting' || mode === 'driving' ? acceptOffer(initial) : initial;
  if (mode === 'driving') {
    for (let i = 0; i < 250 && game.phase !== 'dropoff'; i++) game = advanceGame(game, .05);
    if (game.phase !== 'dropoff') throw new Error('Driving fixture did not reach dropoff');
  }
  if (mode === 'waiting' && game.activeTrip) {
    game.phase = 'waiting';
    game.activeTrip.waitMinutes = 9;
    game.activeTrip.boardingMinutes = 1;
    game.activeTrip.arrivedAt = game.clockMinutes;
    game.activeTrip.phaseEndsAt = game.clockMinutes + 9;
    game.movement.edgeId = game.activeTrip.offer.pickupRoute.at(-1) ?? game.movement.edgeId;
    game.movement.distanceOnEdgeM = 0;
    game.movement.nextEdgeIds = [];
  }
  game.currentOffer = null;
  if (mode === 'summary') {
    game.clockMinutes = 719.9;
    game.nextDemandMinute = 721;
    game.nextEventMinute = 800;
    game.grossIncome = 1800;
    game.operatingCost = 200;
    game.netIncome = 1800 - 200 - VEHICLE_BY_ID['kam-fung'].rentalCost;
    game.wallet = game.netIncome;
    game.completedTrips = 16;
    game.acceptedOffers = 16;
    game.declinedOffers = 6;
    game.totalDistanceM = 112000;
  } else {
    game.nextDemandMinute = game.clockMinutes + 30;
    game.nextEventMinute = game.clockMinutes + 30;
  }
  const { landmarks: _catalogue, ...smallGame } = game;
  const value = JSON.stringify({ game: smallGame, vehicleId: 'kam-fung', appearance: 'light', speed: 10, density: 'busy', shift: 'day' });
  writeFileSync(payloadPath, value);
  manifest[key] = null;
}
writeFileSync(manifestPath, JSON.stringify(manifest));
console.log(`Seeded ${mode} fixture for ${bundle} on the dedicated QA simulator.`);
