/** Pure Spotify parsing and analytics. No network, DOM, persistence, or personal identifiers. */
export const HISTORY_FILE = /(?:^|\/)(?:Streaming_History_(?:Audio|Video)[\w-]*|StreamingHistory(?:_music|_podcast)?_?\d*|endsong[_\w-]*)\.json$/i;
export const limits = Object.freeze({ maxZipBytes: 200 * 1024 ** 2, maxEntryBytes: 160 * 1024 ** 2, maxTotalBytes: 700 * 1024 ** 2, maxFiles: 400, maxRatio: 1200 });

const clean = x => x == null ? '' : String(x).trim();
const truth = x => x === true || x === 'true' || x === 1;
const nullableBoolean = x => x === null || x === undefined ? null : truth(x);
const nameKey = s => clean(s).normalize('NFC');

export function normalize(raw, sourceFormat = 'extended') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rawDate = raw.ts ?? raw.endTime ?? raw.played_at;
  const endTimeMs = Date.parse(typeof rawDate === 'string' ? rawDate.replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d)$/, '$1T$2:00') : rawDate);
  const playedMs = Number(raw.ms_played ?? raw.msPlayed);
  if (!Number.isFinite(endTimeMs) || !Number.isFinite(playedMs) || playedMs < 0 || playedMs > 7 * 86400000) return null;

  const artist = clean(raw.master_metadata_album_artist_name ?? raw.artistName ?? raw.artist_name);
  const track = clean(raw.master_metadata_track_name ?? raw.trackName ?? raw.track_name);
  const album = clean(raw.master_metadata_album_album_name ?? raw.albumName ?? raw.album_name);
  const show = clean(raw.episode_show_name ?? raw.showName);
  const episode = clean(raw.episode_name ?? raw.episodeName);
  const audiobook = clean(raw.audiobook_title ?? raw.audiobookTitle);
  const kind = artist && track ? 'music' : (show || episode) ? 'podcast' : audiobook ? 'audiobook' : 'unknown';
  // Whitelist only: do not copy ip_addr, email, username, device IDs, raw JSON, etc.
  return {
    t: endTimeMs, ms: playedMs, kind,
    artist: kind === 'music' ? nameKey(artist) : kind === 'podcast' ? nameKey(show || 'Unknown podcast') : '',
    title: kind === 'music' ? nameKey(track) : kind === 'podcast' ? nameKey(episode || 'Unknown episode') : '',
    album: kind === 'music' ? nameKey(album || 'Unknown album') : kind === 'podcast' ? nameKey(show || 'Unknown podcast') : '',
    uri: clean(kind === 'music' ? raw.spotify_track_uri : raw.spotify_episode_uri),
    platform: clean(raw.platform || 'Unknown'),
    country: clean(raw.conn_country || ''),
    skipped: nullableBoolean(raw.skipped), shuffle: nullableBoolean(raw.shuffle),
    offline: nullableBoolean(raw.offline), incognito: nullableBoolean(raw.incognito_mode),
    reasonEnd: clean(raw.reason_end || ''), sourceFormat
  };
}

export function filenameAccepted(name) { return HISTORY_FILE.test(name) && !name.split('/').some(x => x === '..'); }

export class EventStore {
  constructor() {
    this.events = []; this.seen = new Map();
    this.quality = { files:0, raw:0, accepted:0, rejected:0, duplicate:0, unknown:0, music:0, podcast:0, audiobook:0, extended:0, standard:0, malformed:0 };
  }
  ingest(name, text, sourceId = name) {
    if (!filenameAccepted(name)) return { ignored: true, name };
    let parsed;
    try { parsed = typeof text === 'string' ? JSON.parse(text) : text; }
    catch { this.quality.malformed++; return { error: 'Invalid JSON', name }; }
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : null;
    if (!entries) { this.quality.malformed++; return { error:'Not a Spotify history array', name }; }
    const format = /StreamingHistory|StreamingHistory_music|StreamingHistory_podcast/i.test(name) ? 'standard' : 'extended';
    let added = 0;
    for (const raw of entries) {
      this.quality.raw++;
      const e = normalize(raw, format);
      if (!e) { this.quality.rejected++; continue; }
      const fingerprint = [e.t,e.ms,e.kind,e.uri||[e.artist,e.title,e.album].join('\x1f'),e.platform,e.country,e.reasonEnd,e.skipped,e.shuffle,e.offline].join('\x1e');
      const firstFile = this.seen.get(fingerprint);
      // Preserve same-file repeated events, remove repeated files / overlapping exports only.
      if (firstFile !== undefined && firstFile !== sourceId) { this.quality.duplicate++; continue; }
      if (firstFile === undefined) this.seen.set(fingerprint, sourceId);
      this.events.push(e); added++; this.quality.accepted++; this.quality[e.kind]++;
      this.quality[format]++;
    }
    this.quality.files++;
    return { added, raw:entries.length, name };
  }
  finalize() { this.events.sort((a,b)=>a.t-b.t); this.seen.clear(); }
}

const formatterCache = new Map();
export function tzParts(epoch, zone = 'UTC') {
  let fmt = formatterCache.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hourCycle:'h23', weekday:'short' });
    formatterCache.set(zone,fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(epoch).filter(x=>x.type !== 'literal').map(x=>[x.type,x.value]));
  const weekday = {Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6}[p.weekday];
  return { year:p.year, month:`${p.year}-${p.month}`, day:`${p.year}-${p.month}-${p.day}`, hour:Number(p.hour), weekday };
}

const makeStat = (key, title, artist = '', album = '') => ({key,title,artist,album,ms:0,plays:0,events:0,first:Infinity,last:0,years:new Set(), tracks:new Set(),albums:new Set()});
function inc(map,key,title,artist,album,e,year,threshold) {
  let v=map.get(key);
  if (!v) { v=makeStat(key,title,artist,album); map.set(key,v); }
  v.ms+=e.ms; v.events++; v.plays+=e.ms>=threshold?1:0;
  v.first=Math.min(v.first,e.t);v.last=Math.max(v.last,e.t);v.years.add(year);
  return v;
}
const ranked = (map,metric) => [...map.values()].sort((a,b)=> (metric==='plays'?b.plays-a.plays:b.ms-a.ms) || (metric==='plays'?b.ms-a.ms:b.plays-a.plays) || a.title.localeCompare(b.title));
const compact = x => ({name:x.title,artist:x.artist,album:x.album,ms:x.ms,minutes:x.ms/60000,plays:x.plays,events:x.events,first:x.first,last:x.last,years:x.years.size,tracks:x.tracks.size,albums:x.albums.size});
const top = (map,metric,n=2500) => ranked(map,metric).slice(0,n).map(compact);
function newPeriod(key) {return {key,ms:0,plays:0,days:new Set(),artists:new Map(),tracks:new Map(),albums:new Map(), artistNames:new Set()};}
const recPeriod = p => ({key:p.key,ms:p.ms,minutes:p.ms/60000,plays:p.plays,activeDays:p.days.size,artists:p.artists.size,tracks:p.tracks.size,albums:p.albums.size});
const pad=x=>String(x).padStart(2,'0');
function median(arr){if(!arr.length)return 0;const s=[...arr].sort((a,b)=>a-b);const k=Math.floor(s.length/2);return s.length%2?s[k]:(s[k-1]+s[k])/2;}
const groupTop=(group,metric)=> ranked(group,metric)[0]||null;

/** Build all displayed aggregations, using an identical projected time zone & date filter. */
export function analyze(events, filters = {}, quality = {}) {
  const zone = filters.zone || 'UTC', metric=filters.metric==='plays'?'plays':'minutes';
  const threshold = Number.isFinite(+filters.threshold) ? +filters.threshold : 30000;
  const type = filters.type || 'music', period = filters.period || 'all';
  const customStart=filters.start||'',customEnd=filters.end||'';
  const artists=new Map(),tracks=new Map(),albums=new Map(), years=new Map(), months=new Map(), days=new Map();
  const country=new Map(), platform=new Map(), reason=new Map();
  const hour=Array(24).fill(0),weekday=Array(7).fill(0),weekdayHour=Array.from({length:7},()=>Array(24).fill(0));
  const newArtists=new Map(), musicSeen=new Set(), globalYearArtists = new Map();
  let totalMs=0,plays=0,count=0,minTime=Infinity,maxTime=0, knownSkipped=0, skipped=0, short=0, shuffleKnown=0,shuffleMs=0,offlineKnown=0,offlineMs=0,incognitoKnown=0,incognitoMs=0;
  const matching=[];
  let lastBinMinute=-1,lastTimeParts=null;
  for(const e of events){
    if(type!=='all'&&e.kind!==type) continue;
    if(!['music','podcast'].includes(e.kind)) continue;
    const binMinute=Math.floor(e.t/60000);
    if(binMinute!==lastBinMinute){lastTimeParts=tzParts(e.t,zone);lastBinMinute=binMinute;}
    const d=lastTimeParts;
    if(period!=='all'){
      if(period.startsWith('year:') && d.year!==period.slice(5)) continue;
      if(period.startsWith('month:') && d.month!==period.slice(6)) continue;
      if(period.startsWith('last:')){
        // Relative to latest event in archive, not browser's current date.
        const daysBack=Number(period.slice(5));
        const last=events.length?events[events.length-1].t:0;
        if(e.t<last-daysBack*86400000)continue;
      }
    }
    if(customStart && d.day < customStart)continue;
    if(customEnd && d.day > customEnd)continue;
    matching.push(e);
    minTime=Math.min(minTime,e.t);maxTime=Math.max(maxTime,e.t);count++;
    totalMs+=e.ms;const play=e.ms>=threshold?1:0;plays+=play;if(e.ms<30000)short++;
    if(e.skipped!==null){knownSkipped++;if(e.skipped)skipped++;}
    if(e.shuffle!==null){shuffleKnown+=e.ms;if(e.shuffle)shuffleMs+=e.ms;}
    if(e.offline!==null){offlineKnown+=e.ms;if(e.offline)offlineMs+=e.ms;}
    if(e.incognito!==null){incognitoKnown+=e.ms;if(e.incognito)incognitoMs+=e.ms;}
    const y=d.year, mo=d.month,day=d.day;
    hour[d.hour]+=e.ms;weekday[d.weekday]+=e.ms;weekdayHour[d.weekday][d.hour]+=e.ms;
    const tk=e.uri&&e.kind==='music'?e.uri:[e.artist,e.title].join('\x1f');
    const ak=[e.artist,e.album].join('\x1f');
    const av=inc(artists,e.artist,e.artist,'','',e,y,threshold);
    av.tracks.add(tk);av.albums.add(ak);
    inc(tracks,tk,e.title,e.artist,e.album,e,y,threshold);
    const alb=inc(albums,ak,e.kind==='podcast'?'Podcast episodes':e.album,e.artist,'',e,y,threshold);
    alb.tracks.add(tk);
    if(!years.has(y))years.set(y,newPeriod(y));
    if(!months.has(mo))months.set(mo,newPeriod(mo));
    for(const periodObj of [years.get(y),months.get(mo)]){
      periodObj.ms+=e.ms;periodObj.plays+=play;periodObj.days.add(day);periodObj.artistNames.add(e.artist);
      inc(periodObj.artists,e.artist,e.artist,'','',e,y,threshold);
      inc(periodObj.tracks,tk,e.title,e.artist,e.album,e,y,threshold);
      inc(periodObj.albums,ak,e.album,e.artist,'',e,y,threshold);
    }
    if(!days.has(day))days.set(day,{day,ms:0,plays:0});
    days.get(day).ms+=e.ms;days.get(day).plays+=play;
    if(!musicSeen.has(e.artist)){musicSeen.add(e.artist);newArtists.set(y,(newArtists.get(y)||0)+1);}
    if(!globalYearArtists.has(y))globalYearArtists.set(y,new Set());globalYearArtists.get(y).add(e.artist);
    if(e.country)country.set(e.country,(country.get(e.country)||0)+e.ms);
    if(e.platform)platform.set(e.platform,(platform.get(e.platform)||0)+e.ms);
    if(e.reasonEnd)reason.set(e.reasonEnd,(reason.get(e.reasonEnd)||0)+1);
  }
  const yearSummaries=[...years.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,g])=>({
    ...recPeriod(g), year:k,
    topArtist:compact(groupTop(g.artists,metric)||makeStat('','','')),
    topTrack:compact(groupTop(g.tracks,metric)||makeStat('','','')),
    topAlbum:compact(groupTop(g.albums,metric)||makeStat('','','')),
    newArtists:newArtists.get(k)||0,
    partial: k===tzParts(minTime,zone).year||k===tzParts(maxTime,zone).year
  }));
  const monthSummaries=[...months.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,g])=>{
    const winner=groupTop(g.artists,metric), song=groupTop(g.tracks,metric), album=groupTop(g.albums,metric);
    const c=recPeriod(g);
    return {...c,topArtist:winner?compact(winner):null,topTrack:song?compact(song):null,topAlbum:album?compact(album):null,
      share: winner ? (metric==='plays'?winner.plays/(g.plays||1):winner.ms/(g.ms||1)):0,
      partial: k===tzParts(minTime,zone).month||k===tzParts(maxTime,zone).month};
  });
  // Sessions: elapsed idle time between *estimated start* and previous end; stream timestamp is END time.
  const sessions=[];let active=null;
  for(const e of matching){
    const start=Math.max(0,e.t-e.ms);
    if(!active || start-active.end>30*60000){
      active={start,end:e.t,ms:0,plays:0,artists:new Map(),events:0};sessions.push(active);
    }
    active.end=Math.max(active.end,e.t);active.ms+=e.ms;active.plays+=e.ms>=threshold?1:0;active.events++;
    active.artists.set(e.artist,(active.artists.get(e.artist)||0)+e.ms);
  }
  const listSessions=sessions.map(s=>{
    const a=[...s.artists.entries()].sort((x,y)=>y[1]-x[1])[0];
    return {start:s.start,end:s.end,ms:s.ms,span:s.end-s.start,plays:s.plays,events:s.events,artists:s.artists.size,topArtist:a?.[0]||'',focus:a? a[1]/(s.ms||1):0};
  });
  const activeDayList=[...days.values()].sort((a,b)=>a.day.localeCompare(b.day));
  let streak=0,longestStreak=0,last=null;
  for(const d of activeDayList){
    const t=Date.parse(d.day+'T12:00:00Z');
    streak=last!==null && t-last===86400000?streak+1:1;longestStreak=Math.max(longestStreak,streak);last=t;
  }
  const topDays=[...activeDayList].sort((a,b)=>b.ms-a.ms).slice(0,8);
  const periodNames=[...new Set([...months.keys()].map(k=>k.slice(0,4)))].sort();
  const artistYearMatrix=top(artists,'minutes',16).map(x=>({name:x.name, years:periodNames.map(y=>years.get(y)?.artists.get(x.name)?.ms||0)}));
  const monthDominance=[...monthSummaries].sort((a,b)=>b.share-a.share).slice(0,20);
  const yearJaccard=[];
  for(let i=1;i<periodNames.length;i++){
    const pa=new Set(ranked(years.get(periodNames[i-1]).artists,'minutes').slice(0,20).map(x=>x.title));
    const pb=new Set(ranked(years.get(periodNames[i]).artists,'minutes').slice(0,20).map(x=>x.title));
    yearJaccard.push({year:periodNames[i],ratio:[...pa].filter(x=>pb.has(x)).length/new Set([...pa,...pb]).size});
  }
  const leading=ranked(artists,metric);
  const hasData=Number.isFinite(minTime);
  return {
    filters:{zone,type,metric,threshold,period,start:customStart,end:customEnd},
    quality, count, totalMs, minutes:totalMs/60000, plays, from:hasData?minTime:null,to:hasData?maxTime:null,
    artists:artists.size,tracks:tracks.size,albums:albums.size,activeDays:days.size,
    topArtists:top(artists,metric), topTracks:top(tracks,metric), topAlbums:top(albums,metric),
    years:yearSummaries,months:monthSummaries, availableYears:periodNames,
    availableMonths:[...months.keys()].sort(),hour,weekday,weekdayHour,
    calendar:activeDayList,topDays,longestStreak,monthDominance,
    sessionSummary:{count:sessions.length,mean:sessions.length?totalMs/sessions.length:0,median:median(sessions.map(s=>s.ms)),
      monoArtist:sessions.length?sessions.filter(s=>s.artists.size===1).length/sessions.length:0,
      top:[...listSessions].sort((a,b)=>b.ms-a.ms).slice(0,50)},
    platform:[...platform].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([name,ms])=>({name,ms})),
    country:[...country].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([name,ms])=>({name,ms})),
    reasons:[...reason].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([name,count])=>({name,count})),
    newArtists:periodNames.map(year=>({year,count:newArtists.get(year)||0})),artistYearMatrix,yearJaccard,
    behavior:{skipRate:knownSkipped?skipped/knownSkipped:null,knownSkipped,shortRate:count?short/count:0,
      shuffleRate:shuffleKnown?shuffleMs/shuffleKnown:null,offlineRate:offlineKnown?offlineMs/offlineKnown:null,
      incognitoRate:incognitoKnown?incognitoMs/incognitoKnown:null},
    favorite:leading[0]?.title||null
  };
}

/** Safe spreadsheet CSV: starts-with-formula cells are forced to literal text. */
export function csvSafeCell(value){
  let str=String(value??'');
  if(/^[\s]*[=+\-@\t\r\n]/.test(str)) str="'"+str;
  return '"'+str.replaceAll('"','""')+'"';
}
export function toCsv(rows, columns){return [columns,...rows.map(row=>columns.map(c=>row[c]??''))].map(row=>row.map(csvSafeCell).join(',')).join('\r\n');}
