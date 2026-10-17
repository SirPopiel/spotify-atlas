import {toCsv} from './core.mjs';
const el=id=>document.getElementById(id);
const day=t=>t==null?'—':new Date(t).toISOString().slice(0,10);
const num=x=>new Intl.NumberFormat('en-US').format(x||0);
let dataset=null,visible=50;
export function abandonedFilters(){return {abandonedMinPlays:Number(el('abandonedMinPlays')?.value||30),abandonedYears:Number(el('abandonedYears')?.value||4)};}
export function resetAbandoned(){
  if(!el('abandonedMinPlays'))return;
  el('abandonedMinPlays').value='30';el('abandonedYears').value='4';el('abandonedSearch').value='';
  dataset=null;visible=50;
}
const td=(tr,value)=>{const c=document.createElement('td');c.textContent=String(value);tr.append(c);return c;};
const box=(label,value)=>{const div=document.createElement('div');div.className='panel abandoned-kpi';const l=document.createElement('small');l.textContent=label;const v=document.createElement('strong');v.textContent=value;div.append(l,v);return div;};
export function renderAbandoned(summary){
  const data=dataset=summary.abandoned;
  el('abandonedMethod').textContent=data.archiveEnd==null?'No listening history available.':
    'History through '+day(data.archiveEnd)+' · At least '+num(data.minPlays)+' plays lasting 30+ seconds · No positive-length listening since '+day(data.cutoff)+'. Based on your export, not today.';
  const q=el('abandonedSearch').value.trim().toLowerCase();
  const hits=data.items.filter(x=>!q||(x.name+' '+x.artist+' '+x.album).toLowerCase().includes(q));
  const oldest=data.items.length?Math.min(...data.items.map(x=>x.last)):null;
  const summaryBox=el('abandonedKpis');summaryBox.replaceChildren(
    box('Abandoned tracks',num(data.total)),
    box('Previous plays',num(data.items.reduce((sum,x)=>sum+x.plays,0))),
    box('Oldest last listen',day(oldest))
  );
  const tbody=el('abandonedRows');tbody.replaceChildren();
  for(const [index,x] of hits.slice(0,visible).entries()){
    const tr=document.createElement('tr');
    td(tr,index+1);const name=td(tr,x.name);name.title=x.album;
    td(tr,x.artist);td(tr,num(x.plays));td(tr,day(x.last));
    td(tr,((data.archiveEnd-x.last)/(86400000*365.2425)).toFixed(1)+' years');
    const linkCell=td(tr,'');
    if(x.url){const a=document.createElement('a');a.href=x.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Listen ↗';a.setAttribute('aria-label','Listen to '+x.name+' by '+x.artist+' on Spotify');linkCell.append(a);}
    else linkCell.textContent='—';
    tbody.append(tr);
  }
  if(!hits.length){const tr=document.createElement('tr');const message=td(tr,'No matches. Try a shorter gap or lower play threshold.');message.colSpan=7;tbody.append(tr);}
  el('moreAbandoned').hidden=hits.length<=visible;
}
function exportCsv(){
  if(!dataset)return;
  const rows=dataset.items.map(x=>({title:x.name,artist:x.artist,album:x.album,plays:x.plays,
    listening_minutes:(x.ms/60000).toFixed(1),last_heard:day(x.last),spotify_url:x.url}));
  const csv=toCsv(rows,['title','artist','album','plays','listening_minutes','last_heard','spotify_url']);
  const url=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='spotify-atlas-abandoned-favorites.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
}
export function initAbandoned(refresh){
  const tab=document.createElement('button');tab.className='tab';tab.dataset.tab='abandoned';tab.textContent='Abandoned favorites';
  document.querySelector('[data-tab="albums"]').before(tab);
  const section=document.createElement('section');section.id='view-abandoned';section.className='view';
  section.innerHTML='<div class="section-heading"><div><span class="micro-label">SONGS YOU LEFT BEHIND</span><h3>Abandoned favorites</h3></div></div>'+
    '<p id="abandonedMethod" class="abandoned-note"></p>'+
    '<div class="panel abandoned-controls">'+
    '<label>Minimum plays<select id="abandonedMinPlays"><option value="10">10 plays</option><option value="20">20 plays</option><option value="30" selected>30 plays</option><option value="50">50 plays</option><option value="100">100 plays</option></select></label>'+
    '<label>Not heard for<select id="abandonedYears"><option value="1">1 year</option><option value="2">2 years</option><option value="3">3 years</option><option value="4" selected>4 years</option><option value="5">5 years</option><option value="8">8 years</option></select></label>'+
    '<label class="abandoned-search-label">Search<input class="search" id="abandonedSearch" type="search" placeholder="Song or artist" aria-label="Search abandoned favorites"></label>'+
    '<button class="show-more abandoned-export" id="abandonedCsv" type="button">Export CSV ↓</button></div>'+
    '<div id="abandonedKpis" class="abandoned-kpis"></div>'+
    '<div class="panel table-card"><div class="table-scroll"><table><thead><tr><th>#</th><th>Track</th><th>Artist</th><th>Past plays</th><th>Last heard</th><th>Time away</th><th>Spotify</th></tr></thead><tbody id="abandonedRows"></tbody></table></div><button class="show-more" id="moreAbandoned" type="button" hidden>Show more ↓</button></div>'+
    '<p class="abandoned-note">Uses your full imported music history, regardless of other dashboard filters. Common remasters are grouped; remixes and live versions stay separate. Even a very brief recent listen prevents a song from being classified as abandoned. Listening outside Spotify is not visible.</p>';
  el('view-albums').before(section);
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./abandoned.css',import.meta.url).href;document.head.append(link);
  for(const id of ['abandonedMinPlays','abandonedYears'])el(id).addEventListener('change',()=>{visible=50;refresh();});
  el('abandonedSearch').addEventListener('input',()=>{if(dataset)renderAbandoned({abandoned:dataset});});
  el('moreAbandoned').addEventListener('click',()=>{visible+=100;if(dataset)renderAbandoned({abandoned:dataset});});
  el('abandonedCsv').addEventListener('click',exportCsv);
}
