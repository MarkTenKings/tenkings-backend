import { approvedReportPath } from './report-link.mjs';
const h=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100):'Unavailable';
const path=value=>typeof value==='string'&&/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(value);
export function publicCatalogConfig(dataset={}) {
  const catalogPath=dataset.catalogPath??'/marketplace/catalog',customerPath=dataset.customerPath??'/account/marketplace/';
  if(!path(catalogPath)||catalogPath.endsWith('/')||!path(customerPath)||!customerPath.endsWith('/'))throw new Error('Catalog route configuration is unavailable.');
  return {catalogPath,customerPath};
}
export function approvedPublicUrl(value,environment,origin) {
  if(typeof value!=='string'||value.length>2000||/[\\\s%]/.test(value)||value.includes('..')||value.startsWith('//'))return null;
  try {
    const url=new URL(value,origin);
    if(url.origin!==origin||url.username||url.password||url.search||url.hash||!/^\/[A-Za-z0-9_./-]+$/.test(url.pathname)||url.pathname.includes('//'))return null;
    if(url.pathname.startsWith('/demo/'))return environment==='SYNTHETIC_LOCAL'?url.pathname:null;
    // Only an explicit evidence path can be rendered. Public access to those
    // exact bytes remains a separately qualified server boundary.
    return /\/(?:marketplace\/)?evidence\//.test(url.pathname)?url.pathname:null;
  } catch {return null;}
}
export function publicFilters(formValues={}) {
  const allowed=['query','category','year','set','grade','minPriceCents','maxPriceCents','numberedDenominator','autograph','relic'];
  const result={};
  for(const key of allowed) {
    const value=formValues[key];if(value===undefined||value==='')continue;
    if(typeof value!=='string'||value.length>200)throw new Error('Review the catalog filters.');
    if(['minPriceCents','maxPriceCents'].includes(key)) {
      if(!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value))throw new Error('Enter a USD price with no more than two decimal places.');
      const [whole,fraction='']=value.split('.'),cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
      if(cents>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('That price is too large.');
      result[key]=String(cents);continue;
    }
    if(key==='numberedDenominator'&&!/^[1-9][0-9]*$/.test(value))throw new Error('Enter the positive number the card is numbered out of.');
    if(key==='grade'&&!/^(?:[0-9](?:\.[0-9]+)?|10(?:\.0+)?)$/.test(value))throw new Error('Enter the exact approved grade from 0 to 10.');
    if(['autograph','relic'].includes(key)&&!['true','false'].includes(value))throw new Error('Choose Any, Yes or No.');
    result[key]=value;
  }
  if(result.minPriceCents!==undefined&&result.maxPriceCents!==undefined&&BigInt(result.minPriceCents)>BigInt(result.maxPriceCents))throw new Error('Minimum price must not exceed maximum price.');
  return result;
}
function filtersForm(filters,busy) {
  const input=(key,label,type='text',extra='')=>{const stored=filters[key]??'',value=['minPriceCents','maxPriceCents'].includes(key)&&/^[0-9]+$/.test(stored)?`${BigInt(stored)/100n}.${String(BigInt(stored)%100n).padStart(2,'0')}`:stored;return `<label>${label}<input name="${key}" type="${type}" value="${h(value)}" ${extra}></label>`;};
  const select=(key,label,items)=>`<label>${label}<select name="${key}">${items.map(([value,title])=>`<option value="${h(value)}"${(filters[key]??'')===value?' selected':''}>${h(title)}</option>`).join('')}</select></label>`;
  return `<form id="catalog-filters" class="public-filters"><div class="public-filter-grid">${input('query','Name or certificate','search','maxlength="200"')}${select('category','Category',[['','All cards'],['SPORTS','Sports'],['POKEMON','Pokémon']])}${input('year','Year','text','maxlength="200"')}${input('set','Set','text','maxlength="200"')}${input('grade','Exact grade','number','min="0" max="10" step="any"')}${input('minPriceCents','Minimum price (USD)','number','min="0" step="0.01"')}${input('maxPriceCents','Maximum price (USD)','number','min="0" step="0.01"')}${input('numberedDenominator','Numbered out of','number','min="1" step="1"')}${select('autograph','Autograph',[['','Any'],['true','Yes'],['false','No']])}${select('relic','Relic',[['','Any'],['true','Yes'],['false','No']])}</div><div class="public-filter-actions"><button class="button" type="submit"${busy?' disabled':''}>Apply filters</button><button class="button secondary" type="button" data-action="clear"${busy?' disabled':''}>Clear filters</button><p class="small">Unknown attributes are not treated as “No.” Shipping and tax appear with your complete quote.</p></div></form>`;
}
function cardView(item,state,config) {
  const card=item.approvedCard,identity=card?.identity;if(!card||!identity||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.id??''))return '';
  const side=state.sides?.[item.id]==='back'?'back':'front',src=approvedPublicUrl(card.media?.[side]?.url,state.page.environment,state.origin),report=approvedReportPath(card.reportUrl,card.reportVersion)??approvedPublicUrl(card.reportUrl,state.page.environment,state.origin);
  const failed=state.failedMedia?.includes(`${item.id}:${side}`),id=h(item.id),title=h(identity.name),href=`${config.customerPath}?listingId=${encodeURIComponent(item.id)}`;
  return `<article class="public-card" aria-labelledby="title-${id}"><div class="public-card-media">${src&&!failed?`<img src="${h(src)}" width="${h(card.media[side].width)}" height="${h(card.media[side].height)}" alt="${h(side==='front'?'Front':'Back')} of ${title}" loading="lazy" decoding="async" data-listing="${id}" data-side="${side}">`:'<p class="public-media-unavailable" role="status">Approved image unavailable. Review the saved evidence before purchase.</p>'}</div><div class="public-card-controls" role="group" aria-label="Approved card evidence"><button type="button" class="button secondary" data-action="side" data-listing="${id}" data-side="front" aria-pressed="${side==='front'}">Front</button><button type="button" class="button secondary" data-action="side" data-listing="${id}" data-side="back" aria-pressed="${side==='back'}">Back</button>${report?`<a class="public-report" href="${h(report)}" target="_blank" rel="noopener noreferrer">Grade Report<span class="sr-only"> (opens a new tab)</span></a>`:'<span class="small muted">Report unavailable</span>'}</div><div class="public-card-copy"><p class="eyebrow">${h(identity.category)} · ${h(identity.year??'Year unknown')}</p><h2 id="title-${id}">${title}</h2><p class="public-set">${h(identity.set??'Set not recorded')}</p><dl class="public-card-facts"><div><dt>Approved grade</dt><dd>${h(identity.grade)}</dd></div><div><dt>Certificate</dt><dd>${h(card.certificateId)}</dd></div><div><dt>Numbered</dt><dd>${identity.numberedDenominator===null?'Unknown':`Out of ${h(identity.numberedDenominator)}`}</dd></div><div><dt>Report</dt><dd>Version ${h(card.reportVersion)}</dd></div></dl><div class="public-card-bottom"><div><span class="small muted">Asking price</span><p class="public-price">${h(money(item.askingPriceCents))}</p></div><span class="status-pill">Available · ATLAS-held</span></div><a class="button public-buy" href="${h(href)}">Sign in to review total</a><p class="small muted">Shipping, tax and the full buyer total are shown before reservation. Availability is checked again.</p></div></article>`;
}
export function renderPublicCatalog(state,config) {
  const environment=state.page?.environment,busy=state.status==='loading',items=state.page?.items??[],pageReady=state.status==='ready';
  const banner=environment==='SYNTHETIC_LOCAL'?'<div class="local-banner"><strong>LOCAL SYNTHETIC DEMO</strong><span>Test listings and artwork only. No real cards or funds.</span></div>':environment==='PROVIDER_SANDBOX'?'<div class="local-banner"><strong>PROVIDER SANDBOX</strong><span>Isolated testing. These listings are not a production marketplace.</span></div>':'';
  const notice=busy?'Reading current available listings…':state.status==='error'?'The catalog could not be loaded. Retry to read current availability.':`${state.page?.total??0} available listing${state.page?.total===1?' matches':'s match'} your filters.`;
  return `${banner}<header class="site-header"><a class="wordmark" href="#main">ATLAS<span>MARKETPLACE</span></a><nav aria-label="Marketplace"><a href="#catalog-filters">Browse cards</a><a href="${h(config.customerPath)}">Sign in</a></nav></header><main id="main" class="public-main"><div class="page-heading"><div><p class="eyebrow">AVAILABLE CARDS / APPROVED EVIDENCE</p><h1>Find your next card.</h1><p>Inspect both sides and the exact Grade Report before you buy.</p></div></div>${filtersForm(state.filters??{},busy)}<div class="public-results-heading"><p id="catalog-status" role="status" aria-live="polite" tabindex="-1">${h(notice)}</p>${state.status==='error'?'<button class="button secondary" data-action="retry">Retry catalog</button>':''}</div>${state.errorDetail?`<p class="notice attention" tabindex="-1">${h(state.errorDetail)}</p>`:''}<section class="public-grid" aria-label="Available card listings" aria-busy="${busy}">${pageReady&&items.length?items.map(item=>cardView(item,state,config)).join(''):pageReady?'<div class="empty-state"><h2>No available listings match.</h2><p>Try fewer filters or check again when another card is listed.</p></div>':busy?'<div class="public-loading" aria-hidden="true">Loading current catalog…</div>':''}</section><nav class="public-paging" aria-label="Catalog pages"><button class="button secondary" data-action="previous"${!pageReady||!(state.previousOffsets?.length)?' disabled':''}>Previous page</button><p class="small">${pageReady&&state.page&&items.length?`Showing ${h(state.page.offset+1)}–${h(state.page.offset+items.length)} of ${h(state.page.total)}`:'Current available inventory'}</p><button class="button secondary" data-action="next"${!pageReady||state.page?.nextOffset===null||state.page?.nextOffset===undefined?' disabled':''}>Next page</button></nav><footer><a class="wordmark small-wordmark" href="#main">ATLAS<span>MARKETPLACE</span></a><p>Approved evidence stays with the exact listing.<br>Sign in to review the current quote and protection terms.</p></footer></main>`;
}
