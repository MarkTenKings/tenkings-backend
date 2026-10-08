// Keep the product's WebGL work out of the locked hero's initial load.
const section=document.querySelector('.at-nfc-tech');
if(section){
  const lifetime=new AbortController();
  let observer=null,started=false;
  async function mount(){
    if(started||lifetime.signal.aborted)return;
    started=true;observer?.disconnect();
    try{
      const {mountNfcTechnology}=await import('./nfc-technology.mjs');
      await mountNfcTechnology(section,{signal:lifetime.signal,onError:error=>console.error('ATLAS NFC product:',error)});
    }catch(error){
      if(!lifetime.signal.aborted)console.error('ATLAS NFC product:',error);
    }
  }
  if('IntersectionObserver' in window){
    observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))mount();},{rootMargin:'300px'});
    observer.observe(section);
  }else mount();
  window.addEventListener('pagehide',event=>{if(!event.persisted){observer?.disconnect();lifetime.abort();}},{signal:lifetime.signal});
}
