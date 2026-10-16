import test from 'node:test';
import assert from 'node:assert/strict';
import {EventStore,analyze,normalize,tzParts,csvSafeCell,filenameAccepted} from '../src/core.mjs';
const entry=(ts,artist,ms,track='Song')=>({ts,ms_played:ms,master_metadata_album_artist_name:artist,master_metadata_track_name:track,master_metadata_album_album_name:'Album'});
const rows=[
  entry('2024-01-31T23:58:00Z','Kite Theory',240000),
  entry('2024-01-31T23:59:50Z','Silver Harbor',60000),
  entry('2024-02-02T12:00:00Z','Kite Theory',10000),
  entry('2024-02-02T12:04:00Z','Silver Harbor',360000),
];
const build=()=>{const store=new EventStore();store.ingest('Streaming_History_Audio_2024.json',rows,'audio');store.finalize();return store;};

test('extended export is normalized',()=>{const x=normalize(rows[0]);assert.equal(x.artist,'Kite Theory');assert.equal(x.ms,240000);assert.equal(x.kind,'music');});
test('standard export is normalized',()=>{const x=normalize({endTime:'2024-02-01 10:00',msPlayed:45000,artistName:'A',trackName:'B'},'standard');assert.equal(x.kind,'music');assert.equal(x.ms,45000);assert.equal(x.artist,'A');});
test('listening minutes include short events',()=>{const s=analyze(build().events,{type:'music',zone:'UTC',threshold:30000});assert.equal(s.totalMs,670000);assert.equal(s.plays,3);});
test('threshold changes plays, not minutes',()=>{const ev=build().events;const a=analyze(ev,{zone:'UTC',threshold:0});const b=analyze(ev,{zone:'UTC',threshold:60000});assert.equal(a.totalMs,b.totalMs);assert.equal(a.plays,4);assert.equal(b.plays,3);});
test('named timezones and daylight-saving transition',()=>{assert.equal(tzParts(Date.parse('2024-01-31T23:59:50Z'),'Europe/Madrid').month,'2024-02');assert.equal(tzParts(Date.parse('2024-03-31T00:30:00Z'),'Europe/Madrid').hour,1);assert.equal(tzParts(Date.parse('2024-03-31T01:30:00Z'),'Europe/Madrid').hour,3);});
test('deduplicates overlaps from different files',()=>{const s=new EventStore();s.ingest('Streaming_History_Audio_2024.json',[rows[0]],'a');s.ingest('Streaming_History_Video_2024.json',[rows[0]],'b');s.finalize();assert.equal(s.events.length,1);assert.equal(s.quality.duplicate,1);});
test('does not deduplicate repeated entries within same file',()=>{const s=new EventStore();s.ingest('Streaming_History_Audio_2024.json',[rows[0],rows[0]],'a');s.finalize();assert.equal(s.events.length,2);});
test('does not retain private metadata',()=>{const x=normalize({...rows[0],ip_addr:'203.0.113.1',email:'secret@example.org'});assert.ok(!JSON.stringify(x).includes('203.0.113.1'));assert.ok(!JSON.stringify(x).includes('secret@example.org'));});
test('prevents spreadsheet formula injection',()=>{for(const s of ['=2+2','+SUM(A1)','-1+2','@cmd','\tX'])assert.ok(csvSafeCell(s).startsWith('"\''));
  assert.equal(csvSafeCell('a"b'),'"a""b"');});
test('accepts history paths but not unrelated files or traversal',()=>{assert.equal(filenameAccepted('nested/Streaming_History_Audio_2024.json'),true);assert.equal(filenameAccepted('StreamingHistory_music_0.json'),true);assert.equal(filenameAccepted('Spotify Account Data/Account.json'),false);assert.equal(filenameAccepted('../StreamingHistory_music_0.json'),false);});
test('period filters and rankings by minutes versus plays',()=>{const ev=build().events;const all=analyze(ev,{zone:'UTC'});const feb=analyze(ev,{zone:'UTC',period:'month:2024-02'});const custom=analyze(ev,{zone:'UTC',start:'2024-02-01',end:'2024-02-29'});assert.equal(feb.totalMs,custom.totalMs);assert.ok(all.totalMs>feb.totalMs);const byPlays=analyze(ev,{zone:'UTC',metric:'plays'});assert.equal(byPlays.totalMs,all.totalMs);assert.ok(byPlays.months.every(x=>x.topArtist));});
