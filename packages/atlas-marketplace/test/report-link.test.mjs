import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedReportPath } from '../ui/report-link.mjs';
import { renderApp } from '../ui/view.mjs';
import { renderPublicCatalog,publicCatalogConfig } from '../ui/catalog-view.mjs';
import { makeSyntheticEligibility } from './listing-fixtures.mjs';

test('R1 report links require the exact immutable public token and retained version in both catalog and workspace',()=>{
  const report='/reports/ar_ABCDEFGHIJKLMNOPQRSTUVWX?v=7';
  assert.equal(approvedReportPath(report,7),report);
  const refused=[report.replace('v=7','v=8'),report+'&other=1',report+'#hash',report.replace('v=7','v=07'),report.replace('ar_','ar_%41'),report.replace('?v=7',''),report.replace('/reports/','//reports/'),'https://evil.test'+report,'https://atlasgrading.com'+report,report.replace('ar_ABCDEFGHIJKLMNOPQRSTUVWX','ar_short')];
  for(const value of refused)assert.equal(approvedReportPath(value,7),null);
  for(const version of [0,-1,7.1,'7',2147483647])assert.equal(approvedReportPath(report,version),null);
  const card=makeSyntheticEligibility().approvedCard;card.reportVersion=7;card.reportUrl=report;
  const data={runtime:'AUTHENTICATED',schema:'atlas-marketplace-workspace-v1',environment:'PROVIDER_SANDBOX',scope:{role:'BUYER',actorId:'buyer'},eligibilityCards:[card],listings:[],reservations:[],orders:[],intents:[]};
  const item={id:'listing',status:'ACTIVE',askingPriceCents:100,approvedCard:card};
  const state={status:'ready',page:{environment:'PROVIDER_SANDBOX',items:[item],total:1,offset:0,nextOffset:null},origin:'https://atlasgrading.com',filters:{},previousOffsets:[]};
  assert.ok(renderApp(data).includes(`href="${report}"`));assert.ok(renderPublicCatalog(state,publicCatalogConfig()).includes(`href="${report}"`));
  card.reportVersion=8;
  assert.ok(!renderApp(data).includes(`href="${report}"`));assert.ok(!renderPublicCatalog(state,publicCatalogConfig()).includes(`href="${report}"`));
});
