const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(){
    const events={},windowEvents={},timers=new Map();let sequence=0;
    class Img {
        constructor(src){this.src=src;this.isConnected=true;this.rect={top:10,bottom:100};}
        getAttribute(name){return name==='src'?this.src:null;}
        getBoundingClientRect(){return this.rect;}
    }
    const document={baseURI:'https://shopping.abcsepeti.com/',visibilityState:'visible',addEventListener(name,fn){events[name]=fn;}};
    const window={innerHeight:800,addEventListener(name,fn){windowEvents[name]=fn;}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../product-image-recovery.js'),'utf8'),{
        document,window,HTMLImageElement:Img,URL,Date,Math,console:{warn(){}},
        setTimeout(fn){const id=++sequence;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}
    });
    const emit=(name,img)=>events[name]?.({target:img});
    const tick=()=>{const entry=timers.entries().next().value;assert(entry,'Expected retry timer');timers.delete(entry[0]);entry[1]();};
    const exhaust=img=>{for(let i=0;i<12;i++){emit('error',img);if(img.src.startsWith('data:'))return;if(timers.size)tick();}throw new Error('Retries were not bounded');};
    return {Img,document,events,windowEvents,timers,emit,tick,exhaust};
}
const source='https://image-uploader.tc-mehmetcakmak.workers.dev/business/product/photo.webp';
test('retries preserve object path and switch from worker to public storage',()=>{
    const env=setup(),img=new env.Img(source);
    for(let i=0;i<3;i++){env.emit('error',img);env.tick();assert.equal(new URL(img.src).pathname,'/business/product/photo.webp');}
    env.emit('error',img);
    assert.equal(new URL(img.src).hostname,'pub-c51be861a66041fd8d2f5f27349b59ee.r2.dev');
    env.emit('load',img);assert.equal(env.timers.size,0);
});
test('pending background retries show loading, successful load cancels cooldown',()=>{
    const env=setup(),img=new env.Img(source);
    env.exhaust(img);
    assert(decodeURIComponent(img.src).includes('Fotoğraf yükleniyor'));
    env.emit('load',img);assert.equal(env.timers.size,1,'Loading placeholder must not cancel recovery');
    env.tick();assert.equal(new URL(img.src).hostname,'image-uploader.tc-mehmetcakmak.workers.dev');
    env.emit('load',img);assert.equal(env.timers.size,0);
});
test('last scheduled retry skipped offscreen resumes on scroll without consuming its budget',()=>{
    const env=setup(),img=new env.Img(source);
    for(let i=0;i<2;i++){env.exhaust(img);env.tick();}
    env.exhaust(img);img.rect={top:1000,bottom:1100};env.tick();
    assert.equal(env.timers.size,0);
    assert(decodeURIComponent(img.src).includes('Fotoğraf yükleniyor'));
    img.rect={top:10,bottom:100};env.events.scroll();
    assert(img.src.startsWith('https://'));
    env.exhaust(img);
    assert(decodeURIComponent(img.src).includes('Fotoğraf yüklenemedi'));
    env.windowEvents.online();assert(img.src.startsWith('https://'));
});
test('hidden tabs resume and reused or detached images are not overwritten',()=>{
    const env=setup(),img=new env.Img(source);
    env.exhaust(img);env.document.visibilityState='hidden';env.tick();
    assert(img.src.startsWith('data:'));
    env.document.visibilityState='visible';env.events.visibilitychange();assert(img.src.startsWith('https://'));
    env.emit('error',img);img.src='https://example.com/new.webp';env.tick();assert.equal(img.src,'https://example.com/new.webp');
    const detached=new env.Img(source);env.emit('error',detached);detached.isConnected=false;env.tick();assert.equal(detached.src,source);
});
