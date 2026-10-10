import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalizeNewSpeedsterSessionIdentity, canonicalizeSpeedsterSessionIdentity } from '../dist/identity.js';

test('optional metadata retains unknowns without manufacturing identity evidence',()=>{
  const sports=canonicalizeNewSpeedsterSessionIdentity('SPORTS',{playerName:'Player',year:'',manufacturer:' ',productSet:'Set'});
  assert.equal(sports.year,null);assert.equal(sports.manufacturer,null);
  const pokemon=canonicalizeNewSpeedsterSessionIdentity('POKEMON',{cardName:'Pikachu',year:null,productSet:'151',layoutType:'POKEMON',manufacturer:'Pokémon'});
  assert.equal(pokemon.year,null);assert.equal(pokemon.manufacturer,'Pokémon');
  for(const identity of [{...sports,playerName:''},{...sports,productSet:''}])assert.throws(()=>canonicalizeNewSpeedsterSessionIdentity('SPORTS',identity));
  assert.throws(()=>canonicalizeNewSpeedsterSessionIdentity('POKEMON',{cardName:'Pikachu',productSet:'151'}));
});

test('existing canonical identity bytes and hashes stay unchanged without an optional Pokémon manufacturer',()=>{
  for(const [profile,identity] of [
    ['SPORTS',{playerName:'Player',year:'2023',manufacturer:'Panini',productSet:'Prizm',parallel:null,insert:null,cardNumber:'1'}],
    ['POKEMON',{cardName:'Pikachu',year:'2023',productSet:'151',parallel:null,cardNumber:'025/165',layoutType:'POKEMON'}],
    ['POKEMON',{cardName:'Historical',year:'1999',productSet:'Base',parallel:null,cardNumber:null}],
  ]){
    const before=JSON.stringify(identity),after=JSON.stringify(canonicalizeSpeedsterSessionIdentity(profile,identity));
    assert.equal(after,before);assert.equal(createHash('sha256').update(after).digest('hex'),createHash('sha256').update(before).digest('hex'));
    if(profile==='POKEMON')assert.equal(Object.hasOwn(JSON.parse(after),'manufacturer'),false);
  }
});
