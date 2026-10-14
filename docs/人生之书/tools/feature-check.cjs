/* 新功能验证：灯·兼现 是否触发 / 存档-续玩 是否无损 */
const fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0];
const captured={};
function mkEl(){return{innerHTML:'',textContent:'',value:'',style:{},dataset:{},disabled:false,className:'',
 classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},appendChild(){},setAttribute(){},remove(){},querySelector(){return null},querySelectorAll(){return []}}}
const store=new Map();
const ctx={console,Math,JSON,Date,RegExp,String,Number,Array,Object,Boolean,Error,parseInt,parseFloat,isNaN,encodeURIComponent,decodeURIComponent,setTimeout:()=>0,clearTimeout:()=>0,fetch:()=>Promise.reject(0),XMLHttpRequest:function(){this.open=()=>{};this.send=()=>{};this.setRequestHeader=()=>{}},
 localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear()},
 document:{getElementById:()=>mkEl(),createElement:()=>mkEl(),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},body:mkEl(),documentElement:mkEl(),readyState:'complete'},
 navigator:{userAgent:'node'},location:{href:'http://x/',reload(){},hash:''},alert(){},prompt:()=>null,confirm:()=>false};
ctx.window=ctx;ctx.globalThis=ctx;ctx.self=ctx;vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'s'});
const {WORLDLINES,newGame,go,choose,afterChoice,next,LAMP_TELL,litBlock,deepLamps,saveGame,loadGame,dropSave,resume,SAVE_KEY}=ctx;

console.log('① LAMP_TELL 条目数: '+(LAMP_TELL?LAMP_TELL.length:0)+' （应为 18）');
console.log('   索引 0 二档文案: '+(LAMP_TELL&&LAMP_TELL[0]&&LAMP_TELL[0][2]?'有':'缺'));
console.log('   索引17 三档文案: '+(LAMP_TELL&&LAMP_TELL[17]&&LAMP_TELL[17][3]?'有':'缺'));

let seed=5;function rnd(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff}
// ② 跑完一局，统计兼现触发
let fired=0, deep=0, sample=null, litTags=0;
for(const wk of Object.keys(WORLDLINES)){
  const per={};
  for(let t=0;t<40;t++){
    newGame(wk);go();let g=0;
    while(ctx.S.phase!=='end'&&g++<300){
      const ph=ctx.S.phase;
      if(ph==='story'){const c=ctx.W.chapters[ctx.S.idx];const a=[];c.choices.forEach((ch,i)=>{if(ch.cond?ch.cond(ctx.S):true)a.push(i)});choose(a.length?a[Math.floor(rnd()*a.length)]:-1)}
      else if(ph==='result')afterChoice();else if(ph==='event')next();else break;
    }
    const tags=Object.keys(ctx.S.lit||{});litTags+=tags.length;
    if(tags.length){fired++; if(!sample)sample={wk,tags:tags.slice(0,3)};}
    const dl=deepLamps();
    if(dl)deep++;
  }
  per.ok=1;
}
console.log('② 40 局×5 线中，有灯升到二/三档的局数: '+fired+' / 200，累计触发 ' + litTags + ' 次兼现');
console.log('   示例: '+(sample?sample.wk+' → '+sample.tags.join(', '):'（无）'));
console.log('③ 出现"亮到最深的灯"板块的局数: '+deep+' / 200');

// ④ 存档-续玩 往返
newGame('origin');go();
const before=JSON.stringify(ctx.S);
saveGame();
const raw=store.get(SAVE_KEY);
console.log('④ 存档写入: '+(raw?'成功（'+raw.length+' 字节）':'失败'));
ctx.S=null;
const d=loadGame();
console.log('   读档: '+(d?'成功，世界线='+d.wl+'，第 '+(d.S.idx+1)+' 章':'失败'));
resume();
const after=JSON.stringify(ctx.S);
console.log('   往返一致: '+(before===after?'是':'否'));
console.log('   S 关键字段: phase='+ctx.S.phase+' idx='+ctx.S.idx+' age='+ctx.S.age+' lit/pending='+(Object.keys(ctx.S.lit||{}).length)+'/'+(ctx.S.pending||[]).length);
console.log('   期间灯谱文案可生成: '+(typeof litBlock()==='string'?'是':'否'));
dropSave();
console.log('   清档后 loadGame: '+(loadGame()===null?'已清空':'仍残留'));
