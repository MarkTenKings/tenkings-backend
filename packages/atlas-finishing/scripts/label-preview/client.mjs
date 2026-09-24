import { renderManualLabel } from '../../src/label.mjs';
import { DEFAULT_LABEL_DESIGN, validateLabelDesign } from '../../src/label-design.mjs';
const defaults = structuredClone(DEFAULT_LABEL_DESIGN), fields = ['nameSize','variantSize','nameTracking','nameFont'];
const sample = __ATLAS_LABEL_SAMPLE__;
const context = document.createElement('canvas').getContext('2d'); let current = null;
function measureText(value,size,weight,fontFamily) {
 const font = String(fontFamily ?? '').includes('Times') ? '"Times New Roman",serif' : 'Arial,Helvetica,sans-serif';
 context.font = `${weight} ${size}px ${font}`; return context.measureText(value).width;
}
function render() {
 const template = {...defaults}, name = document.getElementById('name').value.trim(), parallel = document.getElementById('parallel').value.trim();
 for (const field of fields) { const input=document.getElementById(field);template[field]=field==='nameFont'?input.value:Number(input.value);const output=document.getElementById(field+'Value');if(output)output.textContent=field==='nameTracking'?`${Number(input.value).toFixed(2)} pt`:`${Number(input.value).toFixed(1)} pt`; }
 document.getElementById('export-status').textContent='';
 try {
  validateLabelDesign(template);const label={...sample,identity:{...sample.identity,playerName:name,parallel:parallel||null},design:template};
  const rendered=renderManualLabel({label,measureText,palette:'NOIR_GOLD'});
  document.getElementById('front').innerHTML=rendered.front;document.getElementById('reverse').innerHTML=rendered.reverse;document.getElementById('actual').innerHTML=rendered.front+rendered.reverse;
  document.getElementById('preview-error').textContent='';document.getElementById('download').disabled=false;
  current={version:'atlas-label-design-draft-v1',template,sample:{cardProfile:'SPORTS',name,parallel:parallel||null},productionActive:false};
  window.labelDesignPreview={draft:current,ready:true};
 } catch(error) {
  document.getElementById('preview-error').textContent=name ? 'This name or setting needs more room. Adjust the typography or use Reset.' : 'Add a player or character name to preview the label.';
  document.getElementById('front').replaceChildren();document.getElementById('actual').replaceChildren();document.getElementById('download').disabled=true;current=null;window.labelDesignPreview={ready:false,error:error.message};
 }
}
function reset(){document.getElementById('name').value=sample.identity.playerName;document.getElementById('parallel').value=sample.identity.parallel;for(const field of fields)document.getElementById(field).value=defaults[field];render()}
for (const id of ['name','parallel',...fields]) document.getElementById(id).addEventListener('input',render);
document.getElementById('reset').addEventListener('click',reset);
document.getElementById('download').addEventListener('click',()=>{if(!current)return;const blob=new Blob([JSON.stringify(current,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='atlas-label-design-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);document.getElementById('export-status').textContent='Design draft downloaded. Production settings are unchanged.'});
reset();
