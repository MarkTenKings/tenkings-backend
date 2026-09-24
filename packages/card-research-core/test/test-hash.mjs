import {createHash} from 'node:crypto';
export const canonical=value=>JSON.stringify(sort(value));function sort(value){return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])])):value;}
export const inventoryHash=value=>createHash('sha256').update(canonical(value)).digest('hex');
