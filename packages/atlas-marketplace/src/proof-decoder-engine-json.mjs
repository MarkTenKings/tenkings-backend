import {createHash} from 'node:crypto';
import {requireValue} from './contract.mjs';

export const ENGINE_JSON_BYTES=262144;
export const engineBytesHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=value=>requireValue(value,'DECODER_ENGINE_JSON_INVALID');

// Engine JSON is not canonical JSON. Check duplicates (including escaped key
// aliases) while parsing, without retaining or reporting rejected body text.
export function parseProofDecoderEngineJSON(bytes,{maxBytes=ENGINE_JSON_BYTES}={}) {
  check(Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=ENGINE_JSON_BYTES);
  check(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=maxBytes);
  try {
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    let at=0,nodes=0;
    const whitespace=()=>{while(at<text.length&&/[\x20\t\r\n]/.test(text[at]))at++;};
    const string=()=>{
      check(text[at]==='"');const start=at++;let escaped=false;
      while(at<text.length){const char=text[at++];if(escaped){escaped=false;continue;}if(char==='\\'){escaped=true;continue;}if(char==='"'){const value=JSON.parse(text.slice(start,at));check(value.length<=65536);return value;}check(char.charCodeAt(0)>=32);}
      check(false);
    };
    const value=depth=>{
      check(depth<=12&&++nodes<=16384);whitespace();const char=text[at];
      if(char==='"')return string();
      if(char==='{'){
        at++;whitespace();const result={},keys=new Set();if(text[at]==='}'){at++;return result;}
        for(;;){whitespace();const key=string();check(!keys.has(key)&&!['__proto__','prototype','constructor'].includes(key));keys.add(key);whitespace();check(text[at++]===':');result[key]=value(depth+1);whitespace();const next=text[at++];if(next==='}')return result;check(next===',');}
      }
      if(char==='['){at++;whitespace();const result=[];if(text[at]===']'){at++;return result;}for(;;){result.push(value(depth+1));whitespace();const next=text[at++];if(next===']')return result;check(next===',');}}
      for(const [token,result] of [['true',true],['false',false],['null',null]])if(text.startsWith(token,at)){at+=token.length;return result;}
      const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));check(match);at+=match[0].length;const number=Number(match[0]);check(Number.isFinite(number));return number;
    };
    const result=value(0);whitespace();check(at===text.length);return result;
  }catch{check(false);}
}

// Whitespace-only compaction preserves the exact numeric/string lexemes in the
// approved artifact. JSON.parse/stringify could round a large integer literal.
export function compactProofDecoderEngineJSON(bytes,options) {
  parseProofDecoderEngineJSON(bytes,options);
  let compact='',inString=false,escaped=false;
  for(const char of bytes.toString('utf8')){
    if(inString){compact+=char;if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')inString=false;}
    else if(char==='"'){inString=true;compact+=char;}
    else if(!/[\x20\t\r\n]/.test(char))compact+=char;
  }
  return compact;
}

// These options intentionally contain only plain own data properties. Buffers
// remain outside decoderContractData, which correctly refuses exotic objects.
export function engineDataOptions(input,required,optional=[]) {
  check(input&&Object.getPrototypeOf(input)===Object.prototype);
  const descriptors=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(descriptors);
  check(keys.every(key=>typeof key==='string'&&[...required,...optional].includes(key)&&descriptors[key].enumerable&&Object.hasOwn(descriptors[key],'value')));
  check(required.every(key=>Object.hasOwn(descriptors,key)));
  return Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
}
