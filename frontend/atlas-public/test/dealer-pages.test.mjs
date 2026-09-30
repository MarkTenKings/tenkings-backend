import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import * as directory from '../lib/dealers.mjs';
import * as legacyDirectory from '@atlas/report-view/dealer-directory';
const require=createRequire(new URL('../package.json',import.meta.url)),babel=require('next/dist/compiled/babel/core'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const compile=path=>babel.transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{filename:path,presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const nextRequire=createRequire(require.resolve('next/package.json'));
const environment={},calls={directory:0};
const exported={};vm.runInNewContext(compile('../pages/dealers.jsx'),{exports:exported,Intl,process:{env:environment},require:name=>{
 if(name==='react')return React;if(name==='next/link')return props=>React.createElement('a',props,props.children);if(name==='next/head'||name==='../components/DealerMap')return ()=>null;
 if(name==='@atlas/report-view/dealer-directory')return legacyDirectory;
 if(name==='../lib/dealers.mjs')return directory;if(name==='../lib/server/dealers.mjs')return {dealerDirectory:()=>({dealers:[],map:null})};if(name==='../lib/server/runtime.mjs')return {runtime:()=>({dealerLocations:async()=>{calls.directory++;return {locations:[]};}})};return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
}});
test('public submission directory renders actual configured schedule and kiosk CTA',()=>{
 const dealer={id:'fixture',name:'Fixture kiosk',address:{line1:'100 Fixture',city:'Fixture City',region:'CA',postalCode:'90000',country:'US'},position:{lat:34,lng:-118},kiosk:true,contactOnly:false,services:['SUBMIT'],programs:[],website:null,phone:null,
 timeZone:'America/Los_Angeles',schedule:{pickups:[{weekday:3,time:'10:00',cutoff:'09:00'}],returns:[{weekday:3,time:'10:00'}],exceptions:[]},nextCollection:'2026-09-30T17:00:00Z',projectedReturn:'2026-10-07T17:00:00Z',entryUrl:'/account/submit?kiosk=fixture',mapEmbedUrl:'https://maps.google.com/maps?q=34,-118&output=embed'};
 const html=renderToStaticMarkup(React.createElement(exported.default,{customerFunnelEnabled:true,dealers:[dealer],initialService:'SUBMIT',map:null}));
 assert.match(html,/Wednesday 10:00 \(cutoff 09:00\)/);assert.match(html,/Sep 30/);assert.match(html,/Oct 7/);assert.match(html,/Choose this kiosk/);assert.match(html,/kiosk=fixture/);assert.match(html,/Show location map/);assert.doesNotMatch(html,/<iframe/);
});
test('empty enabled kiosk directory is explicit and shows no contact-only submission CTA',()=>{
 const html=renderToStaticMarkup(React.createElement(exported.default,{customerFunnelEnabled:true,dealers:[],initialService:'SUBMIT',map:null}));assert.match(html,/No enabled kiosks are listed yet/);assert.doesNotMatch(html,/Choose this kiosk/);assert.match(html,/\$40 per card plus FedEx shipping/);
});
test('cold public directory preserves contact information without advertising an unavailable kiosk checkout',()=>{
 const html=renderToStaticMarkup(React.createElement(exported.default,{dealers:[],initialService:'SUBMIT',map:null}));
 assert.match(html,/The network is taking shape/);assert.doesNotMatch(html,/\$50|kiosk|Dealer account|Choose this kiosk/);
});
test('public kiosk service is not called until the server display switch is explicitly true',async()=>{
 const ctx={query:{service:'submit'},res:{setHeader(){}},req:{}};
 for(const value of [undefined,'false','1']) {
  environment.ATLAS_PUBLIC_CUSTOMER_FUNNEL_ENABLED=value;
  const result=await exported.getServerSideProps(ctx);
  assert.equal(result.props.customerFunnelEnabled,false);assert.equal(calls.directory,0);
 }
 environment.ATLAS_PUBLIC_CUSTOMER_FUNNEL_ENABLED='true';
 assert.equal((await exported.getServerSideProps(ctx)).props.customerFunnelEnabled,true);assert.equal(calls.directory,1);
 delete environment.ATLAS_PUBLIC_CUSTOMER_FUNNEL_ENABLED;
});
