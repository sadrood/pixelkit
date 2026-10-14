/* 偏币搜索：找出 (coin, core) 的可达前沿，为稀有结局定阈值 */
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
let seed=7;function rnd(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff}
function coinOf(fx){return (fx&&fx.attrs&&fx.attrs.coin)||0}
function lamSum(fx){var n=0;if(fx&&fx.lamps)for(var k in fx.lamps)if(fx.lamps[k]>0)n+=fx.lamps[k];return n}
// bias: 以概率 p 优先选加币且加灯最少的选项
function frontier(wk,p,trials){
  const best={}; // coin -> min core
  for(let t=0;t<trials;t++){
    newGame(wk);go();
    // 强制初始：选"略有薄产"家庭 + "手气不错"天赋（若存在）
    let g=0;
    while(ctx.S.phase!=='end'&&g++<300){
      const ph=ctx.S.phase;
      if(ph==='story'){
        const c=ctx.W.chapters[ctx.S.idx];
        const cand=[];c.choices.forEach((ch,i)=>{if(ch.cond?ch.cond(ctx.S):true){const fx=typeof ch.fx==='function'?ch.fx(ctx.S):ch.fx;cand.push({i,fx})}});
        let pickIdx;
        if(cand.length===0)pickIdx=-1;
        else if(rnd()<p){
          cand.sort((a,b)=>(coinOf(b.fx)-coinOf(a.fx))||(lamSum(a.fx)-lamSum(b.fx)));
          pickIdx=cand[0].i;
        } else pickIdx=cand[Math.floor(rnd()*cand.length)].i;
        choose(pickIdx);
      } else if(ph==='result')afterChoice();
      else if(ph==='event')next(); else break;
    }
    const S=ctx.S,A=S.attrs;
    const core=Object.keys(S.lamps).reduce((s,k)=>s+Math.max(0,S.lamps[k]),0);
    if(best[A.coin]===undefined||core<best[A.coin])best[A.coin]=core;
    if(best[A.coin]>core)best[A.coin]=core;
  }
  return best;
}
for(const wk of Object.keys(WORLDLINES)){
  const f=frontier(wk,0.9,3000);
  const rows=Object.keys(f).map(Number).sort((a,b)=>a-b).map(c=>'coin '+c+' → core 最小 '+f[c]);
  console.log('● '+wk);
  rows.filter(r=>{const c=+r.match(/coin (\d+)/)[1];return c>=6}).forEach(r=>console.log('    '+r));
}
