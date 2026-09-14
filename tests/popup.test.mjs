import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('provider switch clears old credentials/endpoint and selects provider model',async()=>{
  const nodes = Object.fromEntries(['provider','apiKey','model','endpoint','presentationMode','modelList','refreshModels','save','test','status'].map(id=>[id,{value:'',addEventListener(event,fn){this[event]=fn},replaceChildren(){},appendChild(){}}]));
  const context=vm.createContext({document:{getElementById:id=>nodes[id]},chrome:{storage:{local:{get:async d=>d,set:async()=>{}}},runtime:{sendMessage:async()=>({ok:true})}}});
  vm.runInContext(fs.readFileSync('extension/popup.js','utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  nodes.provider.value='openai';nodes.apiKey.value='old-test-key';nodes.endpoint.value='https://old.test';
  nodes.provider.change();
  assert.equal(nodes.apiKey.value,'');assert.equal(nodes.endpoint.value,'');assert.equal(nodes.model.value,'gpt-4o-mini');
});
