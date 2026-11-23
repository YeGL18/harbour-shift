import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlayerMatchReview,ReviewTimelineEvent } from '../../shared/protocol';
import { comparisonPlayers,projectReviewRoutes,timelinePage } from './reviewPresentation';
const player=(playerId:string,netIncome:number):PlayerMatchReview=>({playerId,nickname:playerId,netIncome,grossIncome:100,operatingCost:20,rentalCost:30,idleMinutes:60,completedTrips:2,acceptedOffers:3,declinedOffers:1,cancelledTrips:1,totalDistanceM:2000,forfeited:false,route:[],timeline:[],timelineTruncated:false});
test('comparison uses real players and never compares one player to themselves',()=>{
  const players=[player('a',-50),player('b',70)];
  const pair=comparisonPlayers(players,'missing','a','a');assert.equal(pair.primary?.playerId,'a');assert.equal(pair.secondary?.playerId,'b');assert.equal(pair.primary?.netIncome,-50);
  assert.equal(comparisonPlayers(players.slice(0,1),'a','a','a').secondary,undefined);
});
test('sample projection retains time/order, handles stationary/no-data routes and stays inside bounds',()=>{
  const routes=[[{lat:22.3,lon:114.1,minute:0},{lat:22.31,lon:114.12,minute:15}],[{lat:22.3,lon:114.1,minute:0}]];
  const projected=projectReviewRoutes(routes,300,150);assert.deepEqual(projected[0].map(p=>p.minute),[0,15]);
  assert.ok(projected.flat().every(p=>p.x>=0&&p.x<=300&&p.y>=0&&p.y<=150));assert.deepEqual(projectReviewRoutes([[]],300,150),[[]]);
});
test('timeline pagination preserves every supplied actual event exactly once without fabricating gaps',()=>{
  const events:ReviewTimelineEvent[]=Array.from({length:19},(_,minute)=>({minute,type:'accept',amount:minute===0?0:undefined}));
  const shown=[0,1,2].flatMap(page=>timelinePage(events,page).events);assert.deepEqual(shown,events);assert.equal(shown[0].amount,0);
  assert.equal(timelinePage(events,99).index,2);assert.equal(timelinePage([],0).start,0);
});
