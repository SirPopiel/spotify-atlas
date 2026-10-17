import {filenameAccepted,limits,toCsv} from './core.mjs';
import {initAbandoned,abandonedFilters,resetAbandoned,renderAbandoned} from './abandoned-view.mjs';

const $=id=>document.getElementById(id);
const fmt=new Intl.NumberFormat('en-US');
const dateFmt=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric'});
const monthFmt=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'long',timeZone:'UTC'});
const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
const state={worker:null,summary:null,demo:false,allYears:[],allMonths:[],tablePage:{artists:50,tracks:50,albums:50},loading:false};
const elements={status:$('status'),fileInput:$('fileInput'),dashboard:$('dashboard'),drop:$('dropZone'),progress:$('progressTrack'),bar:$('progressBar')};
$('zoneSelect').querySelector('[value="local"]').textContent=`My time zone (${localZone})`;
const filters=()=>({period:$('periodSelect').value,metric:$('metricSelect').value,
  type:$('typeSelect').value,threshold:Number($('thresholdSelect').value),
  zone:$('zoneSelect').value==='local'?localZone:$('zoneSelect').value,
  start:$('dateFrom').value,end:$('dateTo').value,...abandonedFilters()});
function h(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function n(x){return fmt.format(x||0)}
function pct(x){return x==null?'n/a':`${(100*x).toFixed(1)}%`}
function minutes(ms){const m=(ms||0)/60000;return m<60?`${Math.round(m)} min`:m<600?`${(m/60).toFixed(1)} h`:m<2880?`${Math.round(m/60)} h`:`${(m/60).toFixed(0)} h`}
function date(t){return t==null?'—':dateFmt.format(t)}
function monthLabel(key){if(!key)return'—';return monthFmt.format(new Date(`${key}-01T12:00:00Z`))}
const empty='<div class="no-data">No recorded listening in this selection.</div>';
function status(s,error=false){elements.status.textContent=s;elements.status.classList.toggle('error',error)}
function progress(p){elements.progress.hidden=false;elements.bar.style.width=`${Math.round(p)}%`;}
function clear(){state.worker?.terminate();state.worker=null;state.summary=null;state.loading=false;state.demo=false;elements.dashboard.hidden=true;$('demoBadge').hidden=true;$('clearBtn').hidden=true;elements.fileInput.value='';elements.progress.hidden=true;status('Files stay on your device. Always.');$('dateFrom').value='';$('dateTo').value='';$('periodSelect').value='all';resetAbandoned();}
function makeWorker(){state.worker?.terminate();state.worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});return state.worker;}
function waitChunk(worker,id){return new Promise((resolve,reject)=>{
  const onmessage=e=>{if(e.data.type==='chunk-done'&&e.data.id===id){worker.removeEventListener('message',onmessage);resolve(e.data.result)}else if(e.data.type==='error'){worker.removeEventListener('message',onmessage);reject(new Error(e.data.message))}};
  worker.addEventListener('message',onmessage);
});}
function waitResult(worker,action,payload){return new Promise((resolve,reject)=>{
  const listener=e=>{if(e.data.type==='ready'||e.data.type==='summary'){worker.removeEventListener('message',listener);resolve(e.data.summary)}else if(e.data.type==='error'){worker.removeEventListener('message',listener);reject(new Error(e.data.message))}};
  worker.addEventListener('message',listener);
  worker.postMessage({action,...payload});
});}
function updateGlobalOptions(s){
  state.allYears=s.availableYears.slice();state.allMonths=s.availableMonths.slice();
  const select=$('periodSelect'),current=select.value;
  select.innerHTML=`<option value="all">All time</option><option value="last:30">Final 30 days in export</option><option value="last:90">Final 90 days in export</option><option value="last:365">Final 365 days in export</option>`+
    state.allYears.map(y=>`<option value="year:${h(y)}">${h(y)}</option>`).join('')+
    state.allMonths.map(m=>`<option value="month:${h(m)}">${h(monthLabel(m))}</option>`).join('');
  if([...select.options].some(o=>o.value===current))select.value=current;
}
async function load(files){
  if(state.loading)return;
  if(!files.length)return;
  clear();state.loading=true;const worker=makeWorker();progress(1);status('Checking files…');
  try {
    if(!window.JSZip)throw Error('ZIP reader did not load. Refresh the page and try again.');
    const tasks=[];let unpackedTotal=0;
    if(files.length>limits.maxFiles)throw Error('Too many selected files.');
    for(let i=0;i<files.length;i++){
      const f=files[i];
      if(/\.zip$/i.test(f.name)){
        if(f.size>limits.maxZipBytes)throw Error('ZIP is too large (maximum 200 MB compressed).');
        status(`Inspecting ${f.name}…`);
        const zip=await JSZip.loadAsync(f,{checkCRC32:false});
        for(const entry of Object.values(zip.files)){
          if(entry.dir||!filenameAccepted(entry.name))continue;
          const unpacked=entry._data?.uncompressedSize||0,compressed=entry._data?.compressedSize||1;
          if(unpacked>limits.maxEntryBytes||unpackedTotal+unpacked>limits.maxTotalBytes)throw Error('Archive exceeds the safe decompressed size limit.');
          if(unpacked>10*1024*1024 && unpacked/Math.max(compressed,1)>limits.maxRatio)throw Error('Suspicious ZIP compression ratio.');
          unpackedTotal+=unpacked;
          tasks.push({name:entry.name,sourceId:`${i}:${entry.name}`,load:()=>entry.async('uint8array')});
        }
      }else if(/\.json$/i.test(f.name)&&filenameAccepted(f.name)){
        if(f.size>limits.maxEntryBytes||unpackedTotal+f.size>limits.maxTotalBytes)throw Error('JSON files exceed safe input size.');
        unpackedTotal+=f.size;
        tasks.push({name:f.name,sourceId:`${i}:${f.name}`,load:async()=>new Uint8Array(await f.arrayBuffer())});
      }
    }
    if(!tasks.length)throw Error('No Spotify streaming-history JSON files found. Select the Extended Streaming History ZIP.');
    if(tasks.length>limits.maxFiles)throw Error('The archive contains too many history files.');
    let added=0,malformed=0,actualBytes=0;
    for(let i=0;i<tasks.length;i++){
      const task=tasks[i];status(`Reading history file ${i+1} of ${tasks.length}…`);
      const bytes=await task.load();
      actualBytes+=bytes.byteLength;
      if(bytes.byteLength>limits.maxEntryBytes||actualBytes>limits.maxTotalBytes)throw Error('Extracted history exceeds the safe size limit.');
      // Remove the decompressed copy from the main thread by transferring its buffer.
      const done=waitChunk(worker,i);
      worker.postMessage({action:'chunk',id:i,name:task.name,sourceId:task.sourceId,bytes:bytes.buffer},[bytes.buffer]);
      const result=await done;
      if(result?.error) malformed++;else added+=result?.added||0;
      progress(5+80*(i+1)/tasks.length);
    }
    if(!added)throw Error('No usable listening events found. Check that these are Spotify history files.');
    status('Calculating your dashboard…');progress(95);
    const s=await waitResult(worker,'finish',{filters:filters()});
    state.demo=false;state.summary=s;updateGlobalOptions(s);render();
    status(`Loaded ${n(added)} listening events across ${tasks.length} files${malformed?` (${malformed} could not be parsed)`:''}.`,false);
    progress(100);setTimeout(()=>elements.progress.hidden=true,500);
    state.loading=false;
  }catch(e){status(e?.message||'Unable to open this archive.',true);elements.progress.hidden=true;state.worker?.terminate();state.worker=null;state.loading=false;}
}
async function demo(){
  if(state.loading)return;clear();state.loading=true;progress(25);status('Generating fictional listening data…');
  try{const worker=makeWorker(),s=await waitResult(worker,'demo',{filters:filters()});state.demo=true;state.summary=s;updateGlobalOptions(s);render();status('Showing a fictional example — no real Spotify data.');elements.progress.hidden=true;state.loading=false;}
  catch(e){status(e.message,true);state.loading=false;}
}
async function update(){if(!state.worker||state.loading)return;state.loading=true;
  try{const s=await waitResult(state.worker,'filter',{filters:filters()});state.summary=s;render();}
  catch(e){status(e.message,true);}finally{state.loading=false;}}
function switchTab(tab){document.querySelectorAll('.tab').forEach(e=>e.classList.toggle('active',e.dataset.tab===tab));document.querySelectorAll('.view').forEach(e=>e.classList.toggle('active',e.id===`view-${tab}`));}
function kpi(label,value,note=''){return `<article class="panel kpi"><small>${h(label)}</small><b title="${h(value)}">${h(value)}</b><span>${h(note)}</span></article>`;}
function rankRows(items,subtitle=()=>'',limit=10){return !items.length?empty:items.slice(0,limit).map((x,i)=>`<div class="rank-row"><span class="rank-num">${String(i+1).padStart(2,'0')}</span><div style="min-width:0"><div class="rank-name" title="${h(x.name)}">${h(x.name)}</div><div class="rank-sub">${h(subtitle(x))}</div></div><span class="rank-value">${h(state.summary.filters.metric==='plays'?`${n(x.plays)} plays`:minutes(x.ms))}</span></div>`).join('');}
function svgBar(labels,values,aria='Listening chart'){
  if(!values.length)return empty;
  const w=800,ht=250,l=45,r=10,t=14,b=41,W=w-l-r,H=ht-t-b,max=Math.max(1,...values),bw=W/values.length*.66;
  let svg=`<svg viewBox="0 0 ${w} ${ht}" role="img" aria-label="${h(aria)}">`;
  for(let j=0;j<=4;j++){const yy=t+H-j*H/4;svg+=`<line class="gridline" x1="${l}" x2="${w-r}" y1="${yy}" y2="${yy}"/><text x="${l-6}" y="${yy+4}" text-anchor="end">${n(Math.round(max*j/4))}</text>`;}
  const labelStep=Math.max(1,Math.ceil(labels.length/11));
  values.forEach((v,i)=>{const x=l+(i+.5)*W/values.length-bw/2,y=t+H-v/max*H,barH=Math.max(0,v/max*H);
    svg+=`<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${barH.toFixed(1)}" rx="3"><title>${h(labels[i])}: ${n(Math.round(v))}</title></rect>`;
    if(i%labelStep===0)svg+=`<text x="${(x+bw/2).toFixed(1)}" y="${ht-15}" text-anchor="middle">${h(labels[i])}</text>`;
  });return svg+'</svg>';
}
function svgLine(labels,values){if(!values.length)return empty;
  const w=800,ht=250,l=45,r=10,t=14,b=41,W=w-l-r,H=ht-t-b,max=Math.max(1,...values);
  const pts=values.map((v,i)=>[l+i/Math.max(1,values.length-1)*W,t+H-v/max*H]);
  const p=pts.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area=`M${l},${t+H} `+pts.map(([x,y])=>`L${x.toFixed(1)},${y.toFixed(1)}`).join(' ')+` L${w-r},${t+H} Z`;
  let svg=`<svg viewBox="0 0 ${w} ${ht}" role="img" aria-label="Monthly listening trend">`;
  for(let j=0;j<=4;j++){const yy=t+H-j*H/4;svg+=`<line class="gridline" x1="${l}" x2="${w-r}" y1="${yy}" y2="${yy}"/><text x="${l-6}" y="${yy+4}" text-anchor="end">${n(Math.round(max*j/4))}</text>`;}
  const st=Math.max(1,Math.ceil(labels.length/9));labels.forEach((label,i)=>{if(i%st===0||i===labels.length-1)svg+=`<text x="${pts[i][0].toFixed(1)}" y="${ht-15}" text-anchor="middle">${h(label)}</text>`});
  return svg+`<path class="line-area" d="${area}"/><path class="line-path" d="${p}"/></svg>`;
}
function renderOverview(s){$('kpis').innerHTML=[kpi('Time listened',minutes(s.totalMs),`${n(Math.round(s.minutes))} min`),kpi('Qualified plays',n(s.plays),`≥ ${s.filters.threshold/1000} seconds`),kpi('Active days',n(s.activeDays)),kpi('Artists',n(s.artists),s.favorite||''),kpi('Unique tracks',n(s.tracks)),kpi('Albums',n(s.albums))].join('');
  $('timelineChart').innerHTML=svgLine(s.months.map(m=>m.key.slice(2)),s.months.map(m=>m.minutes));
  $('yearChart').innerHTML=svgBar(s.years.map(y=>y.year),s.years.map(y=>y.minutes));
  $('overviewArtists').innerHTML=rankRows(s.topArtists, x=>`${n(x.tracks)} tracks · ${n(x.years)} years`);
  $('overviewTracks').innerHTML=rankRows(s.topTracks,x=>x.artist);
  $('overviewAlbums').innerHTML=rankRows(s.topAlbums,x=>x.artist);
}
function renderYears(s){$('yearCards').innerHTML=[...s.years].reverse().map(y=>`<article class="panel year-card"><div class="small-label">YOUR REPLAY ${y.partial?'<span class="partial-flag">BOUNDARY YEAR</span>':''}</div><div class="year-number">${h(y.year)}</div><div class="card-metrics"><div><b>${h(minutes(y.ms))}</b><small>Listened</small></div><div><b>${n(y.plays)}</b><small>Plays</small></div><div><b title="${h(y.topArtist.name)}">${h(y.topArtist.name)}</b><small>Top artist</small></div><div><b title="${h(y.topTrack.name)}">${h(y.topTrack.name)}</b><small>Top track</small></div><div><b title="${h(y.topAlbum.name)}">${h(y.topAlbum.name)}</b><small>Top album</small></div><div><b>${n(y.newArtists)}</b><small>New artists</small></div></div></article>`).join('')||empty;
  $('discoveryChart').innerHTML=svgBar(s.newArtists.map(y=>y.year),s.newArtists.map(y=>y.count));
  $('jaccardChart').innerHTML=svgBar(s.yearJaccard.map(y=>y.year),s.yearJaccard.map(y=>Math.round(y.ratio*100)),'Top-20 artist overlap percentage');
  if(!s.artistYearMatrix.length){$('artistMatrix').innerHTML=empty;return;}
  const max=Math.max(1,...s.artistYearMatrix.flatMap(a=>a.years));
  $('artistMatrix').innerHTML=`<div class="heat-grid" style="grid-template-columns:160px repeat(${s.availableYears.length},35px);min-width:max-content"><div></div>${s.availableYears.map(y=>`<div class="heat-label">${h(y)}</div>`).join('')}`+s.artistYearMatrix.map(a=>`<div class="heat-label" title="${h(a.name)}" style="justify-content:start">${h(a.name)}</div>${a.years.map((ms,i)=>`<div class="heat-cell" title="${h(a.name)} ${h(s.availableYears[i])} · ${h(minutes(ms))}" style="background:rgba(161,255,150,${(.04+.88*Math.sqrt(ms/max)).toFixed(3)})"></div>`).join('')}`).join('')+'</div>';
}
function renderMonths(s){const q=$('monthSearch').value.toLowerCase().trim();const rows=[...s.months].reverse().filter(m=>!q||`${m.key} ${monthLabel(m.key)} ${m.topArtist?.name||''}`.toLowerCase().includes(q));
  $('monthCards').innerHTML=rows.map(m=>`<article class="panel month-card"><span class="small-label">${h(monthLabel(m.key))} ${m.partial?'<span class="partial-flag">BOUNDARY</span>':''}</span><h4 title="${h(m.topArtist?.name||'')}">${h(m.topArtist?.name||'—')}</h4><div class="card-metrics"><div><b>${h(state.summary.filters.metric==='plays'?`${n(m.topArtist?.plays)} plays`:minutes(m.topArtist?.ms))}</b><small>${h(pct(m.share))} of month</small></div><div><b>${h(minutes(m.ms))}</b><small>Total listening</small></div><div><b title="${h(m.topTrack?.name)}">${h(m.topTrack?.name||'—')}</b><small>Top track</small></div><div><b title="${h(m.topAlbum?.name)}">${h(m.topAlbum?.name||'—')}</b><small>Top album</small></div></div></article>`).join('')||empty;
  $('dominationList').innerHTML=s.monthDominance.slice(0,10).map((m,i)=>`<div class="rank-row"><span class="rank-num">${i+1}</span><div><div class="rank-name">${h(monthLabel(m.key))}</div><div class="rank-sub">${h(m.topArtist?.name)}</div></div><span class="rank-value">${h(pct(m.share))}</span></div>`).join('')||empty;
}
function renderTable(s,type){const q=$(type==='artists'?'artistSearch':type==='tracks'?'trackSearch':'albumSearch').value.toLowerCase().trim();const base=s[type==='artists'?'topArtists':type==='tracks'?'topTracks':'topAlbums'];
  const rows=base.filter(x=>!q||`${x.name} ${x.artist}`.toLowerCase().includes(q));const cap=state.tablePage[type];
  const html=rows.slice(0,cap).map((x,i)=>{
    if(type==='artists')return `<tr><td>${i+1}</td><td>${h(x.name)}</td><td>${n(Math.round(x.minutes))}</td><td>${n(x.plays)}</td><td>${n(x.tracks)}</td><td>${n(x.albums)}</td><td>${n(x.years)}</td></tr>`;
    if(type==='tracks')return `<tr><td>${i+1}</td><td title="${h(x.album)}">${h(x.name)}</td><td>${h(x.artist)}</td><td>${n(Math.round(x.minutes))}</td><td>${n(x.plays)}</td><td>${n(x.years)}</td></tr>`;
    return `<tr><td>${i+1}</td><td>${h(x.name)}</td><td>${h(x.artist)}</td><td>${n(Math.round(x.minutes))}</td><td>${n(x.plays)}</td><td>${n(x.tracks)}</td></tr>`;
  }).join('');$(type==='artists'?'artistRows':type==='tracks'?'trackRows':'albumRows').innerHTML=html||`<tr><td colspan="7">No matching results</td></tr>`;
  $(`more${type[0].toUpperCase()+type.slice(1)}`).hidden=rows.length<=cap;
}
function renderPattern(s){const H=s.hour.indexOf(Math.max(...s.hour)),W=s.weekday.indexOf(Math.max(...s.weekday)),dayNames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const items=[['Your peak hour',`${String(H).padStart(2,'0')}:00`,minutes(s.hour[H])+' total'],['Your peak day',dayNames[W],minutes(s.weekday[W])+' total'],['Longest streak',`${n(s.longestStreak)} days`,'Consecutive recorded days'],['Your busiest date',s.topDays[0]?.day||'—',minutes(s.topDays[0]?.ms)+' listened'],['Skip rate',pct(s.behavior.skipRate),`${n(s.behavior.knownSkipped)} known skip flags`],['Short listens',pct(s.behavior.shortRate),'<30 seconds'],['Shuffle',pct(s.behavior.shuffleRate),'Share of known listening time'],['Offline',pct(s.behavior.offlineRate),'Share of known listening time'],['Private listening',pct(s.behavior.incognitoRate),'Share of known listening time']];
  $('patternCards').innerHTML=items.map(x=>`<article class="panel pattern-card"><span class="small-label">${h(x[0])}</span><strong>${h(x[1])}</strong><p>${h(x[2])}</p></article>`).join('');
  $('hourChart').innerHTML=svgBar(s.hour.map((_,i)=>String(i).padStart(2,'0')),s.hour.map(v=>v/60000));
  $('weekdayChart').innerHTML=svgBar(dayNames,s.weekday.map(v=>v/60000));
  const max=Math.max(1,...s.weekdayHour.flat());$('hourHeatmap').innerHTML=`<div class="heat-grid"><div></div>${s.hour.map((_,i)=>`<div class="heat-label">${String(i).padStart(2,'0')}</div>`).join('')}`+s.weekdayHour.map((row,i)=>`<div class="heat-label">${dayNames[i]}</div>`+row.map((ms,j)=>`<div class="heat-cell" style="background:rgba(161,255,150,${(.035+.89*Math.sqrt(ms/max)).toFixed(3)})" title="${dayNames[i]} at ${String(j).padStart(2,'0')}:00 · ${h(minutes(ms))}"></div>`).join('')).join('')+'</div>';
  renderCalendar(s);
  const maps=[['platformList',s.platform,x=>x.name,x=>minutes(x.ms)],['countryList',s.country,x=>x.name,x=>minutes(x.ms)],['reasonList',s.reasons,x=>x.name,x=>n(x.count)]];
  for(const [id,data,key,value] of maps){$(id).innerHTML=data.slice(0,10).map((x,i)=>`<div class="rank-row"><span class="rank-num">${i+1}</span><div class="rank-name">${h(key(x))}</div><span class="rank-value">${h(value(x))}</span></div>`).join('')||empty;}
}
function renderCalendar(s){const days=s.calendar;if(!days.length){$('calendarHeatmap').innerHTML=empty;return;}
  // Max one year of squares for legibility even when analyzing the full archive.
  const newest=days.at(-1).day,yr=newest.slice(0,4);
  const focus=s.filters.period.startsWith('year:')?s.filters.period.slice(5):yr;
  const daysYear=days.filter(d=>d.day.startsWith(focus+'-'));
  const start=new Date(`${focus}-01-01T12:00:00Z`),end=new Date(`${focus}-12-31T12:00:00Z`);
  start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
  const map=new Map(daysYear.map(x=>[x.day,x.ms])),max=Math.max(1,...daysYear.map(x=>x.ms));
  let body='';
  for(let d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+1)){
    const k=d.toISOString().slice(0,10),v=map.get(k)||0;
    body+=`<div class="calendar-cell" title="${k}: ${h(minutes(v))}" style="background:rgba(161,255,150,${v?.07+.87*Math.sqrt(v/max):.03})"></div>`;
  }
  $('calendarCaption').textContent=`${focus} · daily time listened`;
  $('calendarHeatmap').innerHTML=`<div class="calendar-grid">${body}</div>`;
}
function renderSessions(s){const S=s.sessionSummary;$('sessionKpis').innerHTML=[kpi('Listening sessions',n(S.count),'30-minute idle gap'),kpi('Mean listening',minutes(S.mean)),kpi('Median listening',minutes(S.median)),kpi('Single-artist sessions',pct(S.monoArtist))].join('');
  $('sessionRows').innerHTML=S.top.map((x,i)=>`<tr><td>${i+1}</td><td>${h(date(x.start))}</td><td>${h(minutes(x.ms))}</td><td>${h(minutes(x.span))}</td><td>${n(x.plays)}</td><td>${h(x.topArtist)}</td><td>${h(pct(x.focus))}</td></tr>`).join('')||`<tr><td>No sessions recorded</td></tr>`;}
function renderQuality(s){const Q=s.quality;const fields=[['Input files analyzed',Q.files],['Raw history events',Q.raw],['Valid events',Q.accepted],['Rejected events',Q.rejected],['Overlapping duplicates',Q.duplicate],['Music events',Q.music],['Podcast events',Q.podcast],['Audiobook events',Q.audiobook],['Unclassified events',Q.unknown],['Malformed files',Q.malformed],['Extended-format events',Q.extended],['Standard-format events',Q.standard]];
  $('qualityCards').innerHTML=fields.map(([a,b])=>`<div class="panel quality-card"><span class="small-label">${h(a)}</span><strong>${n(b)}</strong></div>`).join('');}
function render(){const s=state.summary;if(!s)return;elements.dashboard.hidden=false;$('clearBtn').hidden=false;$('demoBadge').hidden=!state.demo;$('dataCoverage').textContent=s.count?`${n(s.count)} recorded listening events · ${date(s.from)} – ${date(s.to)} · ${s.filters.zone} · ${s.filters.type}`:'No events in selected period.';
  renderOverview(s);renderYears(s);renderMonths(s);renderTable(s,'artists');renderTable(s,'tracks');renderTable(s,'albums');renderAbandoned(s);renderPattern(s);renderSessions(s);renderQuality(s);
  if(state.demo)$('demoBadge').hidden=false;
}
function downloadCSV(){if(!state.summary)return;const s=state.summary;
  const rows=s.months.map(m=>({month:m.key,minutes:m.minutes,plays:m.plays,top_artist:m.topArtist?.name,top_artist_minutes:(m.topArtist?.ms||0)/60000,top_track:m.topTrack?.name,top_album:m.topAlbum?.name,artist_share_percent:(m.share*100).toFixed(2)}));
  const csv=toCsv(rows,['month','minutes','plays','top_artist','top_artist_minutes','top_track','top_album','artist_share_percent']);
  const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='spotify-atlas-months.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}

initAbandoned(update);
$('demoBtn').addEventListener('click',()=>demo());$('clearBtn').addEventListener('click',clear);
elements.fileInput.addEventListener('change',()=>load([...elements.fileInput.files]));
for(const event of ['dragenter','dragover'])elements.drop.addEventListener(event,e=>{e.preventDefault();elements.drop.classList.add('dragging');});
for(const event of ['dragleave','drop'])elements.drop.addEventListener(event,e=>{e.preventDefault();elements.drop.classList.remove('dragging');});
elements.drop.addEventListener('drop',e=>load([...e.dataTransfer.files]));
for(const id of ['periodSelect','metricSelect','typeSelect','thresholdSelect','zoneSelect','dateFrom','dateTo'])$(id).addEventListener('change',update);
for(const id of ['artistSearch','trackSearch','albumSearch','monthSearch'])$(id).addEventListener('input',()=>{if(!state.summary)return;id==='monthSearch'?renderMonths(state.summary):renderTable(state.summary,id.replace('Search','')+'s');});
for(const type of ['Artists','Tracks','Albums'])$(`more${type}`).addEventListener('click',()=>{state.tablePage[type.toLowerCase()]+=100;renderTable(state.summary,type.toLowerCase());});
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
$('csvBtn').addEventListener('click',downloadCSV);
