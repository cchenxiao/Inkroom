import '@testing-library/jest-dom/vitest';
import {cleanup} from '@testing-library/react';
import {afterEach} from 'vitest';
afterEach(()=>cleanup());
class ResizeObserverMock { observe(){} unobserve(){} disconnect(){} }
class IntersectionObserverMock { root=null;rootMargin='';thresholds=[];constructor(private callback:IntersectionObserverCallback){}observe(target:Element){this.callback([{isIntersecting:true,target} as IntersectionObserverEntry],this as unknown as IntersectionObserver);}unobserve(){}disconnect(){}takeRecords(){return [];}}
globalThis.ResizeObserver=ResizeObserverMock;
globalThis.IntersectionObserver=IntersectionObserverMock;
if(typeof Element!=='undefined')Element.prototype.scrollIntoView=()=>{};
if(typeof window!=='undefined')window.matchMedia=window.matchMedia||(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return false;},media:'',onchange:null}));
