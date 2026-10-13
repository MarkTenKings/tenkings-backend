import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url),babel=require('next/dist/compiled/babel/core');
const code=babel.transformSync(readFileSync(new URL('../components/EarlyGeometryPreview.jsx',import.meta.url),'utf8'),{
 filename:'EarlyGeometryPreview.jsx',presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const exports={};vm.runInNewContext(code,{exports,require});
const render=status=>renderToStaticMarkup(React.createElement(exports.EarlyGeometryStatus,status));
test('ready physical preparation does not claim a missing printed border is ready',()=>{
 assert.match(render({status:{state:'READY',physical:[],prepared:true,printed:null}}),/Printed border needs review/);
 assert.doesNotMatch(render({status:{state:'READY',physical:[],prepared:true,printed:null}}),/Physical edge and printed border are ready/);
 assert.match(render({status:{state:'READY',physical:[],prepared:true,printed:[]}}),/Physical edge and printed border are ready/);
});
test('failed geometry offers manual recovery and changed settings cannot retry the stale detector input',()=>{
 const status={state:'NEEDS_REVIEW',canRetry:true};
 assert.match(render({status}),/place the outline yourself/);assert.match(render({status}),/Retry geometry/);
 const pending=render({status,settingsChanged:true});assert.match(pending,/save these settings/);assert.doesNotMatch(pending,/Retry geometry/);
});

test('the supplied clean grading image is the sole geometry photograph',()=>{
 const props={src:'/grading-clean',side:'Front',status:{state:'READY',physical:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}};
 const shown=renderToStaticMarkup(React.createElement(exports.default,props));
 assert.match(shown,/src="\/grading-clean"/);assert.match(shown,/background-removed grading image/);
 assert.doesNotMatch(shown,/View original|Clean presentation/);
});

test('historical geometry offers an explicit Astra refresh without claiming a new result',()=>{
 const shown=render({status:{state:'NEEDS_REVIEW',error:'GEOMETRY_REFRESH_AVAILABLE',canRetry:true}});
 assert.match(shown,/Saved geometry retained/);assert.match(shown,/Request Astra geometry/);assert.doesNotMatch(shown,/Geometry queued/);
});
