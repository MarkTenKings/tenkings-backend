import type { NextApiRequest, NextApiResponse } from 'next';
import { IDENTITY_CORRECTION_PATH } from '@atlas/service-bridge/identity-correction';
import { canonical, requireBridge } from '@atlas/service-bridge/protocol';
export function createAtlasIdentityCorrectionHandler<Settings extends {origin:string}>(ports:{settings:()=>Settings;
    receive:(settings:Settings,body:string,signature:string,signal:AbortSignal)=>Promise<unknown>},
    {timers={setTimeout,clearTimeout}}:{timers?:{setTimeout:typeof setTimeout;clearTimeout:typeof clearTimeout}}={}){
    return async(req:NextApiRequest,res:NextApiResponse)=>{
        res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
        let iterator:AsyncIterator<unknown>|undefined,timer:ReturnType<typeof setTimeout>|undefined,closed=false,readComplete=false;
        const controller=new AbortController();
        const cancelRead=()=>{if(readComplete)return;
            try{Promise.resolve(iterator?.return?.()).catch(()=>{});}catch{/* A broken reader cannot hold the deadline. */}
            try{req.destroy?.();}catch{/* Response lifetime remains bounded even if request destruction fails. */}
        };
        const deadline=new Promise<never>((_,reject)=>{timer=timers.setTimeout(()=>{
            closed=true;controller.abort();cancelRead();reject(new Error('IDENTITY_HTTP_DEADLINE'));
        },25_000);});
        try{
            const result=await Promise.race([deadline,(async()=>{
                const settings=ports.settings(),host=new URL(settings.origin).host,signature=req.headers['x-atlas-identity-signature'],length=req.headers['content-length'];
                requireBridge(req.method==='POST'&&req.url===IDENTITY_CORRECTION_PATH&&req.headers.host===host
                    &&(!req.headers['x-forwarded-host']||req.headers['x-forwarded-host']===host)&&req.headers['x-forwarded-proto']==='https'
                    &&!req.headers.cookie&&!req.headers.authorization&&req.headers['content-type']==='application/json'
                    &&typeof signature==='string'&&/^[a-f0-9]{64}$/.test(signature)
                    &&(length===undefined||typeof length==='string'&&/^\d+$/.test(length)&&Number(length)<=8192),'IDENTITY_REQUEST_INVALID');
                const chunks:Buffer[]=[];let size=0;iterator=req[Symbol.asyncIterator]();
                while(true){const next=await iterator.next();requireBridge(!closed,'IDENTITY_HTTP_DEADLINE');
                    if(next.done){readComplete=true;break;}
                    requireBridge(typeof next.value==='string'||next.value instanceof Uint8Array,'IDENTITY_REQUEST_INVALID');
                    const bytes=typeof next.value==='string'?Buffer.from(next.value):Buffer.from(next.value as Uint8Array);
                    size+=bytes.length;requireBridge(size<=8192,'IDENTITY_REQUEST_INVALID');chunks.push(bytes);}
                const bytes=Buffer.concat(chunks),body=bytes.toString('utf8');
                requireBridge(!closed&&!req.aborted&&Buffer.from(body,'utf8').equals(bytes)&&(length===undefined||Number(length)===size)
                    &&canonical(JSON.parse(body))===body,'IDENTITY_REQUEST_INVALID');
                const result=canonical(await ports.receive(settings,body,signature as string,controller.signal));
                requireBridge(!closed&&Buffer.byteLength(result)<=16384,'IDENTITY_RESPONSE_INVALID');return result;
            })()]);
            res.setHeader('Content-Type','application/json');return res.status(200).send(result);
        }catch{return res.status(503).json({error:'ATLAS_IDENTITY_CORRECTION_UNAVAILABLE'});}
        finally{closed=true;timers.clearTimeout(timer);controller.abort();cancelRead();}
    };
}
