export function staffContentSecurityPolicy({development=false,uploadOrigins=[]}={}){
  const origins=[...new Set(uploadOrigins.filter(Boolean))].map(value=>{
    const url=new URL(value);
    if(url.origin!==value||url.protocol!=='https:'||url.username||url.password||!/^[a-z0-9][a-z0-9.-]+$/.test(url.hostname))throw new Error('Invalid private upload origin');
    return value;
  });
  return `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${development?" 'unsafe-eval'":''}; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:${origins.map(value=>` ${value}`).join('')}; media-src 'self' blob:; connect-src 'self' http://127.0.0.1:47662 http://127.0.0.1:47664${origins.map(value=>` ${value}`).join('')}; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}
