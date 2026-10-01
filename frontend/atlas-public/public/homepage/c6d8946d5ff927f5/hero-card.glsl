// ATLAS continuous card stage. Native Higgsedit GLSL; the same shader is portable to WebGL2.
// Geometry is an illustrative card plane with a thin edge, not measured damage depth.
float sat(float x){return clamp(x,0.,1.);}
float ease(float a,float b,float t){float x=sat((t-a)/(b-a));return x*x*x*(x*(x*6.-15.)+10.);}
mat3 rx(float a){float c=cos(a),s=sin(a);return mat3(1,0,0,0,c,s,0,-s,c);}
mat3 ry(float a){float c=cos(a),s=sin(a);return mat3(c,0,-s,0,1,0,s,0,c);}
mat3 rz(float a){float c=cos(a),s=sin(a);return mat3(c,s,0,-s,c,0,0,0,1);}
float lineSeg(vec2 p,vec2 a,vec2 b){vec2 d=b-a;return length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.,1.));}
vec2 sourceUV(vec2 pngUV,bool front){
  // Matrices are replaced with measured source-pixel -> accepted-PNG inverse registration.
  vec3 p=vec3(pngUV,1.);
  mat3 h=front ? FRONT_INVERSE : BACK_INVERSE;
  vec3 q=h*p;
  return (q.xy/q.z+vec2(.5))/vec2(1270.,1778.);
}
// Exact saved mask at 1x. Sampling at texel centers prevents interpolation from
// inventing fractional mask occupancy; readability comes from separate reticles.
float evidence(vec2 uv,bool front,float t){
  if(any(lessThan(uv,vec2(0.)))||any(greaterThanEqual(uv,vec2(1.))))return 0.;
  vec2 cell=(floor(uv*vec2(1270.,1778.))+.5)/vec2(1270.,1778.);
  return front?texture(u_maskfront,cell).r:texture(u_maskback,cell).r;
}
vec2 projectCardPoint(vec2 cardUV,bool front,mat3 R,vec3 C,float size){
  float side=front?1.:-1.;
  vec3 local=vec3((cardUV.x-.5)*2.*side,(.5-cardUV.y)*2.8,.007*side);
  vec3 world=C+size*(R*local);
  float depth=4.5-world.z;
  return vec2(.5+world.x/(depth*2.*(u_view.x/u_view.y)*.62),.5-world.y/(depth*2.*.62))*u_view;
}
float savedReticle(vec2 screen,vec2 cardUV,bool front,mat3 R,vec3 C,float size,float t){
  float side=front?1.:-1.;
  vec3 local=vec3((cardUV.x-.5)*2.*side,(.5-cardUV.y)*2.8,.007*side);
  vec3 world=C+size*(R*local);
  float facing=dot(R*vec3(0.,0.,side),normalize(vec3(0.,0.,4.5)-world));
  float visibility=smoothstep(.10,.28,facing);
  vec2 anchor=projectCardPoint(cardUV,front,R,C,size);
  float radius=11.5+1.0*sin(t*3.14159265);
  float ring=1.-smoothstep(2.0,3.2,abs(length(screen-anchor)-radius));
  return ring*visibility;
}
vec3 withReticles(vec3 base,vec2 uv,mat3 R,vec3 C,float size,float t,float inspect,float fingerprint,float end){
  vec2 screen=uv*u_view;
  float marks=0.;
  // Interactive DOM reticles project the saved centroids.
  float opacity=(.78+.16*sin(t*3.14159265))*(1.-fingerprint)*(1.-.70*inspect)*(1.-.7*end);
  // Composite outside the card ray/box branches, so edge markers remain whole.
  return mix(base,vec3(1.,.070,.219),marks*opacity);
}
vec4 pixel(vec2 uv){
  float t=u_time;
  float yaw=u_yaw,tilt=u_tilt,roll=u_roll;
  float turn=0.,end=0.,inspect=0.,focus=0.,fingerprint=u_fingerprint;
  mat3 R=rz(roll)*ry(yaw)*rx(tilt);
  vec3 C=vec3((u_center.x-.5)*2.*(u_view.x/u_view.y)*.62*4.5,(.5-u_center.y)*2.*.62*4.5,0.);
  float size=u_size;
  vec3 ro=vec3(0.,0.,4.5),rd=normalize(vec3((uv.x-.5)*2.*(u_view.x/u_view.y)*.62,(.5-uv.y)*2.*.62,-1.));
  vec3 o=transpose(R)*(ro-C)/size,d=transpose(R)*rd;
  vec3 bg=vec3(.020,.026,.026);
  vec2 a=(uv-vec2(.56,.58))*vec2(1.1,.7);
  bg+=vec3(.050,.035,.018)*exp(-dot(a,a)*11.);
  bg+=vec3(.005,.017,.018)*exp(-length(uv-vec2(.0,.43))*4.);
  float vignette=1.-.23*smoothstep(.30,.83,length((uv-.5)*vec2(.65,1.)));
  bg*=vignette;
  // Subtle soft field below the floating specimen, continuous across the whole film.
  vec2 foot=(uv-vec2(.5-.14*end,.82))*vec2(1.,3.8);
  bg*=1.-.37*exp(-dot(foot,foot)*55.);
  vec3 bounds=vec3(1.,1.4,.007);
  vec3 inv=1./d;
  vec3 a0=(-bounds-o)*inv,a1=(bounds-o)*inv;
  vec3 nearV=min(a0,a1),farV=max(a0,a1);
  float nearT=max(max(nearV.x,nearV.y),nearV.z);
  float farT=min(min(farV.x,farV.y),farV.z);
  if(nearT>farT||farT<0.)return vec4(0.);
  vec3 p=o+d*nearT;
  vec3 nd=abs(p)/bounds;
  bool face=nd.z>=max(nd.x,nd.y);
  if(!face){
    vec3 n=nd.x>nd.y?vec3(sign(p.x),0,0):vec3(0,sign(p.y),0);
    vec3 nw=R*n;
    float light=.38+.42*max(0.,dot(nw,normalize(vec3(-1.4,1.8,2.))));
    vec3 edge=mix(vec3(.25,.23,.19),vec3(.85,.80,.66),light);
    float fine=.95+.05*sin(p.y*1600.);
    return vec4(withReticles(edge*fine*(1.-inspect*.7),uv,R,C,size,t,inspect,fingerprint,end),1.);
  }
  bool front=p.z>0.;
  vec2 cardUV=vec2(front?p.x:-p.x,p.y)/vec2(2.,-2.8)+.5;
  vec4 crop=front ? FRONT_CROP : BACK_CROP;
  vec2 texUV=mix(crop.xy,crop.zw,cardUV);
  vec4 texel=front?texture(u_front,texUV):texture(u_back,texUV);
  vec2 src=sourceUV(cardUV,front);
  float mask=evidence(src,front,t);
  vec2 texelStep=vec2(1./1270.,1./1778.);
  float nx=evidence(src+vec2(texelStep.x,0),front,t);
  float ny=evidence(src+vec2(0,texelStep.y),front,t);
  float edgeMask=mask*max(abs(nx-mask),abs(ny-mask));
  float breathe=.66+.34*sin(t*3.14159265);
  vec3 col=texel.rgb;
  // Cosmetic illumination remains subtle; authoritative macro uses untouched photo values.
  vec3 nw=R*vec3(0,0,front?1.:-1.);
  float rim=pow(1.-abs(dot(nw,-rd)),3.);
  col*=.94+.06*max(0.,nw.z);
  float highlight=exp(-pow((cardUV.x+cardUV.y*.23-mix(-.15,1.2,ease(0.,3.,t)))*13.,2.));
  col+=vec3(.08,.085,.085)*highlight*(1.-turn)*(1.-fingerprint);
  float interiorGrid=max(1.-smoothstep(.06,.10,abs(fract(src.x*1270./12.)-.5)),1.-smoothstep(.06,.10,abs(fract(src.y*1778./12.)-.5)));
  vec3 defect=mix(vec3(1.,.070,.219),vec3(.475,1.,.23),interiorGrid*.85);
  // Full centering instruments are projected in screen space by the controller.
  if(fingerprint>0.){
    vec2 f= fwidth(src)*.32;
    vec4 fpt=.25*((front?texture(u_fpfront,src+f):texture(u_fpback,src+f))+(front?texture(u_fpfront,src-f):texture(u_fpback,src-f))+(front?texture(u_fpfront,src+vec2(f.x,-f.y)):texture(u_fpback,src+vec2(f.x,-f.y)))+(front?texture(u_fpfront,src+vec2(-f.x,f.y)):texture(u_fpback,src+vec2(-f.x,f.y))));
    // Transparent gold ridges overlay the same photo; the card never disappears.
    col*=1.-fingerprint*.14;
    col=mix(col,min(fpt.rgb*1.18,vec3(1.)),fpt.a*fingerprint*.88);
  }
  // Saved defects remain legible above the fingerprint as well as the photo.
  col=mix(col,defect,mask*(.52+.18*breathe));
  col=mix(col,vec3(1.,.07,.22),edgeMask*.95);
  col+=vec3(.12,.10,.06)*rim;
  col=mix(col,bg,inspect*.77);
  return vec4(col,texel.a);
}
