import {EventStore, analyze} from './core.mjs';
let store = new EventStore();
let filters = {zone:'UTC',metric:'minutes',type:'music',period:'all',threshold:30000,start:'',end:''};
const decoder = new TextDecoder('utf-8');
const msg = (type, detail={}) => self.postMessage({type,...detail});
self.onmessage = async ({data}) => {
  try {
    if(data.action==='reset') {store=new EventStore();msg('reset');return;}
    if(data.action==='chunk') {
      const text=decoder.decode(new Uint8Array(data.bytes));
      const result=store.ingest(data.name,text,data.sourceId);
      msg('chunk-done',{id:data.id,result,quality:store.quality});return;
    }
    if(data.action==='demo') {
      store=new EventStore();
      const artists=['Paper Moons','Copper River','Neon Orchard','Glass Assembly','Velvet Atlas','Static Bloom'];
      events=[];
      for(let year=2019;year<=2025;year++)for(let month=0;month<12;month++)for(let i=0;i<80;i++) {
        const retro=year<=2020 && i<10;
        const artist=retro?'Lost Signals':artists[(month+Math.floor(i/19)+year)%artists.length];
        const day=1+(i%27);const hour=(i*7+month)%24;
        events.push({ts:new Date(Date.UTC(year,month,day,hour,i%60)).toISOString(),
          ms_played:160000 + (i%8)*11000,master_metadata_album_artist_name:artist,
          master_metadata_track_name:retro?'Faded Frequencies':`${artist} — Track ${(i%8)+1}`,master_metadata_album_album_name:`${artist} — Sessions`,
          skipped:i%9===0,platform:i%3===0?'Android':'iOS',conn_country:i%4===0?'FR':'ES'});
      }
      store.ingest('Streaming_History_Audio_DEMO.json',events,'demo');store.finalize();
      filters=data.filters||filters;
      msg('ready',{summary:analyze(store.events,filters,store.quality),demo:true});return;
    }
    if(data.action==='finish') {
      store.finalize();filters=data.filters||filters;
      msg('ready',{summary:analyze(store.events,filters,store.quality),demo:false});return;
    }
    if(data.action==='filter') {
      filters={...filters,...data.filters};
      msg('summary',{summary:analyze(store.events,filters,store.quality)});return;
    }
  } catch(error) {
    msg('error',{message:error?.message||'Unable to analyze history.'});
  }
};
