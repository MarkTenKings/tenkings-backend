import { readFile } from 'node:fs/promises';
import { createMarketplaceHttpHandler,MAX_MARKETPLACE_PROOF_BYTES } from './http.mjs';
import { requireValue } from './contract.mjs';
import { createMarketplaceHostCheck } from './host-boundary.mjs';

const assets=new Map([
  ['',['workspace.html','text/html']],
  ['app.mjs',['app.mjs','text/javascript']],
  ['physical-evidence.mjs',['physical-evidence.mjs','text/javascript']],
  ['parcel-presets.mjs',['parcel-presets.mjs','text/javascript']],
  ['stripe-payment.mjs',['stripe-payment.mjs','text/javascript']],
  ['view.mjs',['view.mjs','text/javascript']],
  ['report-link.mjs',['report-link.mjs','text/javascript']],
  ['styles.css',['styles.css','text/css']],
]);
export const MARKETPLACE_CSP="default-src 'self'; script-src 'self' https://js.stripe.com https://*.js.stripe.com; style-src 'self'; img-src 'self'; connect-src 'self' https://api.stripe.com https://r.stripe.com https://m.stripe.network; frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

// Returns a Node HTTP listener for explicit host integration. Does not listen,
// discover credentials, install routes, migrate, start jobs or enable itself.
export function createMarketplaceNodeHandler(options={}) {
  const mountPath=options.mountPath??'/marketplace/', apiPath=options.apiPath??'/api/marketplace';
  requireValue(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/$/.test(mountPath)&&/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(apiPath),'ROUTE_CONFIGURATION_UNAVAILABLE');
  const handler=createMarketplaceHttpHandler(options);
  const enabled=options.enabled===true; let closed=false;
  const acceptsHost=enabled?createMarketplaceHostCheck(options):()=>false;
  const listener=async(request,response)=>{
    const send=(status,body,headers={})=>{
      response.writeHead(status,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Type':'application/json',...headers});
      response.end(Buffer.isBuffer(body)?body:JSON.stringify(body));
    };
    if(!enabled||closed) return send(503,{error:'MARKETPLACE_DISABLED'});
    try {
      const url=new URL(request.url,options.origin);
      requireValue(url.origin===options.origin&&acceptsHost(request.headers.host),'HOST_REFUSED');
      const asset=url.pathname.startsWith(mountPath)?assets.get(url.pathname.slice(mountPath.length)):null;
      if(request.method==='GET'&&asset) {
        const [name,type]=asset;
        let bytes=await readFile(new URL(`../ui/${name}`,import.meta.url));
        if(name==='workspace.html') bytes=Buffer.from(bytes.toString('utf8').replace('data-runtime="AUTHENTICATED"',`data-runtime="AUTHENTICATED" data-api-path="${apiPath}" data-mount-path="${mountPath}"`));
        return send(200,bytes,{'Content-Type':type+'; charset=utf-8','Content-Security-Policy':MARKETPLACE_CSP});
      }
      const webhook=url.pathname===apiPath+'/provider/webhook';
      const proofUpload=request.method==='POST'&&url.pathname.startsWith(apiPath+'/proofs/upload/')&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(url.pathname.slice((apiPath+'/proofs/upload/').length));
      const maxBytes=webhook?262144:proofUpload?MAX_MARKETPLACE_PROOF_BYTES:16384;
      requireValue(!request.headers['content-length']||Number(request.headers['content-length'])<=maxBytes,'BODY_TOO_LARGE');
      let length=0; const chunks=[];
      for await(const chunk of request) {length+=chunk.length;requireValue(length<=maxBytes,'BODY_TOO_LARGE');chunks.push(chunk);}
      const rawBody=Buffer.concat(chunks);
      if(webhook) {
        requireValue(request.method==='POST'&&!url.search&&typeof options.receiveProviderWebhook==='function','WEBHOOK_UNAVAILABLE');
        // The injected receiver must verify the signature over these exact bytes
        // and retain delivery before acknowledgement. No JSON reserialization.
        await options.receiveProviderWebhook({rawBody,signature:request.headers['stripe-signature']??''});
        return send(200,{received:true});
      }
      // R1 admission consumes the original IncomingMessage, including its socket
      // and signed mounted URI. Retain bytes without replacing that capability
      // with a projection of selected request fields.
      request.rawBody=rawBody;
      const result=await handler.handle(request);
      send(result.status,result.body,result.headers);
    } catch(error) {const code=/^[A-Z0-9_]{1,100}$/.test(error.code??'')?error.code:'REQUEST_FAILED';send(code==='BODY_TOO_LARGE'?413:/REFUSED|SIGNATURE/.test(code)?403:409,{error:code});}
  };
  return Object.freeze({listener,close:()=>{closed=true;handler.close();}});
}
