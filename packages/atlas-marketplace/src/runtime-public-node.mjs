import { readFile } from 'node:fs/promises';
import { createPublicCatalogHandler } from './public-http.mjs';
import { requireValue } from './contract.mjs';
import { createMarketplaceHostCheck } from './host-boundary.mjs';

const assets=new Map([['','catalog.html'],['catalog-app.mjs','catalog-app.mjs'],['catalog-view.mjs','catalog-view.mjs'],['report-link.mjs','report-link.mjs'],['catalog.css','catalog.css'],['styles.css','styles.css']]);
const csp="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
// Explicit public read-only mount. It cannot reach authenticated commands,
// provider operations, private media or a shared application's route table.
export function createMarketplacePublicNodeHandler(options={}) {
  const mountPath=options.mountPath??'/marketplace/',catalogPath=options.catalogPath??'/marketplace/catalog',customerPath=options.customerPath??'/account/marketplace/';
  const directory=value=>typeof value==='string'&&/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/$/.test(value);
  requireValue(directory(mountPath)&&directory(customerPath)&&/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(catalogPath),'ROUTE_CONFIGURATION_UNAVAILABLE');
  const catalog=createPublicCatalogHandler({...options,catalogPath});let closed=false;
  const acceptsHost=options.enabled===true?createMarketplaceHostCheck(options):()=>false;
  const listener=async(request,response)=>{
    const send=(status,body,headers={})=>{response.writeHead(status,{'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers});response.end(Buffer.isBuffer(body)?body:JSON.stringify(body));};
    if(options.enabled!==true||closed)return send(503,{error:'CATALOG_DISABLED'});
    try {
      const url=new URL(request.url,options.origin);
      requireValue(url.origin===options.origin&&acceptsHost(request.headers.host),'HOST_REFUSED');
      const file=url.pathname.startsWith(mountPath)?assets.get(url.pathname.slice(mountPath.length)):null;
      if(request.method==='GET'&&file) {
        requireValue(!request.headers['transfer-encoding']&&[undefined,'0'].includes(request.headers['content-length']),'INVALID_REQUEST');
        let bytes=await readFile(new URL('../ui/'+file,import.meta.url));
        if(file==='catalog.html')bytes=Buffer.from(bytes.toString('utf8').replace('data-catalog-path="/marketplace/catalog"',`data-catalog-path="${catalogPath}"`).replace('data-customer-path="/account/marketplace/"',`data-customer-path="${customerPath}"`));
        return send(200,bytes,{'Content-Type':(file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript')+'; charset=utf-8','Content-Security-Policy':csp});
      }
      const result=await catalog.handle(request);return send(result.status,result.body,result.headers);
    } catch(error) {return send(error.code==='HOST_REFUSED'?403:503,{error:error.code==='HOST_REFUSED'?'HOST_REFUSED':'CATALOG_UNAVAILABLE'});}
  };
  return Object.freeze({listener,close(){closed=true;catalog.close();}});
}
