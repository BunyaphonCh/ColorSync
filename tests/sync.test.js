import test from 'node:test';
import assert from 'node:assert/strict';
import {visualState} from '../dist/timeline.js';
import {DeviceAPI} from '../dist/device-api.js';

test('all four speeds: light, gap, next light, end; missing polls do not skip the plan',()=>{
  for(const [on,gap] of [[600,250],[350,150],[180,100],[90,70]]) {
    const s={phase:'prepare',litColor:-1,score:0,timeline:{start:2500,on,gap,colors:[0,2,3]}};
    assert.equal(visualState(s,2499).phase,'prepare');
    for(let i=0;i<3;i++) {
      assert.equal(visualState(s,2500+i*(on+gap)).litColor,[0,2,3][i]);
      assert.equal(visualState(s,2500+i*(on+gap)+on).litColor,-1);
    }
    assert.equal(visualState(s,2500+3*(on+gap)).phase,'input');
    assert.equal(s.phase,'prepare');
    assert.equal(visualState(s,2800).score,0);
  }
});
test('millis rollover and stale feedback',()=>{
  const s={phase:'watch',timeline:{start:0xfffffff0,on:90,gap:70,colors:[1]}};
  assert.equal(visualState(s,20).litColor,1);
  assert.equal(visualState(s,80).litColor,-1);
  assert.equal(visualState({phase:'input',litColor:2,feedbackUntil:100},101).litColor,-1);
});
test('clock estimate compensates processing time; reboot clears old samples',()=>{
  const api=new DeviceAPI(()=>{},()=>{});
  api.updateClock({deviceId:'a',bootId:'b',receivedAt:1100,serverNow:1120},50,190);
  assert.equal(api.clockOffset,990);
  api.updateClock({deviceId:'a',bootId:'c',receivedAt:10,serverNow:20},500,530);
  assert.equal(api.clockSamples.length,1);
  assert.equal(api.clockOffset,-500);
});
test('start/status/stop stay serial even after a failed request',async()=>{
  const api=new DeviceAPI(()=>{},()=>{});let active=0,max=0;const order=[];
  api.fetchStatus=async(p)=>{active++;max=Math.max(max,active);order.push(p);await new Promise(r=>setTimeout(r,5));active--;if(p==='bad')throw Error('test');return p;};
  await Promise.allSettled(['status','start','bad','stop'].map(p=>api.request(p)));
  assert.equal(max,1);assert.deepEqual(order,['status','start','bad','stop']);
});
