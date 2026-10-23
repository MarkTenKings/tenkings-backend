#!/usr/bin/env node
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMarketplaceReleaseManifest} from '../src/release-readiness.mjs';

/** Explicit nonsecret JSON manifest only. Never import a configuration module,
 * inspect process.env, discover a key, initialize R1 or contact any provider.
 */
export async function checkMarketplaceReleaseFile(filename) {
  let handle;
  try {
    if(typeof filename!=='string'||!isAbsolute(filename))throw new Error();
    handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>262144)throw new Error();
    const buffer=Buffer.alloc(262145);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if(bytesRead>262144)throw new Error();
    return inspectMarketplaceReleaseManifest(JSON.parse(buffer.subarray(0,bytesRead).toString('utf8')));
  } catch {
    return {schema:'atlas-marketplace-release-inspection-v1',configurationComplete:false,status:'CONFIGURATION_INCOMPLETE',manifestHash:null,
      issues:[{path:'manifestFile',code:'EXPLICIT_BOUNDED_JSON_FILE_REQUIRED'}],productionReady:false,saleAuthorityAvailable:false};
  } finally {if(handle)try{await handle.close();}catch{}}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.argv.length!==3){process.stdout.write(JSON.stringify({status:'CONFIGURATION_INCOMPLETE',issues:[{path:'manifestFile',code:'USAGE_NODE_CHECK_MARKETPLACE_RELEASE_ABSOLUTE_JSON_PATH'}],productionReady:false})+'\n');process.exitCode=2;}
  else {const result=await checkMarketplaceReleaseFile(process.argv[2]);process.stdout.write(JSON.stringify(result,null,2)+'\n');process.exitCode=result.configurationComplete?0:2;}
}
