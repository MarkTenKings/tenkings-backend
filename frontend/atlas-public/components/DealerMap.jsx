import {useEffect,useRef,useState} from 'react';
let mapsPromise = null;
function loadMaps(apiKey) {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve,reject) => {
    const script=document.createElement('script'); let timer;
    const cleanup=()=>{ clearTimeout(timer); delete window.__atlasDealerMapReady; };
    window.__atlasDealerMapReady=()=>{cleanup();resolve(window.google.maps);};
    script.src=`https://maps.googleapis.com/maps/api/js?${new URLSearchParams({key:apiKey,loading:'async',v:'quarterly',callback:'__atlasDealerMapReady'})}`;
    script.async=true;script.onerror=()=>{cleanup();reject(new Error('MAP_UNAVAILABLE'));};
    timer=setTimeout(()=>{cleanup();reject(new Error('MAP_UNAVAILABLE'));},15000);
    document.head.append(script);
  }).catch(error=>{mapsPromise=null;throw error;});
  return mapsPromise;
}
export default function DealerMap({configuration,dealers,onSelect}) {
  const container=useRef(null),map=useRef(null),markers=useRef([]),select=useRef(onSelect);
  const [enabled,setEnabled]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(false);
  select.current=onSelect;
  useEffect(()=>{
    if(!enabled||!configuration)return;
    let disposed=false;setReady(false);setError(false);
    loadMaps(configuration.apiKey).then(async api=>{
      const [{Map},{AdvancedMarkerElement}]=await Promise.all([api.importLibrary('maps'),api.importLibrary('marker')]);
      if(disposed)return;
      map.current={instance:new Map(container.current,{mapId:configuration.mapId,center:{lat:39,lng:-98},zoom:4,disableDefaultUI:true,zoomControl:true,gestureHandling:'cooperative'}),Marker:AdvancedMarkerElement,api};
      setReady(true);
    }).catch(()=>{if(!disposed)setError(true);});
    return()=>{disposed=true;markers.current.forEach(m=>m.map=null);markers.current=[];map.current=null;};
  },[enabled,configuration?.apiKey,configuration?.mapId]);
  useEffect(()=>{
    if(!ready||!map.current)return;
    const {instance,Marker,api}=map.current;
    markers.current.forEach(m=>m.map=null);markers.current=[];
    const bounds=new api.LatLngBounds();
    for(const dealer of dealers.filter(d=>d.position)){
      const marker=new Marker({map:instance,position:dealer.position,title:dealer.name});
      marker.addListener('click',()=>select.current(dealer.id));markers.current.push(marker);bounds.extend(dealer.position);
    }
    if(markers.current.length===1){instance.setCenter(dealers.find(d=>d.position).position);instance.setZoom(12);}
    else if(markers.current.length)instance.fitBounds(bounds,54);
  },[ready,dealers]);
  if(!configuration||!enabled&&!dealers.some(d=>d.position))return null;
  return <section className="dealer-map" aria-label="Authorized dealer map">
    {!enabled?<button className="dealer-map-activate" onClick={()=>setEnabled(true)}><span aria-hidden="true">↗</span> Explore the map<small>Load Google Maps</small></button>:<>
      <div ref={container} className="dealer-map-canvas"/>
      {!ready&&!error&&<p className="dealer-map-message" role="status">Loading map…</p>}
      {error&&<p className="dealer-map-message" role="status">Map unavailable. Dealer details and directions are below.</p>}
    </>}
  </section>;
}
