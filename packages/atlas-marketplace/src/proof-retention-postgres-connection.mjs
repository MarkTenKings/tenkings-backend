// Concrete source-owned pg8.16.3 connection boundary. Default-off; no authority.
import fs from 'node:fs';
import net from 'node:net';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {INTAKE_PROTECTED_CATALOG_QUERIES,INTAKE_PROTECTED_CLOSURE_HASH,INTAKE_PROTECTED_ROLE,validateIntakeProtectedCatalog,validateRetentionIntakeProtectedCatalog} from './proof-intake-protected-catalog.mjs';
import {intakeProtectedInstallation} from './proof-intake-protected-protocol.mjs';
import {RETENTION_PROTECTED_CATALOG_QUERIES,RETENTION_PROTECTED_CLOSURE_HASH,RETENTION_PROTECTED_DATABASE,RETENTION_PROTECTED_ROLE,RETENTION_PROTECTED_OWNER,validateRetentionProtectedCatalog} from './proof-retention-protected-catalog.mjs';

// Exact installed public dependency inventory used by the isolated C1 fixture.
// Caller input cannot replace these pins or provide a constructor/transport.
const DRIVER_FILES=Object.freeze({".package-lock.json":"b782a8c5a5ee79f044d257f83a146ea57bd1e3d56e5787e0099eca23549ce5af","pg/LICENSE":"192b8f5c96900f04a1271dec39688655d7416c1c6ea84a508e18b50d2b6751f3","pg/README.md":"25e19d878c5a492023778a2596e8e26d76fc3e2b97a9582d4bdde675b8932408","pg/esm/index.mjs":"5ef4d06556eeb775987759c2c09229dca2139421ee40e819b566612db2b4a8dc","pg/lib/client.js":"7e6ba79fe6bc1db15ec66ce67cd0f96b6b27c300ccec45911dc15f5121f709f4","pg/lib/connection-parameters.js":"db77bac013bfb5faae661d3056f3fbc49f5bae60334f60b149de0c271a9d9725","pg/lib/connection.js":"2069c662af9de8a708105f304a0e674a9766478da8250b416f5f3ee9ae0f4d99","pg/lib/crypto/cert-signatures.js":"206ec95c51012b73fe15d549b24db2acab969271e971940a0b79cfdcf830755b","pg/lib/crypto/sasl.js":"37206f4af85a0bf9973089c06ce54456938c3c74c9d4e65507053b8afd468889","pg/lib/crypto/utils-legacy.js":"f453cc172ad7e9dbb6e09b3cb48d267113e5128d834e6ae2519d7e2d9fde0fa6","pg/lib/crypto/utils-webcrypto.js":"a849cfe22d7590d79ddee76c8d7a058e2b67360a0d76683275d34133e5637117","pg/lib/crypto/utils.js":"a7d537da58f9ebc65dee84789ed5fa4175c6961c5be4a4dbb62b67d99c9c1213","pg/lib/defaults.js":"8bb1781954cb7695e1e1bf7200aa29327ad0e135c877d1a82878858b123ced31","pg/lib/index.js":"a012ecbe7fdefed8d2b36c3658e33dc4c291d0bb60df18d382300061211052b7","pg/lib/native/client.js":"c900e47be3da1cb8b35a7e0cf1e51a7065f85cbbe505103c833d770cf574f5d5","pg/lib/native/index.js":"99fb61cb78a6d78b7a5fc0b9ac264ad58272af48be4bc50bfdb948b1342e3292","pg/lib/native/query.js":"e17221776993847901de73de28690aebc1e5ed1151b115bc8d84cc10cddf4ae4","pg/lib/query.js":"dea8044d70531cd16e514ecddbe44cdd65b4315a02287958d5ecfd0ebcd70ded","pg/lib/result.js":"2e9dfbbb89c84cfdb1977a1503f2ddd265ed2f943f8dc3957dc0db193ee81488","pg/lib/stream.js":"0bd4001775301604ddf7c94152e05f6f30a9354876717bdae2ab636d00eb12ba","pg/lib/type-overrides.js":"47cb7f7bc6a6e1b1d4dc7c92bacacb436f12e99242b77da8391fd5b71991d2a5","pg/lib/utils.js":"a109ef3b3a7572e8523b937ae0c100be72d4f36d1d3d4c7032e1ef0abaf92e38","pg/package.json":"f7b678a8055c234669e8dd272dd624771e29d9f0e3a3353f15c3005ab1a5fd29","pg-cloudflare/LICENSE":"192b8f5c96900f04a1271dec39688655d7416c1c6ea84a508e18b50d2b6751f3","pg-cloudflare/README.md":"d76b5e56e088f30e86dba1466ed03adf924344db31278ec966c5a35d219aca26","pg-cloudflare/dist/empty.d.ts":"d889ca31ecf859432c9e675cf056009a227f839856a8cac58a70875e2d619a8b","pg-cloudflare/dist/empty.js":"3f83d105df21adbeeffb03450deb422644c30023ece93b2d6191fac3c620a316","pg-cloudflare/dist/empty.js.map":"d68e0a1a8fc1c84f026b87ff43556987d0fbf0c3cd6c2c3e2715164d4795bb93","pg-cloudflare/dist/index.d.ts":"0db679917266057c64fb2f943bad559ced56831ff56870f877c71c14913cfde4","pg-cloudflare/dist/index.js":"fdd631639301f2a7478a4770415fafcde43209cdd54b6caa73154ca423137ebd","pg-cloudflare/dist/index.js.map":"2c98af14fed37fdeb2bb9ca46dfb389eee0c4e9d6c6deda414f1e02dc5c5173a","pg-cloudflare/esm/index.mjs":"8a44ad34a1d541c0607579b46ab4eb3d60c614991429aa053763d7bca58cff7e","pg-cloudflare/package.json":"93b30ce3bed1ce3b836aa344c8afdaab74a42c03720e8d5baa801b6ae84ca3e7","pg-cloudflare/src/empty.ts":"e9bbc49a0780b0f81e9b1906aef57ad9f9371aba33a9f4e9b9eb9191c0dc19c9","pg-cloudflare/src/index.ts":"50fe877a1f395ee129e1b97bcef3ef45a124e25586dc44c2799397604ea74c76","pg-cloudflare/src/types.d.ts":"ba1c222e51377f1d8c47979ec6216e0a566d0828b10de794db31d6a44f5cf491","pg-connection-string/LICENSE":"2244b5486c4427001b6756a87b9a297d427c111dcc3ba64a097492a8979c23d0","pg-connection-string/README.md":"c2cba494f78d950f91ec21298bbf60a949dc379d4f873ffe3ee319c918a175e0","pg-connection-string/esm/index.mjs":"e5af439889cb873c459670b82503c7b0480c7055843c6482242e50282f76b1ee","pg-connection-string/index.d.ts":"ec0ec7d7d754b7d65faf256ad01d85b49a9417a7540161aa7a378969ae095c26","pg-connection-string/index.js":"d8c0ca43dc70daf05a9ff5469c92fd0a3cbcd11cacf68156ebb19ee32d127cfd","pg-connection-string/package.json":"53d453c5a426e69a11ff479e0d8a293505faa1833e6eb3ff7ceefdaac569e3ea","pg-int8/LICENSE":"4e8e87ccdfc7e4b47fd89015f78468aa53b6bf43ab6e6e12d43e8f55294911de","pg-int8/README.md":"d77eaaca16d1fe569ee6dc87d340d2fa6d14438652618a8cf20382e16648244a","pg-int8/index.js":"f991b0a41119bce0efbb471275dbd02de31a79fe6f87f8f5e5678e373a0f1627","pg-int8/package.json":"147155887a41bb6f69ff98b3dde827b7e6a8214c3a71938da4babf8e12adff2e","pg-pool/LICENSE":"4f15ee7fc2a72082859d7e0d12dfa4bcdd70b1c744ad3850d07780730ac08557","pg-pool/README.md":"9d7028ff70e7cddeb97e7a2fda222e12c0e52fe954baf640d62d29880d9628bb","pg-pool/esm/index.mjs":"521c8058172944cb9ceaee95073b49950a3906f91263303837e89f9ee346e81e","pg-pool/index.js":"6f304776edaabde2954cbf8c4366fa6d9512bfba0e408e78cc56b3c46c69d058","pg-pool/package.json":"0a9924def9e06f791b09a44eaefb227f323a39199887f6ce17b44cb5a9193134","pg-protocol/LICENSE":"192b8f5c96900f04a1271dec39688655d7416c1c6ea84a508e18b50d2b6751f3","pg-protocol/README.md":"163df61eaa9f5337d5c0fcb3c0f15207f91a208dbd12ed26582bfc1e9bd59180","pg-protocol/dist/b.d.ts":"8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881","pg-protocol/dist/b.js":"a1024bdec7246a732be4713a3d3326258732971363ac234d4c1709fe54b48be1","pg-protocol/dist/b.js.map":"458d1437306773b76c28391cb340e4c3331e3d85d267fd508eac7773f81cb325","pg-protocol/dist/buffer-reader.d.ts":"0d6484c7d84af67e685cae28bbc96fafdb7d90ae5952747cb6e1f0ca831464e6","pg-protocol/dist/buffer-reader.js":"fdae5fd80c1ad1015f91a92da667467752eabdf531f19558897e205559e6b714","pg-protocol/dist/buffer-reader.js.map":"291ea861a3856e4e13bca046e0e79c0b7d9f84467f13f5498f0a403d17409b27","pg-protocol/dist/buffer-writer.d.ts":"6847d4a9b10fc9b84eec9c56b99b7321337e018fdbf5be415d14467b98d73876","pg-protocol/dist/buffer-writer.js":"78428fc0607cd87c28009159e87ca3704faf7bda000ea44d2ec46a97805cec9d","pg-protocol/dist/buffer-writer.js.map":"005eb1ea7ba6bc3af22e0ef96a7be80e7e824b6602df150f56b4ab5258fe583c","pg-protocol/dist/inbound-parser.test.d.ts":"8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881","pg-protocol/dist/inbound-parser.test.js":"b7bcfce357865e993960da4e85d3095e35b8384d52cc3c17dd04dde7fea8e5ad","pg-protocol/dist/inbound-parser.test.js.map":"126aa1d6837e1e0f09d6f258f0ad741c8bcedd83af5c29f86e770b819a2a54a6","pg-protocol/dist/index.d.ts":"c2c9f431f788b434e6ae327844ef6712bb6a6a88ad08acf20bf6cfeb41d154ba","pg-protocol/dist/index.js":"e7a99ac02633393d8c3ef16cd6385b8246100d28c838b02420844068429a46c9","pg-protocol/dist/index.js.map":"5b68cd072bef63afbc4da7e19f6e30f4d8a2c89d5a113193cf1f15eefacd5ef8","pg-protocol/dist/messages.d.ts":"4a20a0a39aca8738cc5088f9dea2969bf2af3ca1341c56071f513059b122d150","pg-protocol/dist/messages.js":"dfd22ad639f3030b41617ff0ee201ece7cdbce4adb7e1aae7978541b1384cd31","pg-protocol/dist/messages.js.map":"811fb02046104bfd60c5478bab3e491e8f9eb88602a17ca47f5ae69c72580dd9","pg-protocol/dist/outbound-serializer.test.d.ts":"8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881","pg-protocol/dist/outbound-serializer.test.js":"2f698de794633941a67fc04506d48bc85bc74f0e9927dae08548688a91246112","pg-protocol/dist/outbound-serializer.test.js.map":"3bf6249e69edf1068e613db668872a3bc64a357701d1a2fddef22ba92baab911","pg-protocol/dist/parser.d.ts":"effa1fd4980f6dff4e81ed67009b847d34449087504319f9a0dd081e8cf23a31","pg-protocol/dist/parser.js":"6f841aabda7240df44e1b08bbe8e202502ead969576c1ecc17311af48f57f2ef","pg-protocol/dist/parser.js.map":"fbce35fbc7e1713ab9edcbbc3a98b978f699a26fe30fbc2afe5292b219ac7507","pg-protocol/dist/serializer.d.ts":"a33c98f95c099c2a9a383b156c8f2a16605843d29455a954c1431bcbbc1ce35a","pg-protocol/dist/serializer.js":"0c81a499cd210334e14bc65ee514b2ecf842588e27533f5e9a461f914d0b9623","pg-protocol/dist/serializer.js.map":"730d03a1396d473526f691495a0b09000840d33a66601e5982ae6df9ea37196c","pg-protocol/esm/index.js":"0f6c279f5e18cbc73dd3eab808e6eaa9621ddd3511197da2e67106fdd0b2b3b2","pg-protocol/package.json":"a4a4e23027b26c72be7729d045d0100ad9329959db0449c535fa7b2ba2e717c6","pg-protocol/src/b.ts":"eb585946649fd05e86397b77be4a9d00c225d2222cbc356d725afe11ea8ab265","pg-protocol/src/buffer-reader.ts":"2465afc8aa6d9863357d35e2ccac9f6b2d0d5d6c10fc4b03d8b01dbc640f3b32","pg-protocol/src/buffer-writer.ts":"568a874ad28c5b235f4c325ba469124a1eaeb029e0dbbdca243280f9186bd306","pg-protocol/src/inbound-parser.test.ts":"3a65f5bf6bfee38c5d8cc85bc9ae993eef7c677ef05d080ee069ca1a5fed6e1e","pg-protocol/src/index.ts":"a7acc3e9fd87b531b93012b3d4d3af0cb1ec88bc4f29ba76b4af9d3d6dde927a","pg-protocol/src/messages.ts":"98ceb278f736325f847a0c8326aae46f2573f2a750b056d5061ae0d00714cd2d","pg-protocol/src/outbound-serializer.test.ts":"42d591bf94e2db92b4ae8848be5b543e3bbca97ff882d7d56b7d607929a5557b","pg-protocol/src/parser.ts":"b991370b2b49c7a701e8b75fa0e18e43757c57ccf83b86d830866fcdd3ba825f","pg-protocol/src/serializer.ts":"1d02bc0ea6d07ee7a6e8779c033e0998d1871a320c74157c936a47535d4238bc","pg-protocol/src/testing/buffer-list.ts":"01bce658cf7fbb2c03ebb4c3d7e729389d6b3c9edb3cbfc2e1864f2a76647a00","pg-protocol/src/testing/test-buffers.ts":"556522ba2930a51c27b1ad945a6308f3a4d6b4f449a0f9d90e8bc631f9eb8536","pg-types/.travis.yml":"b09d0d2ec01d004669d7ff94f5fc91f380e88faece76226c7c72b0a99751dc36","pg-types/Makefile":"f8ef5d631da574fb89632ac2664fdab6150b122f06b700d95c98b247bce56257","pg-types/README.md":"ecda9bca71d3f0cee4e600d1dd2bef336213f39ef2e8fca6a1a1c1c8723f643a","pg-types/index.d.ts":"f60e3e3060207ac982da13363181fd7ee4beecc19a7c569f0d6bb034331066c2","pg-types/index.js":"ece6d549270ba55d08126b10c9997324d808ee828ef00dad236e84e54d9d556d","pg-types/index.test-d.ts":"da9b9d37dce95816b504a3b7577135a6060b1ba8053f0a643786ed672488bbdd","pg-types/lib/arrayParser.js":"cad20b20e6312125b45f74480eba3ef46b456997da4f53bbec56356d66edd730","pg-types/lib/binaryParsers.js":"4b0105414068ea96450ef0d420db9449c00c565c5894683955af15bf94075fb9","pg-types/lib/builtins.js":"09213197e4b44012e4c83669aa80884a189e90c777ddfef1f44c90c412167354","pg-types/lib/textParsers.js":"bd811a530000508b6b90c1db462078e122f0404769d73f57ad41fe90aca159bd","pg-types/package.json":"3ec0293cb38cc8d9475e3eb32ac5f19d195bf9fccc8b19a0714e6ecd6e7c2cf0","pg-types/test/index.js":"903e76e7cd794c5f7918b67847e3790f4c582948eaf75ab9fd43d62278b44bc3","pg-types/test/types.js":"b813a6ece808d40094bac1770d4d35cb0e17ae70a4236cc5c93846d72c08c159","pgpass/README.md":"62549909404b5a0dcb2b4b74c9a930baf8095dbcfa1543c4ffc79378acd22b57","pgpass/lib/helper.js":"28d823dcde115f31848ba93d9cb55ba20089ac701b6a38b228d185d96df4f1b5","pgpass/lib/index.js":"cc95b8ef6c32a9afdc48b85a5e7128d5e29567f8ded02d9bf7acd27c3d870c39","pgpass/package.json":"d75240eb4fe759c10db9f903838275348676a8bdc1f329e20a833713cd7c99bd","postgres-array/index.d.ts":"5e5cd3ad9676e8fa514b66502e5d132c537a9d78a849874c4b2d6f59aaff5acf","postgres-array/index.js":"807ba580ed423e518672c27b4022a56acb693be04349733ffc1fe6f324fbcee2","postgres-array/license":"f057f36739d53d228a746de4440c1e0c644ecde06d6beab45337d39c9d12a393","postgres-array/package.json":"dcd6a505fcbc032b409ee2838ab2c776dea3a9cfe02b736364b6cb82a946665f","postgres-array/readme.md":"d6b0e269174660704b3d72438334a52d2bcb2f353a3354f3c7cd65771e27c0de","postgres-bytea/index.js":"c078b99e1009c4bcf6e3ab59d9fe808b12caee3461204ae599cdd9cccd990801","postgres-bytea/license":"f057f36739d53d228a746de4440c1e0c644ecde06d6beab45337d39c9d12a393","postgres-bytea/package.json":"9125568c5fb51a65b8f11adb0080c2775b99ee82822d73bff8b56b2a9d47d7aa","postgres-bytea/readme.md":"24d2c6e5bc32e86c9263af0d8ca2e5217a43565a311942888ba979fd5b0ed550","postgres-date/index.js":"9a09e3ec0775237576b1f6ff0fba0ed6171235aeded635a42c174b517e34cb1a","postgres-date/license":"f057f36739d53d228a746de4440c1e0c644ecde06d6beab45337d39c9d12a393","postgres-date/package.json":"03f9edefa96697072075e02df045cc61ed4ca2f8dfffb1ff87f4070bc3404151","postgres-date/readme.md":"ac45d399addd5e87db86d35adf84755bceadb0aee2360daeffd7af2d4ab41472","postgres-interval/index.d.ts":"71f9db35d9032bee846bafdf29caf0229ce594495f6c6457e65276afe962dc8a","postgres-interval/index.js":"836fe0a39e52f051d62583d8375d3b270b4cb93dd026b125438a89e5a0258c41","postgres-interval/license":"f057f36739d53d228a746de4440c1e0c644ecde06d6beab45337d39c9d12a393","postgres-interval/package.json":"cc3056db105e66c9128cb8a387cda782d5f1ae9281be90de0b8d26a90af89c57","postgres-interval/readme.md":"f5399e5250a2cc93245d874dbfe3527e5845119a65b80ea13cbb66ccf913818e","split2/LICENSE":"c372ef2fa1dfcb124ed807609751e75e3a009f108c5724916b489288fcb88a0c","split2/README.md":"7369c93bb01adc348ccdd1ac052880cc7d06e39a4a037c6a3f15175c3a6f0a64","split2/bench.js":"de9eadc4133f88e9991f504899c47ef841ee923576dba2a8e50dc34a1d48692e","split2/index.js":"842471719e0e901e01ae1a1d3a6a4d1ff3e36747a7f50d5644f09d1d595c1857","split2/package.json":"87b734c3087c8d9ed5d76d1bff00db30f960831ba8705dd18d73b180d08d2140","split2/test.js":"de9619b9670887b6d1ed959287b96b46334cd9a6be21487c8a715afad90eade8","xtend/.jshintrc":"da3531289454b9a256c622c1a74771440d4f0e57092262902cefbc6830ec3a7c","xtend/LICENSE":"82e67379203d5794e7c44549847d8d64ae6904591381682360470898bd306821","xtend/README.md":"fe5fb4d83470799709c32207fc1fff3e522070b2c625a9818f191125406cd360","xtend/immutable.js":"04986f168b8f16f4f25237d0608cdf57b6ca14f100fed62c0295bda2559ab24b","xtend/mutable.js":"71a38649c77408217483f81f55daee1d6646d6c670e3d034a4482cb3453886e9","xtend/package.json":"b02ffef8cda96c5c3ee00a00390e63f608362c2ddfb3ed754e181d013a45d48a","xtend/test.js":"4a7a6d3aade85095607c4aa3bd99f74fa6adaa69058d156677ad7756955e80f6"});
const owners=new WeakSet(),protectedOwners=new WeakMap(),intakeOwners=new WeakSet(),check=(v,c='RETENTION_CONNECTION_INVALID')=>requireValue(v,c);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),identifier=v=>typeof v==='string'&&/^[a-z][a-z0-9_]{0,62}$/.test(v);
const sha=b=>createHash('sha256').update(b).digest('hex'),failure=code=>Object.assign(new Error(code),{code});
const FUNCTION_NAMES=Object.freeze(['read_state()','lock_state()','commit_state(bigint, text, jsonb, text, bigint)']);
const MARKERS=Object.freeze({classification:'UNQUALIFIED',customerPublicationAuthority:false,retentionAuthority:false});
const stamp=s=>[s.dev,s.ino,s.uid,s.gid,s.mode,s.nlink,s.size,s.mtimeMs,s.ctimeMs].join(':');
function directory(path){
  check(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&fs.realpathSync(path)===path,'RETENTION_DRIVER_PATH');
  for(let p=path;;p=dirname(p)){const s=fs.lstatSync(p);check(s.isDirectory()&&[0,process.getuid()].includes(s.uid)&&(s.mode&0o022)===0,'RETENTION_DRIVER_PATH');if(p==='/')break;}
}
function file(path){
  const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let raw;
  try{const s=fs.fstatSync(fd);check(s.isFile()&&s.nlink===1&&[0,process.getuid()].includes(s.uid)&&(s.mode&0o022)===0&&s.size>=0&&s.size<=262144,'RETENTION_DRIVER_FILE');raw=Buffer.alloc(s.size+1);let n=0;while(n<raw.length){const at=fs.readSync(fd,raw,n,raw.length-n,null);if(!at)break;n+=at;}check(n===s.size&&stamp(s)===stamp(fs.fstatSync(fd))&&stamp(s)===stamp(fs.lstatSync(path)),'RETENTION_DRIVER_CHANGED');return raw.subarray(0,n);}finally{fs.closeSync(fd);}
}
function loadClient(root){
  directory(root);const found=[];let total=0,entries=0;const walk=(path,depth)=>{check(depth<=8,'RETENTION_DRIVER_BOUND');for(const entry of fs.readdirSync(path,{withFileTypes:true})){check(++entries<=512&&found.length<=256,'RETENTION_DRIVER_BOUND');const target=join(path,entry.name);if(entry.isDirectory()){directory(target);walk(target,depth+1);}else{check(entry.isFile()&&!entry.isSymbolicLink(),'RETENTION_DRIVER_FILE');const name=target.slice(root.length+1);check(Object.hasOwn(DRIVER_FILES,name),'RETENTION_DRIVER_EXTRA');const raw=file(target);total+=raw.length;check(total<=1048576&&sha(raw)===DRIVER_FILES[name],'RETENTION_DRIVER_HASH');found.push(name);}}};walk(root,0);
  check(found.length===Object.keys(DRIVER_FILES).length,'RETENTION_DRIVER_MISSING');
  // Direct Client avoids pg/index's NODE_PG_FORCE_NATIVE branch. Every package
  // in its local dependency tree is present and pinned before loading code.
  const entry=join(root,'pg/lib/client.js'),require=createRequire(entry),Client=require(entry);
  check(typeof Client==='function','RETENTION_DRIVER_EXPORT');return Client;
}
export function retentionPostgresConnectionConfiguration(input){
  const c=decoderContractData(input);decoderExact(c,['schema','driverDirectory','endpoint','database','role','functionOwner','password','functionDefinitionHashes']);
  check(c.schema==='atlas-proof-retention-postgres-connection-v1'&&typeof c.driverDirectory==='string'&&isAbsolute(c.driverDirectory)&&resolve(c.driverDirectory)===c.driverDirectory);
  check(identifier(c.database)&&identifier(c.role)&&identifier(c.functionOwner)&&c.functionOwner!==c.role);
  check(typeof c.password==='string'&&Buffer.byteLength(c.password)<=4096&&!c.password.includes('\0'));
  const e=c.endpoint;check(e&&typeof e==='object');
  if(e.kind==='LOCAL_UNIX'){decoderExact(e,['kind','directory','port']);check(typeof e.directory==='string'&&isAbsolute(e.directory)&&resolve(e.directory)===e.directory&&e.directory.length<=100);}
  else{decoderExact(e,['kind','hostname','port','ca']);check(e.kind==='VERIFIED_TLS'&&typeof e.hostname==='string'&&e.hostname.length<=253&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(e.hostname)&&!net.isIP(e.hostname)&&typeof e.ca==='string'&&Buffer.byteLength(e.ca)<=8192&&e.ca.startsWith('-----BEGIN CERTIFICATE-----\n')&&e.ca.trimEnd().endsWith('-----END CERTIFICATE-----'));}
  check(Number.isSafeInteger(e.port)&&e.port>0&&e.port<=65535);
  decoderExact(c.functionDefinitionHashes,FUNCTION_NAMES);check(FUNCTION_NAMES.every(n=>digest(c.functionDefinitionHashes[n])));
  return decoderFreeze(c);
}
export function assertProofRetentionPostgresConnectionOwner(value){check(owners.has(value),'RETENTION_CONNECTION_OWNER_REQUIRED');return value;}

// This configuration selects a fixed source-owned candidate installation. It
// supplies no function hashes, query executor, authorization or expected token.
export function retentionProtectedPostgresConnectionConfiguration(input){
  const c=decoderContractData(input);decoderExact(c,['schema','driverDirectory','endpoint','database','role','functionOwner','password']);
  check(c.schema==='atlas-proof-retention-protected-connection-v1'&&c.database===RETENTION_PROTECTED_DATABASE&&c.role===RETENTION_PROTECTED_ROLE&&c.functionOwner===RETENTION_PROTECTED_OWNER,'RETENTION_PROTECTED_CONFIGURATION');
  const checked=retentionPostgresConnectionConfiguration({...c,schema:'atlas-proof-retention-postgres-connection-v1',functionDefinitionHashes:Object.fromEntries(FUNCTION_NAMES.map(n=>[n,'0'.repeat(64)]))});
  const {functionDefinitionHashes,...rest}=checked;return decoderFreeze({...rest,schema:c.schema});
}
export function assertProofRetentionProtectedConnectionOwner(value){check(protectedOwners.has(value),'RETENTION_PROTECTED_OWNER_REQUIRED');return value;}
export function createProofRetentionProtectedConnectionOwner(options={}){
  const input=engineDataOptions(options,[],['enabled','configuration','binding','maxOperations']);if(input.enabled!==true)return null;
  const binding=decoderContractData(input.binding);decoderExact(binding,['schema','environment','policyHash','storageHash']);
  check(binding.schema==='atlas-marketplace-proof-intake-v1'&&binding.environment==='SYNTHETIC_LOCAL'&&digest(binding.policyHash)&&digest(binding.storageHash),'RETENTION_PROTECTED_BINDING');
  check(Number.isSafeInteger(input.maxOperations)&&input.maxOperations>=1&&input.maxOperations<=4096,'RETENTION_PROTECTED_BINDING');
  return createOwnedConnection(retentionProtectedPostgresConnectionConfiguration(input.configuration),decoderFreeze({binding,maxOperations:input.maxOperations}));
}

/** Owns at most one real connection, without a queue or connection retry. This
 * object is storage plumbing, not a request, actor, fence or publication grant. */
export function createProofRetentionPostgresConnectionOwner(options={}){
  const input=engineDataOptions(options,[],['enabled','configuration']);if(input.enabled!==true)return null;
  return createOwnedConnection(retentionPostgresConnectionConfiguration(input.configuration),null);
}
// Separate fixed extension mode. Existing generic/retention-only factories and
// their catalog contracts remain unchanged. No supplied query/pool or audit.
export function intakeProtectedPostgresConnectionConfiguration(input){
 const c=decoderContractData(input);decoderExact(c,['schema','driverDirectory','endpoint','database','role','functionOwner','password']);
 check(c.schema==='atlas-proof-intake-protected-connection-v1'&&c.database===RETENTION_PROTECTED_DATABASE&&c.role===INTAKE_PROTECTED_ROLE&&c.functionOwner===RETENTION_PROTECTED_OWNER,'INTAKE_PROTECTED_CONFIGURATION');
 const checked=retentionPostgresConnectionConfiguration({...c,schema:'atlas-proof-retention-postgres-connection-v1',functionDefinitionHashes:Object.fromEntries(FUNCTION_NAMES.map(n=>[n,'0'.repeat(64)]))});
 const {functionDefinitionHashes,...rest}=checked;return decoderFreeze({...rest,schema:c.schema});
}
export function createProofIntakeProtectedConnectionOwner(options={}){
 const input=engineDataOptions(options,[],['enabled','configuration','installation']);if(input.enabled!==true)return null;
 const installation=intakeProtectedInstallation(input.installation);
 return createOwnedConnection(intakeProtectedPostgresConnectionConfiguration(input.configuration),null,installation);
}
export function assertProofIntakeProtectedConnectionOwner(value){check(intakeOwners.has(value),'INTAKE_PROTECTED_OWNER_REQUIRED');return value;}
// Explicit extension opt-in. The existing retention-only factory still refuses
// extra schema objects. This factory retains the separate retention DB role.
export function retentionIntakePostgresConnectionConfiguration(input){
 const c=decoderContractData(input);check(c.schema==='atlas-proof-retention-intake-connection-v1','RETENTION_INTAKE_CONFIGURATION');
 const checked=retentionProtectedPostgresConnectionConfiguration({...c,schema:'atlas-proof-retention-protected-connection-v1'});
 return decoderFreeze({...checked,schema:c.schema});
}
export function createProofRetentionIntakeConnectionOwner(options={}){
 const input=engineDataOptions(options,[],['enabled','configuration','installation','maxOperations']);if(input.enabled!==true)return null;
 const installation=intakeProtectedInstallation(input.installation);
 check(Number.isSafeInteger(input.maxOperations)&&input.maxOperations>=1&&input.maxOperations<=4096,'RETENTION_PROTECTED_BINDING');
 return createOwnedConnection(retentionIntakePostgresConnectionConfiguration(input.configuration),decoderFreeze({binding:installation.binding,maxOperations:input.maxOperations}),installation);
}
function createOwnedConnection(config,protectedScope,intakeScope=null){
  check(process.versions.node==='22.16.0'&&['linux','darwin'].includes(process.platform),'RETENTION_CONNECTION_RUNTIME');
  const Client=loadClient(config.driverDirectory),endpoint=config.endpoint;
  if(endpoint.kind==='LOCAL_UNIX'){directory(endpoint.directory);check((fs.lstatSync(endpoint.directory).mode&0o077)===0,'RETENTION_SOCKET_DIRECTORY');}
  const secret=Buffer.from(config.password,'utf8'),publicConfig={schema:config.schema,database:config.database,role:config.role,functionOwner:config.functionOwner,endpoint:endpoint.kind==='LOCAL_UNIX'?endpoint:{kind:endpoint.kind,hostname:endpoint.hostname,port:endpoint.port,caHash:sha(Buffer.from(endpoint.ca))},driverInventoryHash:hash(DRIVER_FILES),...(intakeScope?{intakeCatalogHash:INTAKE_PROTECTED_CLOSURE_HASH,installedIntake:intakeScope,...(protectedScope?{protectedCatalogHash:RETENTION_PROTECTED_CLOSURE_HASH,installedBinding:protectedScope}:{})}:protectedScope?{protectedCatalogHash:RETENTION_PROTECTED_CLOSURE_HASH,installedBinding:protectedScope}: {functionDefinitionHashes:config.functionDefinitionHashes})};
  let closed=false,current=null,pending=false;const endings=new Set();
  async function waitClosed(){if(!endings.size)return;let timer;try{await Promise.race([Promise.allSettled([...endings]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('RETENTION_CONNECTION_CLOSE_UNKNOWN')),1000);})]);}finally{clearTimeout(timer);}}
  function terminate(state){
    if(!state||state.done)return;state.done=true;clearTimeout(state.timer);state.stream.destroy();if(state.client.connection.stream!==state.stream)state.client.connection.stream.destroy();state.client.password=null;state.client.connectionParameters.password=null;
    const ending=Promise.resolve(state.client.end()).catch(()=>{});endings.add(ending);ending.finally(()=>endings.delete(ending));if(current===state)current=null;
  }
  const owner=Object.freeze({...MARKERS,binding:decoderFreeze({...publicConfig,bindingHash:hash(publicConfig)}),
    async connect(){
      check(!closed,'RETENTION_CONNECTION_CLOSED');check(!current&&!pending,'RETENTION_CONNECTION_BUSY');pending=true;let state;
      try{
        await waitClosed();check(!closed,'RETENTION_CONNECTION_CLOSED');
        if(endpoint.kind==='LOCAL_UNIX'){directory(endpoint.directory);const socket=fs.lstatSync(join(endpoint.directory,'.s.PGSQL.'+endpoint.port));check(socket.isSocket()&&[0,process.getuid()].includes(socket.uid)&&(socket.mode&0o007)===0,'RETENTION_SOCKET_IDENTITY');}
        const password=()=>{check(!closed,'RETENTION_CONNECTION_CLOSED');return secret.toString('utf8');},ssl=endpoint.kind==='LOCAL_UNIX'?false:{rejectUnauthorized:true,ca:endpoint.ca,servername:endpoint.hostname,minVersion:'TLSv1.2'};
        const stream=new net.Socket();let received=0;stream.on('data',bytes=>{received+=bytes.length;if(received>33554432)stream.destroy(failure('RETENTION_DATABASE_RESPONSE_BOUND'));});
        const client=new Client({user:config.role,database:config.database,host:endpoint.kind==='LOCAL_UNIX'?endpoint.directory:endpoint.hostname,port:endpoint.port,password,ssl,stream,binary:false,replication:false,options:'-c search_path=pg_catalog',client_encoding:'UTF8',application_name:'atlas-r2-retention-internal-v1',fallback_application_name:'atlas-r2-retention-internal-v1',statement_timeout:15000,lock_timeout:5000,idle_in_transaction_session_timeout:15000,query_timeout:20000,connectionTimeoutMillis:5000,keepAlive:true,keepAliveInitialDelayMillis:1000,enableChannelBinding:true});
        const p=client.connectionParameters;
        // pg's false/empty fallback can read ambient values. Overwrite the two
        // false-valued fields before opening a socket; all other fields are
        // explicitly nonempty or use pg's explicit SSL/timeout branches.
        p.binary=false;p.replication=false;client.binary=false;client.replication=false;
        check(p.user===config.role&&p.database===config.database&&p.host===(endpoint.kind==='LOCAL_UNIX'?endpoint.directory:endpoint.hostname)&&p.port===endpoint.port&&p.password===password&&client.password===password&&p.ssl===ssl&&client.ssl===ssl&&client.connection.ssl===ssl&&p.options==='-c search_path=pg_catalog'&&p.client_encoding==='UTF8'&&p.application_name==='atlas-r2-retention-internal-v1'&&p.connect_timeout===5&&p.query_timeout===20000&&p.statement_timeout===15000&&p.lock_timeout===5000&&p.idle_in_transaction_session_timeout===15000,'RETENTION_CONNECTION_PARAMETERS');
        state={client,stream,done:false,timer:null};current=state;client.connection.on('sslconnect',()=>client.connection.stream.prependListener('data',bytes=>{received+=bytes.length;if(received>33554432)terminate(state);}));client.on('error',()=>terminate(state));state.timer=setTimeout(()=>terminate(state),60000);state.timer.unref();
        await client.connect();check(!closed&&!state.done,'RETENTION_CONNECTION_CLOSED');
        if(endpoint.kind==='VERIFIED_TLS')check(client.connection.stream.encrypted===true&&client.connection.stream.authorized===true,'RETENTION_TLS_REFUSED');
        if(intakeScope){
          const catalog={};
          for(const [name,sql] of Object.entries(INTAKE_PROTECTED_CATALOG_QUERIES)){
            catalog[name]=(await client.query(sql)).rows;check(Buffer.byteLength(canonicalJSON(catalog))<=262144,'INTAKE_PROTECTED_CATALOG_BOUND');
          }
          if(protectedScope)validateRetentionIntakeProtectedCatalog(catalog);else validateIntakeProtectedCatalog(catalog);
          const rows=(await client.query('SELECT atlas_marketplace.read_intake_configuration_v1() AS configuration')).rows;
          check(rows.length===1&&canonicalJSON(rows[0])===canonicalJSON({configuration:intakeScope}),'INTAKE_PROTECTED_INSTALLATION');
          if(protectedScope){const installed=(await client.query('SELECT atlas_marketplace.read_retention_binding_v1() AS binding')).rows;check(installed.length===1&&canonicalJSON(installed[0])===canonicalJSON({binding:{schema:'atlas-proof-retention-installed-binding-v1',...protectedScope}}),'RETENTION_PROTECTED_BINDING');}
        }else if(protectedScope){
          const catalog={};
          for(const [name,sql] of Object.entries(RETENTION_PROTECTED_CATALOG_QUERIES)){
            catalog[name]=(await client.query(sql)).rows;
            check(Buffer.byteLength(canonicalJSON(catalog))<=262144,'RETENTION_PROTECTED_CATALOG_BOUND');
          }
          validateRetentionProtectedCatalog(catalog);
          const rows=(await client.query('SELECT atlas_marketplace.read_retention_binding_v1() AS binding')).rows;
          check(rows.length===1&&canonicalJSON(rows[0])===canonicalJSON({binding:{schema:'atlas-proof-retention-installed-binding-v1',...protectedScope}}),'RETENTION_PROTECTED_BINDING');
        }else{
        const rows=(await client.query("SELECT p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' AS name,pg_catalog.pg_get_functiondef(p.oid) AS definition FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='atlas_marketplace' AND p.proname=ANY($1::text[])",[['read_state','lock_state','commit_state']])).rows;
        check(rows.length===3&&new Set(rows.map(r=>r.name)).size===3&&rows.every(r=>FUNCTION_NAMES.includes(r.name)&&typeof r.definition==='string'&&Buffer.byteLength(r.definition)<=131072&&sha(Buffer.from(r.definition))===config.functionDefinitionHashes[r.name]),'RETENTION_FUNCTION_DEFINITION');
        }
        let querying=false;
        return Object.freeze({async query(sql,values){
          check(!closed&&!state.done&&!querying,'RETENTION_CONNECTION_UNAVAILABLE');check(typeof sql==='string'&&Buffer.byteLength(sql)<=32768&&(!values||Array.isArray(values)&&values.length<=8&&Buffer.byteLength(canonicalJSON(values))<=16777216),'RETENTION_QUERY_BOUND');querying=true;
          try{return await client.query(sql,values);}catch{terminate(state);throw failure('RETENTION_DATABASE_QUERY_FAILED');}finally{querying=false;}
        },release(){terminate(state);}});
      }catch(error){terminate(state);if(Object.getOwnPropertyDescriptor(error??{},'code')?.value==='RETENTION_CONNECTION_CLOSE_UNKNOWN')closed=true;const code=Object.getOwnPropertyDescriptor(error??{},'code')?.value;throw failure(typeof code==='string'&&/^(?:RETENTION|INTAKE)_[A-Z_]+$/.test(code)?code:'RETENTION_DATABASE_CONNECT_FAILED');}
      finally{pending=false;}
    },
    async close(){closed=true;secret.fill(0);terminate(current);await waitClosed();}
  });owners.add(owner);if(protectedScope)protectedOwners.set(owner,protectedScope);if(intakeScope&&!protectedScope)intakeOwners.add(owner);return owner;
}
