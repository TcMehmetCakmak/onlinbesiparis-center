const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createProductListPager}=require('../product-list-pagination.js');
class Element {
    constructor(){this.children=[];this.parentNode=null;this.events={};this.scrollTop=0;this.scrollHeight=1000;this.clientHeight=400;}
    addEventListener(name,fn){this.events[name]=fn;}
    removeEventListener(name,fn){if(this.events[name]===fn)delete this.events[name];}
    insertBefore(node,before){node.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,node);node.parentNode=this;}
    appendChild(node){this.insertBefore(node,null);}
    remove(){if(this.parentNode){const parent=this.parentNode;parent.children.splice(parent.children.indexOf(this),1);this.parentNode=null;}}
}
function setup(t,withObserver){
    const originalDocument=global.document,originalObserver=global.IntersectionObserver;
    global.document={createElement:()=>new Element()};
    const observers=[];
    global.IntersectionObserver=withObserver?class {
        constructor(callback,options){this.callback=callback;this.options=options;this.disconnected=false;observers.push(this);}
        observe(){}
        unobserve(){}
        disconnect(){this.disconnected=true;}
    }:undefined;
    t.after(()=>{global.document=originalDocument;global.IntersectionObserver=originalObserver;});
    return observers;
}
const renderItem=id=>Object.assign(new Element(),{id});
const cards=list=>list.children.filter(node=>node.id!==undefined);
test('12 initial cards, then 6 at a time, stable cards, no duplicates, final short batch',t=>{
    const observers=setup(t,true),list=new Element(),items=Array.from({length:23},(_,i)=>i);
    const pager=createProductListPager({list,items,renderItem});
    assert.equal(pager.renderedCount,12);
    const first=cards(list)[0];
    assert.equal(observers[0].options.root,list);
    observers[0].callback([{isIntersecting:false}]);assert.equal(pager.renderedCount,12);
    observers[0].callback([{isIntersecting:true}]);assert.equal(pager.renderedCount,18);
    assert.equal(cards(list)[0],first);
    observers[0].callback([{isIntersecting:true}]);assert.equal(pager.renderedCount,23);
    pager.loadMore();
    assert.deepEqual(cards(list).map(node=>node.id),items);
    assert.equal(list.children.length,23);assert(observers[0].disconnected);
    pager.destroy();
});
test('filter reset disconnects old callbacks and starts new results at 12',t=>{
    const observers=setup(t,true),list=new Element();
    const pager=createProductListPager({list,items:Array.from({length:40},(_,i)=>i),renderItem});
    pager.loadMore();pager.destroy();
    for(const child of [...list.children])child.remove();
    const next=createProductListPager({list,items:Array.from({length:16},(_,i)=>100+i),renderItem});
    observers[0].callback([{isIntersecting:true}]);
    assert.equal(next.renderedCount,12);
    assert.deepEqual(cards(list).map(node=>node.id),Array.from({length:12},(_,i)=>100+i));
    next.destroy();
});
test('short and empty lists have no more control; fallback scroll and click load batches',t=>{
    setup(t,false);
    for(const count of [0,1,6,12]){
        const list=new Element();const pager=createProductListPager({list,items:Array.from({length:count},(_,i)=>i),renderItem});
        assert.equal(list.children.length,count);pager.destroy();
    }
    const list=new Element();const pager=createProductListPager({list,items:Array.from({length:30},(_,i)=>i),renderItem});
    list.scrollTop=610;list.events.scroll();assert.equal(pager.renderedCount,18);
    list.children.at(-1).events.click();assert.equal(pager.renderedCount,24);
    pager.destroy();assert.equal(list.events.scroll,undefined);
    pager.loadMore();assert.equal(pager.renderedCount,24);
});
