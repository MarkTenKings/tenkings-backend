import {createGeometryWorkspace,applyGeometryEdit,applyPreparedFrame,geometryBase,preparationBase,preparedPointToOriginal} from '../src/geometry-actions.mjs';
export const hash=c=>c.repeat(64);
export const printed=[{x:.04,y:.06},{x:.94,y:.06},{x:.94,y:.96},{x:.04,y:.96}];
export function focusedFixture({perspective=false}={}) {
  let workspace=createGeometryWorkspace({cardId:'focused-synthetic',profile:'SPORTS',sides:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{
    image:{version:1,originalSha256:hash('a'),frameId:`${side}-source`,frameSha256:hash(side==='FRONT'?'b':'c'),width:1600,height:2400,coordinateSpace:'ORIENTED_DECODED'},matColor:'BLACK',cornerShape:'SQUARE'}]))});
  const m=perspective?[.9,.05,150,.03,1.1,180,.00002,.00001,1]:[1,0,180,0,1,250,0,0,1];
  const [a,b,c,d,e,f,g,h,i]=m,det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  const forward=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d].map(n=>n/det);
  const physical=[[0,0],[1269,0],[1269,1777],[0,1777]].map(([x,y])=>({x:(a*x+b*y+c)/(g*x+h*y+i)/1600,y:(d*x+e*y+f)/(g*x+h*y+i)/2400}));
  for(const side of ['FRONT','BACK']){
    workspace=applyGeometryEdit(workspace,{side,kind:'PHYSICAL',base:geometryBase(workspace,side,'PHYSICAL'),quad:physical,actor:'HUMAN'}).state;
    workspace=applyPreparedFrame(workspace,{side,base:preparationBase(workspace,side),frame:{id:`${side}-prepared`,version:1,
      rectified:{sha256:hash(side==='FRONT'?'d':'e'),width:1270,height:1778},
      inspection:{sha256:hash(side==='FRONT'?'f':'1'),width:1350,height:1858,cardBounds:{x:40,y:40,width:1270,height:1778}},sourceToRectified:forward}}).state;
    workspace=applyGeometryEdit(workspace,{side,kind:'PRINTED',base:geometryBase(workspace,side,'PRINTED'),quad:printed,actor:'HUMAN'}).state;
  }
  return {workspace,images:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{original:{url:`blob:${side}`,sha256:workspace.sides[side].image.frameSha256}}])),
    printedOriginal:printed.map(p=>preparedPointToOriginal(workspace,'FRONT',p))};
}
