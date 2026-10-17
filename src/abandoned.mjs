/** Detect common remasters without merging live recordings or remixes. */
function songKey(title) {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\s*(?:[-–—]\s*|[([]\s*)(?:(?:19|20)\d{2}\s+)?(?:remaster(?:ed)?|(?:19|20)\d{2}\s+remaster(?:ed)?|stereo mix)(?:\s+(?:19|20)\d{2})?\s*[)\]]?\s*$/i, '')
    .replace(/[^a-z0-9]+/g, '');
}
/** Use complete export history; a brief recent play still counts as a return. */
export function abandonedFavorites(events, options={}) {
  const minPlays=[10,20,30,50,100].includes(+options.minPlays)?+options.minPlays:30;
  const years=[1,2,3,4,5,8].includes(+options.years)?+options.years:4;
  const archiveEnd=events.reduce((a,e)=>Math.max(a,e.t||0),0);
  if(!archiveEnd)return {items:[],total:0,archiveEnd:null,cutoff:null,minPlays,years};
  const limit=new Date(archiveEnd);limit.setUTCFullYear(limit.getUTCFullYear()-years);
  const cutoff=limit.getTime(),groups=new Map();
  for(const e of events) {
    if(e.kind!=='music'||!e.artist||!e.title||e.ms<=0)continue;
    const key=e.artist.normalize('NFKC').trim().toLowerCase()+'\x1f'+songKey(e.title);
    if(!key.split('\x1f')[1])continue;
    let x=groups.get(key);
    if(!x){x={artist:e.artist,title:e.title,album:e.album,plays:0,ms:0,first:e.t,last:0,uris:new Map(),titles:new Map()};groups.set(key,x);}
    x.last=Math.max(x.last,e.t);
    if(e.ms<30000)continue;
    x.plays++;x.ms+=e.ms;x.first=Math.min(x.first,e.t);
    x.titles.set(e.title,(x.titles.get(e.title)||0)+1);
    if(/^spotify:track:[a-z0-9]{22}$/i.test(e.uri))x.uris.set(e.uri,(x.uris.get(e.uri)||0)+1);
  }
  const items=[];
  for(const x of groups.values()){
    if(x.plays<minPlays||x.last>cutoff)continue;
    const title=[...x.titles].sort((a,b)=>b[1]-a[1])[0]?.[0]||x.title;
    const uri=[...x.uris].sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
    items.push({name:title,artist:x.artist,album:x.album,plays:x.plays,ms:x.ms,first:x.first,last:x.last,url:uri?'https://open.spotify.com/track/'+uri.slice(14):''});
  }
  items.sort((a,b)=>b.plays-a.plays||a.last-b.last||a.artist.localeCompare(b.artist));
  return {items,total:items.length,archiveEnd,cutoff,minPlays,years};
}
