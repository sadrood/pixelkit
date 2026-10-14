/* 验证《金灯无芯》在"刻意逐利"打法下是否真的可达 */
const fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0];
function mkEl(){return{innerHTML:'',textContent:'',value:'',style:{},dataset:{},disabled:false,classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},appendChild(){},setAttribute(){},querySelector(){return null},querySelectorAll(){return []}}}
const store=new Map();
const ctx={console,Math,JSON,Date,RegExp,String,Number,Array,Object,Boolean,Error,parseInt,parseFloat,isNaN,encodeURIComponent,decodeURIComponent,setTimeout:()=>0,clearTimeout:()=>0,fetch:()=>Promise.reject(0),XMLHttpRequest:function(){this.open=()=>{};this.send=()=>{};this.setRequestHeader=()=>{}},
 localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear()},
 document:{getElementById:()=>mkEl(),createElement:()=>mkEl(),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},body:mkEl(),documentElement:mkEl(),readyState:'complete'},
 navigator:{userAgent:'node'},location:{href:'http://x/',reload(){},hash:''},alert(){},prompt:()=>null,confirm:()=>false};
ctx.window=ctx;ctx.globalThis=ctx;ctx.self=ctx;vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'s'});
const {WORLDLINES,newGame,go,choose,afterChoice,next}=ctx;
let seed=99;function rnd(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff}
const coinOf=fx=>(fx&&fx.attrs&&fx.attrs.coin)||0;
const lamSum=fx=>{let n=0;if(fx&&fx.lamps)for(const k in fx.lamps)if(fx.lamps[k]>0)n+=fx.lamps[k];return n};
function play(wk,p){
  newGame(wk);go();let g=0;
  while(ctx.S.phase!=='end'&&g++<300){
    const ph=ctx.S.phase;
    if(ph==='story'){
      const c=ctx.W.chapters[ctx.S.idx];const cand=[];
      c.choices.forEach((ch,i)=>{if(ch.cond?ch.cond(ctx.S):true){const fx=typeof ch.fx==='function'?ch.fx(ctx.S):ch.fx;cand.push({i,fx})}});
      let pi;
      if(!cand.length)pi=-1;
      else if(rnd()<p){cand.sort((a,b)=>(coinOf(b.fx)-coinOf(a.fx))||(lamSum(a.fx)-lamSum(b.fx)));pi=cand[0].i}
      else pi=cand[Math.floor(rnd()*cand.length)].i;
      choose(pi);
    } else if(ph==='result')afterChoice(); else if(ph==='event')next(); else break;
  }
  const S=ctx.S,A=S.attrs;
  const core=Object.keys(S.lamps).reduce((s,k)=>s+Math.max(0,S.lamps[k]),0);
  return {title:S.result?S.result.end.title:'(stuck)',coin:A.coin,core};
}
const N=2500;
console.log('逐利打法（p 越高越无视灯芯地攒钱）\n');
for(const wk of Object.keys(WORLDLINES)){
  const line=[];
  for(const p of [0.5,0.8,0.95]){
    let gold=0;const coinHist={};
    for(let i=0;i<N;i++){const r=play(wk,p);if(r.title==='金灯无芯')gold++;coinHist[r.coin]=(coinHist[r.coin]||0)+1}
    const hi=Object.keys(coinHist).map(Number).sort((a,b)=>b-a)[0];
    line.push('p='+p+' → 金灯无芯 '+(gold/N*100).toFixed(2)+'% (最高 coin '+hi+')');
  }
  console.log('● '+wk+'\n    '+line.join('\n    '));
}
