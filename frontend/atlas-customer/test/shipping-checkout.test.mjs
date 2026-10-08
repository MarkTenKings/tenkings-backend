import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require=createRequire(new URL('../package.json',import.meta.url)),babel=require('next/dist/compiled/babel/core'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const source=babel.transformSync(readFileSync(new URL('../components/commerce/ShippingCheckout.jsx',import.meta.url),'utf8'),{filename:'ShippingCheckout.jsx',presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}},'transform-runtime':{helpers:false}}]],babelrc:false,configFile:false}).code;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const nodes=(node,predicate)=>Array.isArray(node)?node.flatMap(item=>nodes(item,predicate)):node&&typeof node==='object'?[...(predicate(node)?[node]:[]),...nodes(node.props?.children,predicate)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
const id='11111111-1111-4111-8111-111111111111',attemptId='33333333-3333-4333-8333-333333333333';
const original={id,reference:'ATLAS-FIXTURE',receipt:{channel:'MAIL_IN',cards:[{cardId:'original-card',identity:{title:'Saved card'}}],subtotalCents:4000,taxCents:320,totalCents:4320,terms:{shippingPayment:'SEPARATE_PAYMENT'}},shippingPayment:{state:'UNQUOTED_UNPAID',activePayment:null,receipt:null}};
const base=`/commerce/orders/${id}/shipping`;
const option={packingPresetId:'one_card',shippingServiceCode:'usps_ground_advantage',carrierLabel:'USPS',serviceLabel:'Ground Advantage',label:'Measured package',inboundPackaging:'CUSTOMER_MEASURED'};
const ready={orderId:id,shippingOptions:[option],blockers:[],shippingPayment:original.shippingPayment};
const quote={id:'44444444-4444-4444-8444-444444444444',orderId:id,purpose:'SHIPPING',channel:'MAIL_IN',shippingCents:1200,taxCents:96,totalCents:1296,expiresAt:'2099-10-08T00:00:00Z',shipping:[{leg:'INBOUND',carrierName:'USPS',serviceName:'Ground Advantage',amountCents:600},{leg:'RETURN',carrierName:'USPS',serviceName:'Ground Advantage',amountCents:600}]};
function harness(request,{order=structuredClone(original),storage=new Map()}={}){
    let cursor=0,tree;const slots=[],effects=[],calls=[],updated=[],changed=(a,b)=>!a||a.length!==b.length||a.some((value,i)=>value!==b[i]);
    const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),
        useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
        useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
        useCallback(value,deps){const i=cursor++;if(changed(slots[i]?.deps,deps))slots[i]={value,deps};return slots[i].value;},
        useEffect(fn,deps){const i=cursor++;if(changed(slots[i]?.deps,deps)){const previous=slots[i];slots[i]={deps};effects.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}}};
    const exports={},PaymentFields=()=>null;
    vm.runInNewContext(source,{exports,Intl,sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},crypto:{randomUUID:()=> '22222222-2222-4222-8222-222222222222'},require:name=>name==='react'?react:name.endsWith('PaymentFields.jsx')?{__esModule:true,default:PaymentFields}:name.endsWith('.css')?{}:require(name)});
    const props={order,request:async(path,options)=>{calls.push({path,options});return request(path,options);},onOrder:value=>{updated.push(value);props.order=value;}};
    const render=()=>{cursor=0;tree=exports.default(props);while(effects.length)effects.shift()();return tree;};
    const button=label=>nodes(tree,n=>n.type==='button'&&text(n)===label)[0];
    return{render,button,calls,updated,exports,PaymentFields,storage,get tree(){return tree;},unmount(){for(const slot of slots)slot?.cleanup?.();}};
}
async function chooseAndMeasure(view){
    nodes(view.tree,n=>n.type==='select')[0].props.onChange({target:{value:'0'}});view.render();
    const inputs=nodes(view.tree,n=>n.type==='input');assert.equal(inputs.length,4);assert(inputs.every(n=>n.props.value===''));
    assert.equal(view.button('Get shipping total').props.disabled,true);
    for(const [index,value]of ['8','7','5','2'].entries()){nodes(view.tree,n=>n.type==='input')[index].props.onChange({target:{value}});view.render();}
    assert.equal(view.button('Get shipping total').props.disabled,false);
}
test('cold shipping stays on the paid order and performs only an availability read',async()=>{
    const before=JSON.stringify(original),view=harness(async()=>({...ready,shippingOptions:[],blockers:['SHIPPING_NOT_CONFIGURED','MEASURED_PACKAGING_NOT_CONFIGURED']}));
    view.render();await tick();view.render();assert.match(text(view.tree),/grading payment is confirmed/);assert.match(text(view.tree),/not been paid/);assert.match(text(view.tree),/Shipping quotes are not available yet/);
    assert.equal(nodes(view.tree,n=>n.type==='select').length,0);assert.equal(nodes(view.tree,n=>n.type==='button'&&/^Pay |Get shipping/.test(text(n))).length,0);
    assert.deepEqual(view.calls,[{path:base,options:undefined}]);assert.equal(JSON.stringify(original),before);assert.equal(view.updated.length,0);view.unmount();
});
test('exact shipping quote requires actual package measurements and never creates another grading payment',async()=>{
    const view=harness(async(path)=>path===base?ready:quote);view.render();await tick();view.render();await chooseAndMeasure(view);
    await view.button('Get shipping total').props.onClick();view.render();
    assert.deepEqual(JSON.parse(JSON.stringify(view.calls.at(-1))),{path:`${base}/quotes`,options:{body:{packingPresetId:'one_card',shippingServiceCode:'usps_ground_advantage',inboundPackage:{weight:{unit:'ounce',value:8},dimensions:{unit:'inch',length:7,width:5,height:2}}}}});
    assert.equal(view.button('Pay shipping $12.96').props.disabled,false);assert.equal(view.calls.length,2);assert.equal(view.updated.length,0);view.unmount();
});
test('lost shipping payment reply locks quote changes and retries exactly the original durable request',async()=>{
    let pays=0,release;const view=harness(async(path)=>path===base?ready:path.endsWith('/quotes')?quote:++pays===1?new Promise((_resolve,reject)=>{release=()=>reject(Object.assign(Error('lost'),{code:'UNCONFIRMED_REPLY'}));}):{attemptId,state:'UNKNOWN'});
    view.render();await tick();view.render();await chooseAndMeasure(view);await view.button('Get shipping total').props.onClick();view.render();
    const click=view.button('Pay shipping $12.96').props.onClick;const first=click();await click();assert.equal(pays,1);release();await first;view.render();
    assert(view.button('Check original shipping payment'));assert.equal(nodes(view.tree,n=>n.type==='select')[0].props.disabled,true);
    const prior=nodes(view.tree,n=>n.type==='select')[0].props.value;nodes(view.tree,n=>n.type==='select')[0].props.onChange({target:{value:''}});view.render();assert.equal(nodes(view.tree,n=>n.type==='select')[0].props.value,prior);
    assert.equal(view.button('Check shipping availability'),undefined);await view.button('Check original shipping payment').props.onClick();view.render();
    const paymentCalls=view.calls.filter(call=>call.path.endsWith('/payments'));assert.equal(paymentCalls.length,2);assert.deepEqual(paymentCalls[0],paymentCalls[1]);
    assert.deepEqual(JSON.parse(JSON.stringify(paymentCalls[0].options.body)),{quoteId:quote.id,requestId:'22222222-2222-4222-8222-222222222222'});assert.equal(view.storage.size,1);
    assert(view.button('Check shipping payment status'));assert.equal(view.button('Pay shipping $12.96'),undefined);assert.equal(view.updated.length,0);view.unmount();
});
for(const state of ['UNKNOWN','PROCESSING','AWAITING_PAYMENT'])test(`saved ${state} shipping attempt resumes despite closed shipping gates`,async()=>{
    const active={attemptId,state,quote,...(state==='AWAITING_PAYMENT'?{clientSecret:'owned-secret-fixture',publishableKey:'owned-publishable-fixture'}:{})};
    const view=harness(async()=>({...ready,blockers:['SHIPPING_NOT_CONFIGURED'],shippingOptions:[],activePayment:active}));view.render();await tick();view.render();
    assert(view.button('Check shipping payment status'));assert.equal(nodes(view.tree,n=>n.type===view.exports.ShippingAmounts)[0].props.quote,quote);assert.equal(view.button('Get shipping total'),undefined);assert.equal(nodes(view.tree,n=>n.type===view.PaymentFields).length,state==='AWAITING_PAYMENT'?1:0);assert.equal(view.calls.length,1);view.unmount();
});
test('successful shipping reconciliation updates the same order and retains its exact grading receipt',async()=>{
    const paidOrder={...original,shippingPayment:{state:'PAID',activePayment:null,receipt:quote}};
    const view=harness(async path=>path===base?{...ready,activePayment:{attemptId,state:'UNKNOWN'}}:{attemptId,state:'PAID',order:paidOrder});
    view.render();await tick();view.render();await view.button('Check shipping payment status').props.onClick();view.render();
    assert.equal(view.updated.length,1);assert.equal(view.updated[0].id,original.id);assert.equal(view.updated[0].receipt,original.receipt);assert.equal(view.calls.at(-1).path,`${base}/payments/${attemptId}/reconcile`);
    assert.equal(nodes(view.tree,n=>n.type===view.exports.ShippingAmounts)[0].props.quote,quote);assert.equal(nodes(view.tree,n=>n.type==='button').length,0);assert.match(text(view.tree),/original grading receipt above stays unchanged/);view.unmount();
});
test('server-confirmed canceled shipping allows a new quote without disturbing grading payment',async()=>{
    const view=harness(async()=>({...ready,activePayment:{attemptId,state:'CANCELED'}}));view.render();await tick();view.render();assert.match(text(view.tree),/grading payment remains confirmed/);
    await view.button('Review a new shipping total').props.onClick();view.render();assert(view.button('Get shipping total'));assert.equal(view.updated.length,0);view.unmount();
});
test('wrong-order availability or quote cannot expose a pay action',async()=>{
    const view=harness(async()=>({...ready,orderId:'other-order'}));view.render();await tick();view.render();assert.equal(nodes(view.tree,n=>n.type==='select').length,0);assert.match(text(view.tree),/could not be confirmed/);view.unmount();
    const second=harness(async(path)=>path===base?ready:{...quote,orderId:'other-order'});second.render();await tick();second.render();await chooseAndMeasure(second);await second.button('Get shipping total').props.onClick();second.render();assert.equal(second.button('Pay shipping $12.96'),undefined);second.unmount();
});
test('foreign paid order cannot replace the saved grading order',async()=>{
    const view=harness(async(path)=>path===base?{...ready,activePayment:{attemptId,state:'UNKNOWN'}}:{attemptId,state:'PAID',order:{...original,id:'another-order'}});
    view.render();await tick();view.render();await view.button('Check shipping payment status').props.onClick();view.render();assert.equal(view.updated.length,0);assert.match(text(view.tree),/could not be confirmed/);view.unmount();
});
test('shipping total displays actual carrier legs, shipping tax and a separate payment, never another grading amount',()=>{
    const exports={};vm.runInNewContext(source,{exports,Intl,require:name=>name==='react'?React:name.endsWith('PaymentFields.jsx')?{__esModule:true,default:()=>null}:name.endsWith('.css')?{}:require(name)});
    const html=renderToStaticMarkup(React.createElement(exports.ShippingAmounts,{quote,paid:true}));
    for(const content of ['Shipping payment confirmed','USPS','Ground Advantage','Your cards → ATLAS','ATLAS → your address','$12.00','$0.96','$12.96','will not be charged again'])assert.ok(html.includes(content),content);
    assert.doesNotMatch(html,/\$40\.00|Grading paid/);
});

test('shipping quote changes discard the previous price, and expired quotes refresh instead of starting payment',async()=>{
    let sequence=0;const view=harness(async path=>path===base?{...ready,shippingOptions:[{...option,inboundPackaging:'CONFIGURED'},{...option,packingPresetId:'ups_one',shippingServiceCode:'ups_ground',carrierLabel:'UPS',serviceLabel:'Ground',inboundPackaging:'CONFIGURED'}]}:{...quote,id:`quote-${++sequence}`,expiresAt:sequence===2?'2000-01-01T00:00:00Z':quote.expiresAt});
    view.render();await tick();view.render();nodes(view.tree,n=>n.type==='select')[0].props.onChange({target:{value:'0'}});view.render();await view.button('Get shipping total').props.onClick();view.render();assert(view.button('Pay shipping $12.96'));
    nodes(view.tree,n=>n.type==='select')[0].props.onChange({target:{value:'1'}});view.render();assert.equal(view.button('Pay shipping $12.96'),undefined);await view.button('Get shipping total').props.onClick();view.render();assert(view.button('Refresh shipping total'));
    await view.button('Refresh shipping total').props.onClick();view.render();assert.equal(view.calls.filter(call=>call.path.endsWith('/quotes')).length,3);assert.equal(view.calls.filter(call=>call.path.endsWith('/payments')).length,0);assert.equal(view.calls.at(-1).options.body.shippingServiceCode,'ups_ground');view.unmount();
});
test('unavailable durable request storage prevents any separate shipping charge',async()=>{
    const storage={get(){return null;},set(){throw Error('storage unavailable');}};const view=harness(async path=>path===base?ready:quote,{storage});view.render();await tick();view.render();await chooseAndMeasure(view);await view.button('Get shipping total').props.onClick();view.render();await view.button('Pay shipping $12.96').props.onClick();view.render();assert.equal(view.calls.filter(call=>call.path.endsWith('/payments')).length,0);assert.match(text(view.tree),/could not be confirmed/);view.unmount();
});

test('checking fresh shipping availability invalidates the displayed quote and prior service selection',async()=>{
    const view=harness(async path=>path===base?ready:quote);view.render();await tick();view.render();await chooseAndMeasure(view);await view.button('Get shipping total').props.onClick();view.render();assert(view.button('Pay shipping $12.96'));
    await view.button('Check shipping availability').props.onClick();view.render();assert.equal(view.button('Pay shipping $12.96'),undefined);assert.equal(nodes(view.tree,n=>n.type==='select')[0].props.value,'');assert.equal(view.button('Get shipping total').props.disabled,true);view.unmount();
});
