import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ApprovedReportView} from '@atlas/manual-workspace/report-review';
import {explainAtlasManualReport} from '@atlas/grading-core/manual-report';
import {publicationFixture} from '../../../packages/atlas-connected-manual/test/publication-fixture.mjs';
test('the actual published allowlist renders through the shared approved report without staff authority or private rejection counts',async()=>{
 const f=await publicationFixture();await f.publication.publish({},f.cardId,f.actionId);const m=JSON.parse(f.row.manifest),packet=await f.artifacts.read(m.packet.ref,{cardId:f.cardId,kind:'PUBLIC_REPORT',sourceHash:m.packet.sourceHash});
 const html=renderToStaticMarkup(React.createElement(ApprovedReportView,{report:packet.report,explanation:explainAtlasManualReport(packet.report),geometry:packet.geometry,
  images:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{inspection:{url:`/api/reports/${packet.publicToken}/images/${side}?v=1`,...packet.images[side]}}])),
  publication:{version:1,reportHash:f.row.public_hash,reportNumber:packet.reportNumber,approvedAt:packet.approvedAt,url:`/reports/${packet.publicToken}?v=1`}}));
 assert.match(html,/ATLAS-012345ABCDEF/);assert.match(html,/How this grade is calculated/);assert.equal(html.includes('Return to Findings'),false);
 for(const text of ['Approve final report','Rejected Astra suggestions',f.actorId,'private/'])assert.equal(html.includes(text),false,text);
});
