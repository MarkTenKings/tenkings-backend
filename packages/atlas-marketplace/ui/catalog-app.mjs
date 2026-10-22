import { publicCatalogConfig, publicFilters, renderPublicCatalog } from './catalog-view.mjs';

export function createPublicCatalogApp({root,fetchImpl=globalThis.fetch,origin=globalThis.location?.origin}={}) {
  const config=publicCatalogConfig(root.dataset),state={status:'loading',page:null,filters:{},sides:{},failedMedia:[],previousOffsets:[],origin};
  let sequence=0,controller=null,offset=0,closed=false;
  const render=()=>{if(!closed)root.innerHTML=renderPublicCatalog(state,config);};
  async function load({focus=false}={}) {
    const own=++sequence;controller?.abort();controller=new AbortController();state.status='loading';state.errorDetail=null;render();
    try {
      const query=new URLSearchParams({...state.filters,offset:String(offset),limit:'12'});
      const response=await fetchImpl(`${config.catalogPath}?${query}`,{method:'GET',credentials:'omit',cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('Catalog unavailable');const page=await response.json();
      if(!['SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION'].includes(page?.environment)||!Array.isArray(page.items)||!Number.isSafeInteger(page.total)||page.total<0||page.offset!==offset||!(page.nextOffset===null||Number.isSafeInteger(page.nextOffset)&&page.nextOffset>offset&&page.nextOffset<page.total))throw new Error('Catalog unavailable');
      if(closed||own!==sequence)return;state.page=page;state.status='ready';state.failedMedia=[];render();
    } catch(error) {if(closed||own!==sequence||error.name==='AbortError')return;state.status='error';render();}
    if(focus)root.querySelector?.('#catalog-status')?.focus();
  }
  async function submit(event) {
    if(event.target?.id!=='catalog-filters')return;event.preventDefault();
    try {state.filters=publicFilters(Object.fromEntries(new FormData(event.target)));offset=0;state.previousOffsets=[];await load({focus:true});}
    catch(error){state.errorDetail=error.message;render();root.querySelector?.('.notice')?.focus?.();}
  }
  async function click(event) {
    const button=event.target.closest?.('[data-action]');if(!button||button.disabled)return;
    const action=button.dataset.action;
    if(action==='side') {if(!['front','back'].includes(button.dataset.side)||!state.page?.items.some(item=>item.id===button.dataset.listing))return;state.sides[button.dataset.listing]=button.dataset.side;render();root.querySelector?.(`[data-action="side"][data-listing="${button.dataset.listing}"][data-side="${button.dataset.side}"]`)?.focus();return;}
    if(action==='clear'){state.filters={};offset=0;state.previousOffsets=[];}
    else if(action==='next'&&state.page?.nextOffset!==null&&state.page?.nextOffset!==undefined){state.previousOffsets.push(offset);offset=state.page.nextOffset;}
    else if(action==='previous'&&state.previousOffsets.length){offset=state.previousOffsets.pop();}
    else if(action!=='retry')return;
    await load({focus:true});
  }
  function imageError(event) {
    const image=event.target;if(image?.tagName!=='IMG'||!image.dataset?.listing)return;
    const key=`${image.dataset.listing}:${image.dataset.side}`;if(!state.failedMedia.includes(key)){state.failedMedia.push(key);render();}
  }
  root.addEventListener('submit',submit);root.addEventListener('click',click);root.addEventListener('error',imageError,true);
  return Object.freeze({ready:load(),reload:()=>load(),close(){closed=true;sequence++;controller?.abort();root.removeEventListener('submit',submit);root.removeEventListener('click',click);root.removeEventListener('error',imageError,true);}});
}
const root=globalThis.document?.getElementById('catalog');
if(root){try{const app=createPublicCatalogApp({root});globalThis.addEventListener?.('pagehide',()=>app.close(),{once:true});}catch{root.textContent='The catalog route is unavailable. Please try again later.';}}
