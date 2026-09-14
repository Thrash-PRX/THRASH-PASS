import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('extension/worker.js','utf8');
function harness(settings = {}, response = {choices:[{message:{content:'OK'}}]}) {
  let listener; const calls = []; let captures = 0;
  const event = {addListener(){}};
  const chrome = {
    storage:{local:{get: async defaults => ({...defaults, ...settings})},onChanged:event},
    runtime:{onInstalled:event,onStartup:event,onMessage:{addListener(fn){listener=fn}}},
    contextMenus:{removeAll(cb){cb()},create(){},onClicked:event}, commands:{onCommand:event},
    tabs:{query:async()=>[{id:7}],captureVisibleTab:async()=>{captures++;return 'data:image/png;base64,AA=='},sendMessage:async()=>{}},
    scripting:{executeScript:async()=>[]}
  };
  const context=vm.createContext({chrome,URL,AbortController,setTimeout,clearTimeout,console,
    fetch:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>response}}});
  vm.runInContext(source,context);
  return {context,calls,chrome,get captures(){return captures},
    send:(msg,sender={tab:{id:7,windowId:1}})=>new Promise(resolve=>listener(msg,sender,resolve))};
}
test('Presentation Mode blocks AI, screenshot, and insertion without provider traffic',async()=>{
  const h=harness({presentationMode:true,apiKey:'test-only'});
  for(const action of ['askAI','captureTab','insertIntoPage']) {
    const r=await h.send({action,prompt:'hi',text:'answer'});
    assert.equal(r.ok,false);assert.match(r.error,/Presentation Mode/);
  }
  assert.equal(h.calls.length,0);assert.equal(h.captures,0);
});
test('settings-side connection test stays available in Presentation Mode',async()=>{
  const h=harness({presentationMode:true,provider:'openai',apiKey:'test-only',model:'test-model'});
  assert.equal((await h.send({action:'testAI'},{})).ok,true);assert.equal(h.calls.length,1);
});
test('OpenAI receives text and screenshot and returns plain answer',async()=>{
  const h=harness({provider:'openai',apiKey:'test-only',model:'test-model'});
  const r=await h.send({action:'askAI',prompt:'Explain',imageDataUrl:'data:image/png;base64,AA=='});
  assert.equal(r.answer,'OK');
  const body=JSON.parse(h.calls[0].opts.body);
  assert.equal(body.messages[0].content[1].type,'image_url');assert.equal(body.model,'test-model');
});
test('Gemini payload and response adapter',async()=>{
  const h=harness({apiKey:'test-only'},{candidates:[{content:{parts:[{text:'Gemini OK'}]}}]});
  assert.equal((await h.send({action:'askAI',prompt:'Explain',imageDataUrl:'data:image/png;base64,AA=='})).answer,'Gemini OK');
  assert.equal(JSON.parse(h.calls[0].opts.body).contents[0].parts[1].inline_data.mime_type,'image/png');
});
test('Kimi and custom text adapters work; screenshots fail explicitly',async()=>{
  for(const provider of ['kimi','custom']) {
    const h=harness({provider,apiKey:'test-only',model:'test-model',endpoint:'https://example.test/v1/chat/completions'});
    assert.equal((await h.send({action:'askAI',prompt:'Explain'})).answer,'OK');
    const r=await h.send({action:'askAI',prompt:'Explain',imageDataUrl:'data:image/png;base64,AA=='});
    assert.equal(r.ok,false);assert.match(r.error,/Screenshot requests/);assert.equal(h.calls.length,1);
  }
});
test('screenshot rejects another active tab and unknown sender',async()=>{
  const h=harness();
  assert.equal((await h.send({action:'captureTab'},{tab:{id:8,windowId:1}})).ok,false);
  assert.equal((await h.send({action:'captureTab'},{})).ok,false);assert.equal(h.captures,0);
  assert.equal((await h.send({action:'captureTab'})).ok,true);assert.equal(h.captures,1);
});
test('bad endpoints and missing keys produce useful errors',async()=>{
  for(const endpoint of ['bad url','file:///tmp/key','https://user:pass@example.test']) {
    const h=harness({provider:'custom',apiKey:'test-only',endpoint});
    assert.equal((await h.send({action:'askAI',prompt:'Explain'})).ok,false);assert.equal(h.calls.length,0);
  }
  assert.match((await harness().send({action:'askAI',prompt:'Explain'})).error,/API key/);
});
test('editor targeting rejects sensitive and noneditable inputs, accepts text',async()=>{
  const h=harness();
  class Element {
    constructor(type,disabled=false){this.type=type;this.disabled=disabled;this.tagName='INPUT'}
    matches(sel){if(sel.includes(':disabled'))return this.disabled;if(sel==='input')return true;return false}
    getAttribute(name){return name==='type'?this.type:'1'}
    closest(){return null}
  }
  for(const type of ['password','email','number','text']) {
    const el=new Element(type);
    const page=vm.createContext({Element,document:{querySelectorAll:()=>[el],activeElement:el}});
    h.chrome.scripting.executeScript=async({func})=>[{frameId:0,result:vm.runInContext(`(${func.toString()})()`,page)}];
    const result=await vm.runInContext('findInsertionTarget(7)',h.context);
    assert.equal(Boolean(result),type==='text');
  }
});
