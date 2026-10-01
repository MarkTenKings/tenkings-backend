import { sampleFilm, projectFilmPoint, ease, clamp } from './approved-report-tour.mjs';
import { fingerprintSource, fingerprintFieldSteps, fingerprintSampleSteps, scheduleFingerprint, paintFingerprintPixels } from './report-fingerprint.mjs';

const GOLD='#cda955',GREEN='#a0f46d',RED='#ff284d';
let brandReady;
function loadBrand(){return brandReady??=(async()=>{const logo=new Image();logo.src='/brand/atlas-grading-logo.png';
  await Promise.all([logo.decode().catch(()=>{}),typeof FontFace==='function'?new FontFace('Atlas Film','url(/brand/fonts/oxanium.ttf)',{weight:'200 800'}).load().then(font=>document.fonts.add(font)).catch(()=>{}):Promise.resolve()]);return logo.naturalWidth?logo:null;})();}
const makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
function shader(gl,type,source) { const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);throw Error('FILM_GRAPHICS_UNAVAILABLE');}return s; }
function cardStage(width,height) {
  const canvas=makeCanvas(width,height),gl=canvas.getContext('webgl',{alpha:true,antialias:true,preserveDrawingBuffer:true,premultipliedAlpha:false});
  if(!gl)throw Error('FILM_GRAPHICS_UNAVAILABLE');
  const vs=shader(gl,gl.VERTEX_SHADER,'attribute vec4 p;attribute vec2 uv;varying vec2 v;void main(){gl_Position=p;v=uv;}');
  const fs=shader(gl,gl.FRAGMENT_SHADER,`precision mediump float;varying vec2 v;uniform sampler2D photo;uniform sampler2D mask;uniform sampler2D fingerprint;uniform float tide;uniform float pulse;
    void main(){vec4 c=texture2D(photo,v);float m=texture2D(mask,v).r;vec4 f=texture2D(fingerprint,v);c.rgb=mix(c.rgb,f.rgb,f.a*tide);float grid=max(step(.91,fract(v.x*1270./12.)),step(.91,fract(v.y*1778./12.)));c.rgb=mix(c.rgb,mix(vec3(1.,.04,.17),vec3(.5,1.,.25),grid),m*(.45+.15*pulse));gl_FragColor=c;}`);
  const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('FILM_GRAPHICS_UNAVAILABLE');
  gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  for(const [name,n,offset]of[['p',4,0],['uv',2,16]]){const loc=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,n,gl.FLOAT,false,24,offset);}
  const textures=[];
  function texture(source,luminance=false,w,h) { const t=gl.createTexture();textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    if(luminance)gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,w,h,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,source);else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,luminance?gl.NEAREST:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,luminance?gl.NEAREST:gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;
  }
  return {canvas,texture,draw(side,state,assets){
    if(gl.isContextLost())throw Error('FILM_GRAPHICS_UNAVAILABLE');
    gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    const corners=[[0,0],[1,0],[1,1],[0,1]],v=[];
    for(const i of[0,1,2,0,2,3]){const uv=corners[i],p=projectFilmPoint(uv,side,state,canvas.width,canvas.height);v.push((p.x/canvas.width*2-1)*p.depth,(1-p.y/canvas.height*2)*p.depth,0,p.depth,...uv);}
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(v),gl.DYNAMIC_DRAW);
    for(const [i,name]of['photo','mask','fingerprint'].entries()){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,assets[name]);gl.uniform1i(gl.getUniformLocation(program,name),i);}
    gl.uniform1f(gl.getUniformLocation(program,'tide'),state.fingerprint);gl.uniform1f(gl.getUniformLocation(program,'pulse'),.5+.5*Math.sin(state.t*Math.PI));gl.drawArrays(gl.TRIANGLES,0,6);
  },dispose(){textures.forEach(t=>gl.deleteTexture(t));gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.width=canvas.height=1;}};
}

/** Source-preserving physical crop. No model output or per-card guessed registration. */
export function drawFilmCardTexture(ctx,image,geometry,width,height) {
  ctx.clearRect(0,0,width,height);ctx.save();ctx.beginPath();geometry.physicalQuad.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p.x*width,p.y*height));ctx.closePath();ctx.clip();
  ctx.drawImage(image,40,40,1270,1778,0,0,width,height);ctx.restore();
}
function line(ctx,a,b,color=GREEN,width=2){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
function text(ctx,value,x,y,size,color='#fff',align='left',weight=500){ctx.font=`${weight} ${size}px "Atlas Film","Atlas Sans",system-ui,sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(value,x,y);}
function fitted(ctx,value,x,y,size,width,color,align='left',weight=500){ctx.font=`${weight} ${size}px "Atlas Film","Atlas Sans",system-ui,sans-serif`;const w=ctx.measureText(value).width;text(ctx,value,x,y,Math.min(size,size*width/Math.max(1,w)),color,align,weight);}
function badge(ctx,value,x,y,size=24,color=GREEN){ctx.font=`600 ${size}px "Atlas Mono",monospace`;const w=ctx.measureText(value).width+20;ctx.fillStyle='#111914';ctx.fillRect(x-w/2,y-size,w,size+14);ctx.strokeStyle=color;ctx.lineWidth=1;ctx.strokeRect(x-w/2,y-size,w,size+14);ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(value,x,y+2);}
function poly(ctx,points,color,width=2){ctx.beginPath();points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p.x,p.y));ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}

export async function createApprovedFilmRenderer(canvas,scene,photos,{signal}={}) {
  const logo=await loadBrand();signal?.throwIfAborted();
  const stage=cardStage(canvas.width,canvas.height),assets={},ctx=canvas.getContext('2d');
  if(!ctx){stage.dispose();throw Error('FILM_GRAPHICS_UNAVAILABLE');}
  try {
    for(const side of['FRONT','BACK']) {
      signal?.throwIfAborted();const plane=makeCanvas(760,1064);drawFilmCardTexture(plane.getContext('2d'),photos[side],scene.sides[side].geometry,760,1064);
      const mask=new Uint8Array(1270*1778);
      for(const shape of scene.sides[side].shapes)for(const span of shape.spans??[])mask.fill(255,span.y*1270+span.x,span.y*1270+span.x+span.width);
      const fp=makeCanvas(360,504),source=fingerprintSource(scene.manifest.packet.report.findings,side);
      if(source.spans.length&&!source.unavailable){const field=await scheduleFingerprint(fingerprintFieldSteps(source.spans),{signal});const sampled=await scheduleFingerprint(fingerprintSampleSteps(field,360,504),{signal});const pixels=fp.getContext('2d').createImageData(360,504);paintFingerprintPixels(pixels.data,sampled,1);fp.getContext('2d').putImageData(pixels,0,0);}
      assets[side]={photo:stage.texture(plane),mask:stage.texture(mask,true,1270,1778),fingerprint:stage.texture(fp)};
      plane.width=plane.height=fp.width=fp.height=1;
    }
  }catch(error){stage.dispose();throw error;}
  function paint(time) {
    signal?.throwIfAborted();const s=sampleFilm(scene,time),W=canvas.width,H=canvas.height,k=W/1080;
    ctx.save();ctx.scale(k,k);const bg=ctx.createRadialGradient(700,950,40,520,960,1250);bg.addColorStop(0,'#25251c');bg.addColorStop(.55,'#101b1b');bg.addColorStop(1,'#060909');ctx.fillStyle=bg;ctx.fillRect(0,0,1080,1920);
    ctx.globalAlpha=.12;for(let x=0;x<1080;x+=90)line(ctx,{x,y:320},{x,y:1760},'#70988f',1);ctx.globalAlpha=1;
    stage.draw(s.side,s,assets[s.side]);ctx.drawImage(stage.canvas,0,0,1080,1920);
    if(Math.abs(Math.cos(s.yaw))>.2){ctx.save();ctx.globalAlpha=(.65+.2*Math.sin(s.t*Math.PI))*(1-.6*s.inspect);
      for(const shape of scene.sides[s.side].shapes){if(!shape.centroid)continue;const p=projectFilmPoint(shape.centroid,s.side,s,1080,1920);ctx.strokeStyle=RED;ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(p.x,p.y,11,0,Math.PI*2);ctx.stroke();
        if(!shape.spans)for(const region of shape.regions)poly(ctx,region.canonicalContour.map(q=>projectFilmPoint([q.x,q.y],s.side,s,1080,1920)),RED,2);
      }ctx.restore();}
    // Very narrow edge-on pose remains one continuous object, with a small material edge.
    if(Math.abs(Math.cos(s.yaw))<.055){const a=projectFilmPoint([.5,0],s.side,s,1080,1920),b=projectFilmPoint([.5,1],s.side,s,1080,1920);line(ctx,a,b,'#c7c2ab',2.2);}
    if(logo)ctx.drawImage(logo,66,62,100,90);text(ctx,'ATLAS',logo?185:66,122,52,GOLD,'left',700);text(ctx,'GRADING',logo?187:68,155,17,'#bdc4bd');text(ctx,'APPROVED GRADE',1014,88,17,'#bdc4bd','right');text(ctx,String(scene.grade),1014,163,82,GOLD,'right',600);
    fitted(ctx,scene.name.toUpperCase(),66,247,52,948,'#fff','left',650);fitted(ctx,scene.subtitle,68,289,24,940,'#b8c1ba');
    if(s.centerAmount>.001){ctx.globalAlpha=s.centerAmount;const side=scene.sides[s.side],p=uv=>projectFilmPoint(uv,s.side,s,1080,1920);
      poly(ctx,side.geometry.physicalQuad.map(q=>p([q.x,q.y])),GREEN,2);poly(ctx,side.geometry.printedQuad.map(q=>p([q.x,q.y])),GREEN,2);
      line(ctx,p([.5,0]),p([.5,1]),GREEN,1.5);line(ctx,p([0,.5]),p([1,.5]),GREEN,1.5);
      const q=side.geometry.printedQuad,m=q.map((v,i)=>[(v.x+q[(i+1)%4].x)/2,(v.y+q[(i+1)%4].y)/2]);
      const specs=[['T',side.borders.topMm,[m[0][0],0],m[0],[0,-28]],['B',side.borders.bottomMm,[m[2][0],1],m[2],[0,45]],['L',side.borders.leftMm,[0,m[3][1]],m[3],[-75,0]],['R',side.borders.rightMm,[1,m[1][1]],m[1],[75,0]]];
      for(const[id,value,a,b,offset]of specs){const pa=p(a),pb=p(b);line(ctx,pa,pb);badge(ctx,`${id} ${value.toFixed(2)} mm`,clamp((pa.x+pb.x)/2+offset[0],115,965),(pa.y+pb.y)/2+offset[1],22);}
      ctx.globalAlpha=1;
    }
    if(s.inspect>.001&&scene.macro){const m=scene.macro,op=s.inspect,x=150+(1-op)*120,y=530,w=690,h=780;
      ctx.save();ctx.globalAlpha=op;ctx.fillStyle='#080c0b';ctx.fillRect(x-12,y-55,w+24,h+132);const c=m.crop,scale=Math.min(w/c.width,h/c.height),iw=c.width*scale,ih=c.height*scale,ox=x+(w-iw)/2,oy=y+(h-ih)/2;
      ctx.drawImage(photos[m.finding.side],c.x,c.y,c.width,c.height,ox,oy,iw,ih);
      const p=(px,py)=>({x:ox+(40+px-c.x)*scale,y:oy+(40+py-c.y)*scale});
      ctx.save();ctx.beginPath();ctx.rect(ox,oy,iw,ih);ctx.clip();ctx.fillStyle='rgba(255,40,77,.32)';const shape=scene.sides[m.finding.side].shapes.find(v=>v.finding.id===m.finding.id);
      for(const span of shape.spans??[]){const a=p(span.x,span.y);ctx.fillRect(a.x,a.y,span.width*scale,scale);}
      poly(ctx,m.region.canonicalContour.map(v=>p(v.x*1269,v.y*1777)),GREEN,2);ctx.restore();
      text(ctx,'ORIGINAL PHOTO · SAVED TRACE',x,y-23,20,GOLD);const b=m.bounds,a=p(b.x,b.y),z=p(b.x+b.width,b.y+b.height);
      if(m.calibratedBounds){line(ctx,{x:a.x-20,y:a.y},{x:a.x-20,y:z.y});line(ctx,{x:a.x,y:z.y+20},{x:z.x,y:z.y+20});for(const yy of[a.y,z.y])line(ctx,{x:a.x-26,y:yy},{x:a.x-14,y:yy});for(const xx of[a.x,z.x])line(ctx,{x:xx,y:z.y+14},{x:xx,y:z.y+26});badge(ctx,`${m.region.measurement.heightMm.toFixed(2)} mm`,clamp(a.x-85,x+85,x+w-85),(a.y+z.y)/2,24);badge(ctx,`${m.region.measurement.widthMm.toFixed(2)} mm`,(a.x+z.x)/2,Math.min(y+h-18,z.y+61),24);}
      fitted(ctx,`${m.region.zone} · ${m.region.measurement.widthMm.toFixed(2)} × ${m.region.measurement.heightMm.toFixed(2)} mm`,x,y+h+42,25,w,'#fff');
      const anchor=projectFilmPoint([(b.x+b.width/2)/1270,(b.y+b.height/2)/1778],m.finding.side,s,1080,1920);line(ctx,anchor,{x:x+w+34,y:y+h/2},RED,2);line(ctx,{x:x+w+34,y:y+h/2},{x:x+w,y:y+h/2},RED,2);ctx.restore();
    }
    const caption=s.chapter==='CARD FINGERPRINT'?'A pattern from the saved defects.':s.chapter==='ORIGINAL EVIDENCE'?(scene.macro?'Measured on the original photograph.':'No included damage findings recorded.'):s.chapter==='RECORDED FINDINGS'?`${scene.manifest.packet.report.findings.length} recorded findings. Every trace retained.`:s.chapter==='CENTERING'?'The physical edge. The printed border.':scene.name;
    text(ctx,s.chapter,66,1570,23,GOLD);fitted(ctx,caption,66,1630,35,948,'#fff');
    if(s.end>.001){ctx.globalAlpha=s.end;text(ctx,String(scene.grade),1010,1460,178,GOLD,'right',650);ctx.globalAlpha=1;}
    const foot=scene.manifest.packet.mode==='LOCAL_FIXTURE'?'SYNTHETIC DEMONSTRATION':scene.manifest.packet.reportNumber;
    text(ctx,foot,66,1813,20,'#9daaa0');text(ctx,`APPROVED VERSION ${scene.manifest.packet.approvalVersion}`,1014,1813,19,'#9daaa0','right');text(ctx,'atlasgrading.com',66,1852,24,GOLD);
    if(s.fingerprint>.1)text(ctx,'Evidence artwork · not physical authentication',66,1710,20,'#b8c1ba');
    ctx.restore();
  }
  return {paint,dispose:()=>stage.dispose()};
}
