import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze} from '../src/core.mjs';
test('abandoned songs use complete history and group remasters',()=>{
  const start=Date.parse('2017-01-01T12:00:00Z'),end=Date.parse('2026-10-17T12:00:00Z');
  const song=(title,t,ms,uri='')=>({t,ms,kind:'music',artist:'Test Band',title,album:'Album',uri});
  const events=[];
  for(let i=0;i<30;i++)events.push(song('Forgotten Tune',start+i*86400000,45000,'spotify:track:0123456789012345678901'));
  events.push(song('Forgotten Tune - 2011 Remaster',start+31*86400000,45000));
  for(let i=0;i<40;i++)events.push(song('Still Playing',start+i*86400000,60000));
  events.push(song('Still Playing',end-5000,1000)); // very brief recent listen disqualifies
  events.push({t:end,ms:60000,kind:'podcast',artist:'A podcast',title:'Episode'});
  const a=analyze(events,{type:'podcast',period:'year:2026',threshold:60000}).abandoned;
  assert.equal(a.total,1);assert.equal(a.items[0].plays,31);
  assert.equal(a.items[0].url,'https://open.spotify.com/track/0123456789012345678901');
  assert.equal(analyze(events,{abandonedMinPlays:50}).abandoned.total,0);
});
test('exact four-year boundary is inclusive; a later second disqualifies',()=>{
  const end=Date.parse('2026-10-17T12:00:00Z'),old=Date.parse('2022-10-17T12:00:00Z');
  const music=t=>({t,ms:50000,kind:'music',artist:'Band',title:'Tune'});
  const podcast={t:end,ms:50000,kind:'podcast',artist:'Podcast',title:'Episode'};
  const base=[...Array.from({length:30},()=>music(old)),podcast];
  assert.equal(analyze(base).abandoned.total,1);
  assert.equal(analyze([...base,music(old+1000)]).abandoned.total,0);
  assert.equal(analyze([]).abandoned.total,0);
});
