import QRCode from 'qrcode';
/** Native QR geometry. Browser receives no executable SVG markup or external image URL. */
export function handoffQr(url){
 const parsed=new URL(url);
 if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=='/account/dealer/handoff'||!/^#v1\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(parsed.hash))throw Error('INVALID_HANDOFF_URL');
 const qr=QRCode.create(url,{errorCorrectionLevel:'M'}),n=qr.modules.size;
 let path='';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(qr.modules.get(y,x))path+=`M${x+4} ${y+4}h1v1h-1z`;
 return {size:n+8,path};
}
