import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../package.json', import.meta.url)), babel = require('next/dist/compiled/babel/core'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const compile = path => babel.transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { filename: path, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } }, 'transform-runtime': { helpers: false } }]], babelrc: false, configFile: false }).code;
const receipt = {};
vm.runInNewContext(compile('../components/commerce/OrderReceipt.jsx'), { exports: receipt, Intl, require: name => name === 'react' ? React : name.endsWith('.css') ? {} : name.endsWith('/client.mjs') ? {} : name.endsWith('CustomerHandoff.jsx') ? {__esModule:true,default:()=>null} : require(name) });
const order = { id: 'saved-order', reference: 'ATLAS-SAVED', receipt: { channel: 'KIOSK', subtotalCents: 5000, shippingCents: 0, taxCents: 450, totalCents: 5450,
    cards: [{ cardId: 'one', unitCents: 5000 }], terms: { days: 7, clockStart: 'ATLAS_COLLECTION' }, location: { name: 'Original kiosk', address: { line1: '1 Saved Street', city: 'Testville' },
        schedule: { timeZone: 'America/Los_Angeles', nextCollectionAt: '2026-09-30T17:00:00Z', projectedReturnAt: '2026-10-07T17:00:00Z', cutoffAt: '2026-09-30T16:00:00Z' } } },
    effects: [{ id: 'email', kind: 'EMAIL_RECEIPT', state: 'SUCCEEDED', deliveryStatus: 'ACCEPTED' }, { id: 'sms', kind: 'SMS_RECEIPT', state: 'SUCCEEDED', deliveryStatus: 'QUEUED' }, { id: 'label', kind: 'PACKAGE_LABEL', state: 'SUCCEEDED', artifactState: 'GENERATED' }] };
test('paid kiosk receipt retains exact saved location, schedule, terms, amounts and honest delivery/print states', () => {
    const html = renderToStaticMarkup(React.createElement(receipt.default, { initialOrder: order }));
    for (const content of ['Original kiosk', '1 Saved Street', 'Collection shown at checkout', 'Sep 30', 'Return projected at checkout', 'Oct 7', 'Drop-off cutoff', 'PDT', 'One week from actual ATLAS collection', '$50.00', '$4.50', '$54.50', 'Included', 'Accepted for delivery', 'Queued for delivery', 'Download label', 'does not confirm it has been printed']) assert.ok(html.includes(content), content);
    assert.doesNotMatch(html, />Sent<|>Delivered<|Prepare your shipment/);
});
test('mail paid receipt uses its retained clock and shipping-leg terms', () => {
    const html = renderToStaticMarkup(React.createElement(receipt.default, { initialOrder: { ...order, receipt: { ...order.receipt, channel: 'MAIL_IN', location: null, terms: { days: 14, clockStart: 'CARRIER_ACCEPTANCE', mailChargedLegs: 'BOTH_LEGS' }, subtotalCents: 4000, shippingCents: 1350, taxCents: 320, totalCents: 5670 } } }));
    for (const content of ['Two weeks from carrier acceptance', 'trip to ATLAS and the return trip', '$40.00', '$13.50', '$3.20', '$56.70', 'Prepare your shipment']) assert.ok(html.includes(content), content);
    assert.doesNotMatch(html, /Original kiosk|dropbox package|Included/);
    const inbound = renderToStaticMarkup(React.createElement(receipt.ServiceSummary, { snapshot: { channel: 'MAIL_IN', terms: { days: 14, clockStart: 'ATLAS_RECEIPT', mailChargedLegs: 'INBOUND_ONLY' } } }));
    assert.match(inbound, /physical receipt at ATLAS/); assert.match(inbound, /Return shipping is not included in this payment/);
});
test('provider acceptance and unknown delivery never assert sent or delivered', () => {
    for (const [deliveryStatus, expected] of [['ACCEPTED', 'Accepted for delivery'], ['QUEUED', 'Queued for delivery'], ['SENT', 'Sent'], ['DELIVERED', 'Delivered'], ['UNDELIVERED', 'Not delivered'], [undefined, 'Delivery not confirmed']]) assert.equal(receipt.deliveryLabel({ state: 'SUCCEEDED', deliveryStatus }), expected);
    assert.equal(receipt.deliveryLabel({ state: 'UNKNOWN', deliveryStatus: 'DELIVERED' }), 'Checking status');
    assert.equal(receipt.deliveryLabel({ state: 'FAILED' }), 'Needs attention');
});
test('mail receipt offers only the label to ATLAS, with the return label clearly reserved for staff', () => {
    const mail = { ...order, receipt: { ...order.receipt, channel: 'MAIL_IN', location: null }, effects: [
        { id: `${order.id}:fedex:INBOUND:v1`, kind: 'FEDEX_LABEL', state: 'SUCCEEDED' },
        { id: `${order.id}:fedex:RETURN:v1`, kind: 'FEDEX_LABEL', state: 'SUCCEEDED' },
        { id: `another-order:fedex:INBOUND:v1`, kind: 'FEDEX_LABEL', state: 'SUCCEEDED' },
    ] };
    const retained = JSON.stringify(mail), html = renderToStaticMarkup(React.createElement(receipt.default, { initialOrder: mail }));
    assert.match(html, /Ship your cards to ATLAS/); assert.match(html, /Return shipping from ATLAS/);
    assert.equal((html.match(/Download label to ATLAS/g) ?? []).length, 1);
    assert.match(html, /ATLAS uses this label after grading/); assert.match(html, /Contact support for this label/);
    assert.doesNotMatch(html, />Sent<|>Delivered<|Download return/); assert.equal(JSON.stringify(mail), retained);
    assert.equal(receipt.shippingLabelLeg(mail.effects[0], order.id), 'INBOUND');
    assert.equal(receipt.shippingLabelLeg(mail.effects[1], order.id), 'RETURN');
    assert.equal(receipt.shippingLabelLeg(mail.effects[2], order.id), null);
    assert.equal(receipt.shippingLabelLeg({ id: `${order.id}:fedex:INBOUND:v1:extra`, kind: 'FEDEX_LABEL' }, order.id), null);
});
test('resumed paid checkout renders receipt from the original paid order even when current view differs', async () => {
    let cursor = 0, tree; const slots = [], effects = [];
    const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => value !== b[i]);
    const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = initial; return [slots[id], value => { slots[id] = typeof value === 'function' ? value(slots[id]) : value; }]; },
        useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
        useCallback(value, deps) { const id = cursor++; if (changed(slots[id]?.deps, deps)) slots[id] = { value, deps }; return slots[id].value; },
        useEffect(fn, deps) { const id = cursor++; if (changed(slots[id]?.deps, deps)) { slots[id] = { deps }; effects.push(fn); } } };
    const exports = {}, notifications = [];
    vm.runInNewContext(compile('../components/commerce/CommerceCheckout.jsx'), { exports, Intl, require: name => name === 'react' ? react : name.endsWith('OrderReceipt.jsx') ? { ...receipt, __esModule: true } : name.endsWith('.css') ? {} : require(name) });
    const props = { draft: { id: 'draft', channel: 'MAIL_IN' }, request: async () => ({ channel: 'MAIL_IN', location: { name: 'Changed location' }, activePayment: { state: 'PAID', order } }), onPaid: value => notifications.push(value) };
    const render = () => { cursor = 0; tree = exports.default(props); while (effects.length) effects.shift()(); };
    render(); await new Promise(resolve => setImmediate(resolve)); render();
    assert.equal(tree.type, receipt.default); assert.equal(tree.props.initialOrder, order); assert.equal(notifications.length, 1);
    render(); assert.equal(notifications.length, 1);
});

test('cold commerce offers a saved-draft destination without quoting, collecting payment or inventing order status', () => {
    const exports = {};
    vm.runInNewContext(compile('../components/commerce/CommerceCheckout.jsx'), { exports, Intl, require: name => name === 'react' ? React : name.endsWith('OrderReceipt.jsx') ? { ...receipt, __esModule: true } : name.endsWith('.css') ? {} : require(name) });
    const html = renderToStaticMarkup(React.createElement(exports.SavedDraftConfirmation, { draft: { cards: [{id:'saved-card',identity:{title:'Saved card identity'}}] } }));
    assert.match(html, /YOUR DRAFT IS SAVED/); assert.match(html, /Checkout is not open yet/); assert.match(html, /Saved card identity/); assert.match(html, /href="\/account"/);
    assert.match(html, /Check checkout availability/); assert.match(html, /don’t need to upload or review them again/);
    assert.doesNotMatch(html, /View saved cards|Continue to checkout|✓/);
    assert.match(html, /does not take a payment or confirm an order/); assert.doesNotMatch(html, /Get exact total|Pay securely|have not been charged|Order confirmed/);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = (node, predicate) => Array.isArray(node) ? node.flatMap(value => nodes(value, predicate)) : node && typeof node === 'object'
    ? [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)] : [];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
function checkoutHarness(request) {
    let cursor=0,tree; const slots=[],effects=[],calls=[],notifications=[];
    const changed=(a,b)=>!a||a.length!==b.length||a.some((value,i)=>value!==b[i]);
    const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),
        useState(initial){const id=cursor++;if(!(id in slots))slots[id]=initial;return[slots[id],value=>{slots[id]=typeof value==='function'?value(slots[id]):value;}];},
        useRef(initial){const id=cursor++;if(!(id in slots))slots[id]={current:initial};return slots[id];},
        useCallback(value,deps){const id=cursor++;if(changed(slots[id]?.deps,deps))slots[id]={value,deps};return slots[id].value;},
        useEffect(fn,deps){const id=cursor++;if(changed(slots[id]?.deps,deps)){const old=slots[id];slots[id]={deps};effects.push(()=>{old?.cleanup?.();slots[id].cleanup=fn();});}}};
    const exports={},storage=new Map();
    vm.runInNewContext(compile('../components/commerce/CommerceCheckout.jsx'),{exports,Intl,crypto:{randomUUID:()=> '22222222-2222-4222-8222-222222222222'},sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},require:name=>name==='react'?react:name.endsWith('OrderReceipt.jsx')?{...receipt,__esModule:true}:name.endsWith('.css')?{}:require(name)});
    const props={draft:{id:'saved-draft',intakeMethod:'MAIL_IN',cards:[{id:'card',identity:{title:'Saved Pikachu'}}]},request:async(path,options)=>{calls.push({path,options});return request(path,options);},onPaid:value=>notifications.push(value),onBack:()=>{throw Error('Checkout must not send this saved draft back through review.');}};
    const render=()=>{cursor=0;tree=exports.default(props);while(effects.length)effects.shift()();return tree;};
    return {exports,render,calls,notifications,get tree(){return tree;},unmount(){for(const slot of slots)slot?.cleanup?.();}};
}

test('saved checkout checks the same draft in place and advances when availability opens, without quoting or charging',async()=>{
    let phase='cold';
    const view=checkoutHarness(async()=>phase==='cold'?{blockers:['PAYMENT_NOT_CONFIGURED','TAX_NOT_CONFIGURED']}:{revision:4,channel:'MAIL_IN',blockers:[],shippingOptions:[{packingPresetId:'measured',shippingServiceCode:'FEDEX_GROUND',label:'Measured package'}]});
    view.render();await tick();view.render();assert.equal(view.tree.type,view.exports.SavedDraftConfirmation);
    const pending=view.tree.props.onCheckAvailability();view.render();assert.equal(view.tree.props.checking,true);await pending;view.render();
    assert.equal(view.tree.type,view.exports.SavedDraftConfirmation);assert.equal(view.tree.props.checking,false);
    phase='ready';await view.tree.props.onCheckAvailability();view.render();assert.equal(view.tree.type,'section');
    assert.equal(view.tree.props['aria-label'],'Review and checkout');assert.equal(nodes(view.tree,n=>n.type==='select').length,1);
    assert.equal(nodes(view.tree,n=>n.type==='button'&&text(n)==='Get exact total').length,1);
    assert.equal(view.calls.length,3);assert(view.calls.every(call=>call.path==='/api/customer/commerce/checkout?draftId=saved-draft'&&call.options.method==='GET'&&call.options.body===undefined));
    assert.equal(view.notifications.length,0);view.unmount();
});

test('unavailable checkout handles an explicit failed retry without losing its saved cards or inventing readiness',async()=>{
    let phase='cold';const view=checkoutHarness(async()=>{throw Object.assign(Error('fixture'),{code:phase==='cold'?'COMMERCE_NOT_CONFIGURED':'UNCONFIRMED_REPLY'});});
    view.render();await tick();view.render();assert.equal(view.tree.type,view.exports.SavedDraftConfirmation);
    phase='offline';await view.tree.props.onCheckAvailability();view.render();assert.equal(view.tree.type,view.exports.SavedDraftConfirmation);
    assert.equal(view.tree.props.draft.cards[0].identity.title,'Saved Pikachu');assert.match(view.tree.props.error,/could not finish/);assert.equal(view.tree.props.checking,false);
    assert.equal(view.calls.length,2);assert.equal(view.notifications.length,0);view.unmount();
});

for(const state of ['UNKNOWN','PAID'])test(`availability retry recovers the original ${state} payment before closed-checkout messaging`,async()=>{
    let phase='cold';const view=checkoutHarness(async()=>({blockers:['PAYMENT_NOT_CONFIGURED'],...(phase==='recover'?{activePayment:{attemptId:'original-attempt',state,...(state==='PAID'?{order}:{})}}:{})}));
    view.render();await tick();view.render();assert.equal(view.tree.type,view.exports.SavedDraftConfirmation);
    phase='recover';await view.tree.props.onCheckAvailability();view.render();assert.notEqual(view.tree.type,view.exports.SavedDraftConfirmation);
    if(state==='PAID'){assert.equal(view.tree.type,receipt.default);assert.equal(view.tree.props.initialOrder,order);assert.deepEqual(view.notifications,[order]);}
    else {assert.equal(nodes(view.tree,n=>n.type==='button'&&text(n)==='Check payment status').length,1);assert.equal(nodes(view.tree,n=>n.type==='button'&&/^Pay |^Get exact total/.test(text(n))).length,0);assert.equal(view.notifications.length,0);}
    assert(view.calls.every(call=>call.options.method==='GET'&&call.options.body===undefined));view.unmount();
});

test('superseded availability replies cannot replace the most recent checkout result',async()=>{
    let resolveOld,phase='cold';const view=checkoutHarness(async()=>phase==='cold'?{blockers:['PAYMENT_NOT_CONFIGURED']}:phase==='slow'?new Promise(resolve=>{resolveOld=resolve;}):{blockers:[],channel:'KIOSK'});
    view.render();await tick();view.render();phase='slow';const previous=view.tree.props.onCheckAvailability();
    phase='ready';await view.tree.props.onCheckAvailability();view.render();assert.equal(view.tree.type,'section');
    resolveOld({blockers:['PAYMENT_NOT_CONFIGURED']});await previous;view.render();assert.equal(view.tree.type,'section');view.unmount();
});

const serviceOptions = ['USPS','UPS','FedEx'].map((carrier,index)=>({packingPresetId:`measured-${index}`,shippingServiceCode:`service_${index}`,carrierLabel:carrier,serviceLabel:`${carrier} ground service`,label:'One-card measured package'}));
const quoted = (id,carrier='UPS') => ({id,channel:'MAIL_IN',expiresAt:'2050-01-01T00:00:00Z',cards:[{cardId:'card',unitCents:4000}],subtotalCents:4000,shippingCents:2350,taxCents:320,totalCents:6670,shipping:[{leg:'INBOUND',carrierName:carrier,serviceName:'Ground',amountCents:1100},{leg:'RETURN',carrierName:carrier,serviceName:'Ground',amountCents:1250}]});
const click = async (view,label) => { const button=nodes(view.tree,n=>n.type==='button'&&text(n)===label)[0]; assert(button,label);assert.equal(!!button.props.disabled,false,label);await button.props.onClick();view.render(); };
const choose = (view,index) => { const selector=nodes(view.tree,n=>n.type==='select')[0];assert(selector);assert.equal(!!selector.props.disabled,false);selector.props.onChange({target:{value:String(index)}});view.render(); };

test('carrier changes discard the old quote and bind the next payment to the fresh exact selection',async()=>{
    let serial=0;
    const view=checkoutHarness(async(path,options)=>path.includes('/checkout?')?{revision:4,channel:'MAIL_IN',blockers:[],shippingOptions:serviceOptions}:path.endsWith('/quotes')?quoted(`quote-${++serial}`):{attemptId:'original',state:'UNKNOWN'});
    view.render();await tick();view.render();
    const selector=nodes(view.tree,n=>n.type==='select')[0];for(const carrier of ['USPS','UPS','FedEx'])assert.match(text(selector),new RegExp(carrier));
    choose(view,0);await click(view,'Get exact total');
    assert.equal(nodes(view.tree,n=>n.type===receipt.OrderAmounts)[0].props.snapshot.id,'quote-1');
    choose(view,1);assert.equal(nodes(view.tree,n=>n.type===receipt.OrderAmounts).length,0);assert.equal(nodes(view.tree,n=>n.type==='button'&&text(n).startsWith('Pay $')).length,0);
    await click(view,'Get exact total');await click(view,'Pay $66.70');
    const quoteCalls=view.calls.filter(call=>call.path.endsWith('/quotes'));
    assert.deepEqual(JSON.parse(JSON.stringify(quoteCalls.map(call=>call.options.body))),[{draftId:'saved-draft',expectedRevision:4,packingPresetId:'measured-0',shippingServiceCode:'service_0'},{draftId:'saved-draft',expectedRevision:4,packingPresetId:'measured-1',shippingServiceCode:'service_1'}]);
    assert.equal(view.calls.find(call=>call.path.endsWith('/payments')).options.body.quoteId,'quote-2');
    assert.equal(nodes(view.tree,n=>n.type==='select').length,0);assert.equal(nodes(view.tree,n=>n.type==='button'&&text(n)==='Check payment status').length,1);view.unmount();
});

test('lost payment reply locks shipping and retries only the exact retained quote/request',async()=>{
    let attempts=0,resolveFirst;
    const view=checkoutHarness(async(path)=>path.includes('/checkout?')?{revision:4,channel:'MAIL_IN',blockers:[],shippingOptions:serviceOptions}:path.endsWith('/quotes')?quoted('original-quote'):++attempts===1?new Promise((_resolve,reject)=>{resolveFirst=()=>reject(Object.assign(Error('timeout'),{code:'UNCONFIRMED_REPLY'}));}):{attemptId:'original-attempt',state:'UNKNOWN'});
    view.render();await tick();view.render();choose(view,2);await click(view,'Get exact total');
    const button=nodes(view.tree,n=>n.type==='button'&&text(n)==='Pay $66.70')[0],first=button.props.onClick(),second=button.props.onClick();await second;assert.equal(attempts,1);
    resolveFirst();await first;view.render();
    assert.equal(nodes(view.tree,n=>n.type==='select')[0].props.disabled,true);assert.equal(nodes(view.tree,n=>n.type==='button'&&text(n)==='Back to cards').length,0);
    await click(view,'Check original payment');
    const payments=view.calls.filter(call=>call.path.endsWith('/payments'));assert.equal(payments.length,2);assert.deepEqual(payments[0].options.body,payments[1].options.body);assert.equal(payments[0].options.body.quoteId,'original-quote');
    assert.equal(nodes(view.tree,n=>n.type==='button'&&text(n)==='Check payment status').length,1);assert.equal(view.calls.filter(call=>call.path.endsWith('/quotes')).length,1);view.unmount();
});

test('proven expired quote refusal returns to fresh pricing without retaining a nonexistent payment',async()=>{
    const view=checkoutHarness(async(path)=>path.includes('/checkout?')?{revision:4,channel:'MAIL_IN',blockers:[],shippingOptions:serviceOptions}:path.endsWith('/quotes')?quoted('expired-quote'):Promise.reject(Object.assign(Error('expired'),{code:'CHECKOUT_CHANGED',status:409})));
    view.render();await tick();view.render();choose(view,0);await click(view,'Get exact total');await click(view,'Pay $66.70');
    assert.equal(nodes(view.tree,n=>n.type==='button'&&text(n)==='Get exact total').length,1);assert.equal(nodes(view.tree,n=>n.type==='button'&&text(n)==='Check original payment').length,0);assert.equal(nodes(view.tree,n=>n.type===receipt.OrderAmounts).length,0);view.unmount();
});

test('multi-carrier receipt retains exact chosen legs and only exposes the matching inbound label',()=>{
    const mail={...order,receipt:{...quoted('original','USPS'),terms:{days:14,clockStart:'ATLAS_RECEIPT',mailChargedLegs:'BOTH_LEGS'}},effects:[
        {id:`${order.id}:shipstation:INBOUND:v1`,kind:'SHIPSTATION_LABEL',state:'SUCCEEDED',leg:'INBOUND',carrierName:'USPS',serviceName:'Ground Advantage'},
        {id:`${order.id}:shipstation:RETURN:v1`,kind:'SHIPSTATION_LABEL',state:'PENDING',leg:'RETURN'},
        {id:`another:shipstation:INBOUND:v1`,kind:'SHIPSTATION_LABEL',state:'SUCCEEDED',leg:'INBOUND'},
        {id:`${order.id}:shipstation:INBOUND:v1:extra`,kind:'SHIPSTATION_LABEL',state:'SUCCEEDED'},
    ]};
    const html=renderToStaticMarkup(React.createElement(receipt.default,{initialOrder:mail}));
    for(const content of ['Your cards → ATLAS','ATLAS → your address','USPS','Ground Advantage','$11.00','$12.50','$23.50','$66.70','ATLAS handles return shipping after grading'])assert.ok(html.includes(content),content);
    assert.equal((html.match(/Download label to ATLAS/g)??[]).length,1);assert.doesNotMatch(html,/FedEx|Download return|insured|Insurance/);
    assert.equal(receipt.shippingLabelLeg(mail.effects[0],order.id),'INBOUND');assert.equal(receipt.shippingLabelLeg(mail.effects[1],order.id),'RETURN');
    assert.equal(receipt.shippingLabelLeg({...mail.effects[0],leg:'RETURN'},order.id),null);assert.equal(receipt.shippingLabelLeg({...mail.effects[0],kind:'FEDEX_LABEL'},order.id),null);
});

test('customer-measured inbound packages begin empty, require actual measurements and invalidate totals after edits',async()=>{
    const view=checkoutHarness(async(path)=>path.includes('/checkout?')?{revision:4,channel:'MAIL_IN',blockers:[],shippingOptions:[{...serviceOptions[0],inboundPackaging:'CUSTOMER_MEASURED'}]}:quoted('measured-quote'));
    view.render();await tick();view.render();choose(view,0);
    let inputs=nodes(view.tree,n=>n.type==='input');assert.equal(inputs.length,4);assert(inputs.every(node=>node.props.value===''));
    assert.equal(nodes(view.tree,n=>n.type==='button'&&text(n)==='Get exact total')[0].props.disabled,true);
    for(let index=0;index<4;index++){inputs=nodes(view.tree,n=>n.type==='input');inputs[index].props.onChange({target:{value:['7.25','8','6','2'][index]}});view.render();}
    await click(view,'Get exact total');
    const request=view.calls.find(call=>call.path.endsWith('/quotes')).options.body;
    assert.deepEqual(JSON.parse(JSON.stringify(request.inboundPackage)),{weight:{unit:'ounce',value:7.25},dimensions:{unit:'inch',length:8,width:6,height:2}});
    nodes(view.tree,n=>n.type==='input')[0].props.onChange({target:{value:'8.5'}});view.render();assert.equal(nodes(view.tree,n=>n.type===receipt.OrderAmounts).length,0);
    assert.equal(nodes(view.tree,n=>n.type==='button'&&text(n).startsWith('Pay $')).length,0);view.unmount();
});
