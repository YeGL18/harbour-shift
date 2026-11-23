import assert from 'node:assert/strict';
import test from 'node:test';
import {CommonActions,StackActions,StackRouter} from '@react-navigation/routers';
import {returnToShift} from './shiftNavigation';

function stack() {
  const router=StackRouter({initialRouteName:'Garage'});
  const options={routeNames:['Garage','MultiplayerLobby','Room','Shift','Operations'],routeParamList:{},routeGetIdList:{}};
  let state=router.getInitialState(options);
  const dispatch=(action:Parameters<typeof router.getStateForAction>[1])=>{
    const next=router.getStateForAction(state,action,options);assert.ok(next);state=router.getRehydratedState(next,options);
  };
  return {get state(){return state;},dispatch,navigate:(name:string)=>dispatch(CommonActions.navigate(name)),navigation:{popTo:(name:'Shift')=>dispatch(StackActions.popTo(name))}};
}

test('real StackRouter reproduces duplicate maps with the previous Room return behavior',()=>{
  const app=stack();app.dispatch(StackActions.replace('Shift'));
  for(let i=0;i<3;i++){app.navigate('Room');app.navigate('Shift');}
  assert.equal(app.state.routes.filter(route=>route.name==='Shift').length,4,'v7 navigate does not implicitly pop to a covered route');
});

test('repeated room visits return to the same live Shift instead of creating more map routes',()=>{
  const app=stack();app.dispatch(StackActions.replace('Shift'));const key=app.state.routes[0].key;
  for(let i=0;i<20;i++){
    app.navigate('Room');returnToShift(app.navigation);
    assert.equal(app.state.routes.filter(route=>route.name==='Shift').length,1);
    assert.equal(app.state.routes[app.state.index].key,key);
    assert.deepEqual(app.state.routes.map(route=>route.name),['Shift']);
  }
});

test('first room entry replaces only the current Room when there is no live Shift yet',()=>{
  const app=stack();app.navigate('MultiplayerLobby');app.navigate('Room');returnToShift(app.navigation);
  assert.deepEqual(app.state.routes.map(route=>route.name),['Garage','MultiplayerLobby','Shift']);
  const key=app.state.routes[app.state.index].key;
  returnToShift(app.navigation);
  assert.equal(app.state.routes[app.state.index].key,key,'a repeated entry effect is also harmless');
  app.navigate('Operations');app.dispatch(CommonActions.goBack());
  assert.equal(app.state.routes[app.state.index].key,key,'ordinary modal dismissal still returns to the same map');
});
