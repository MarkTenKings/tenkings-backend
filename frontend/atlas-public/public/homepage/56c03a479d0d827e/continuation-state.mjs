// Each chapter owns its approved report, pending reads, and temporary image URLs.
// A failed read can be retried without borrowing another chapter's evidence.
export function createSectionSession({section, load, fetchAsset, createURL, revokeURL}) {
  let disposed=false, pending=null, manifest=null;
  const lifetime=new AbortController(), requests=new Map(), assets=new Map();
  const assertActive=()=>{if(disposed)throw new DOMException('Section closed','AbortError');};
  return {
    section,
    async load() {
      assertActive();
      if(manifest)return manifest;
      if(!pending)pending=Promise.resolve().then(()=>load(section,{signal:lifetime.signal})).then(value=>{
        assertActive();manifest=value;return value;
      }).finally(()=>{pending=null;});
      return pending;
    },
    request(slot) {
      assertActive();requests.get(slot)?.abort();
      const controller=new AbortController();requests.set(slot,controller);
      return {signal:controller.signal,current:()=>!disposed&&!controller.signal.aborted&&requests.get(slot)===controller};
    },
    async asset(asset,{signal}={}) {
      assertActive();
      if(!asset)throw new Error('Saved image unavailable');
      if(signal?.aborted)throw new DOMException('Superseded read','AbortError');
      const key=asset.sha256||asset.contentKey;
      if(!key)throw new Error('Unbound image');
      if(assets.has(key))return assets.get(key);
      const blob=await fetchAsset(asset,{signal:signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal});
      assertActive();
      if(signal?.aborted)throw new DOMException('Superseded read','AbortError');
      if(assets.has(key))return assets.get(key);
      const url=createURL(blob);assets.set(key,url);return url;
    },
    dispose() {
      if(disposed)return;disposed=true;lifetime.abort();
      for(const controller of requests.values())controller.abort();
      for(const url of assets.values())revokeURL(url);
      requests.clear();assets.clear();manifest=null;
    }
  };
}

export function sectionFindingDetail(section,manifest,findingId) {
  if(!manifest?.report?.bindingKey||!manifest.findings.some(finding=>finding.id===findingId))
    throw new Error('Finding does not belong to this approved report');
  return {section,reportKey:manifest.report.bindingKey,manifest,findingId,id:findingId};
}

export function sideGeometry(side) {
  const physical=side?.geometry?.physicalQuadSource,printed=side?.geometry?.printedQuadSource;
  const quad=value=>Array.isArray(value)&&value.length===4&&value.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite));
  return quad(physical)&&quad(printed)?{physical,printed}:null;
}

export function fingerprintArea(manifest,side) {
  const values=[side?.fingerprint?.occupiedPixels,manifest.card?.widthMm,manifest.card?.heightMm,manifest.card?.canonicalWidth,manifest.card?.canonicalHeight];
  if(!values.every(Number.isFinite)||values.slice(1).some(value=>value<=0))return null;
  return values[0]*values[1]*values[2]/values[3]/values[4];
}
