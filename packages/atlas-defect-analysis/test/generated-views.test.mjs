import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAstraContextBackgroundDefectRequestAsync} from '../src/index.mjs';
import {contextInputFixture} from './fixtures.mjs';
test('removed auxiliary image input cannot reach a grading request',async()=>{
 const input=contextInputFixture();input.generatedViews=[];
 await assert.rejects(buildAstraContextBackgroundDefectRequestAsync(input));
});
