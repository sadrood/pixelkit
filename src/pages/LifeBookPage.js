// 人生之书 · 玩法加厚版 v2 —— 站点页面引擎
// 由 docs/人生之书/index.html 源码级切分移植（逻辑与原版一致），仅做站点适配：
//   ① 公共数据在 ./life/book/data.js，五条世界线各自在 ./life/book/lines/<key>.js（按需动态加载）
//   ② 样式作用域 .pkb（src/styles/life-book.css）
//   ③ 存档/AI 键名加 pkbook2_ 前缀；④ AI 走服务端 /api/agent/book-ai（流式）；⑤ 行内 onclick 走 window.__pkBook
// 原型的自测工具仍可用于回归：docs/人生之书/tools/*.cjs（跑的是原型单文件）
import { BUCKETS, ACHS, LAMP_TELL, FAMILIES, TALENTS, LINE_META, loadLine } from './life/book/data.js';

const H = { mkEnd, pick, sumLamps };
/* 按需加载：WORLDLINES 在玩家真的选某条线时才填充（首屏只下载 meta + 本页引擎） */
const WORLDLINES = {};
async function ensureLine(wk){
  if(!LINE_META[wk]) throw new Error('未知世界线: ' + wk);
  if(!WORLDLINES[wk]) WORLDLINES[wk] = await loadLine(wk, H);
  return WORLDLINES[wk];
}


/* ============================================================
   人生之书 · 玩法加厚版 v2
   引擎：五维属性 + 18灯谱 + 随机人生事件 + 抉择锁 + 成就图鉴 + 二周目回响
   ============================================================ */

/* ---------- 存档（跨局：图鉴 / 成就 / 回响） ---------- */
var META_KEY='pkbook2_meta';
var META={codex:{lamps:{},endings:{},events:{}},ach:{},echoes:0,runs:0,lastEpitaph:''};
try{var _m=localStorage.getItem(META_KEY);if(_m)META=Object.assign(META,JSON.parse(_m));}catch(e){}
function saveMeta(){try{localStorage.setItem(META_KEY,JSON.stringify(META));}catch(e){}}

/* ---------- 结局分桶（按灯谱序号，跨世界线通用） ----------
   序号：0念 1担 2守 3孝 4欠 5融 | 6路 7踮 8远 9滚 10追 11桥 | 12藏 13痴 14诚 15暖 16归 17传 */

function pickBucket(ctx,w){
  var best=BUCKETS[6],bs=-1,bm=w.lamps[0];
  for(var i=0;i<BUCKETS.length;i++){
    var b=BUCKETS[i],s=0,mx=-9,mk=w.lamps[b.ix[0]];
    for(var j=0;j<b.ix.length;j++){
      var k=w.lamps[b.ix[j]],v=ctx.lamps[k]||0;
      s+=v; if(v>mx){mx=v;mk=k;}
      if(v>=2)s+=1.5;
    }
    if(s>bs){bs=s;best=b;bm=mk;}
  }
  return {id:best.id,main:bm};
}

/* ---------- v2.4 玩法层①：灯火道标 · 命格偏置 ----------
   灯只由「人工写的 fx」点亮，AI 不参与——所以"想点某盏灯"必须靠玩家的选择，
   道标能帮的只有两件事：① 出身与天赋往那盏灯的方向偏一手（不做保底）；
   ② 开局在序章注明这局的暗灯是哪盏。命中与否仍旧看你怎么选。 */
var LAMP_AFFINITY=[
  {a:['men']},        /* 0 念 */ {a:['vit','soc']},   /* 1 担 */ {a:['men','vit']},   /* 2 守 */
  {a:['soc','men']},  /* 3 孝 */ {a:['coin','men']},  /* 4 欠 */ {a:['soc','arc']},   /* 5 融 */
  {a:['vit','arc']},  /* 6 路 */ {a:['men','vit']},   /* 7 踮 */ {a:['arc','soc']},   /* 8 远 */
  {a:['vit','men']},  /* 9 滚 */ {a:['arc','coin']},  /* 10 追 */{a:['soc','men']},   /* 11 桥 */
  {a:['coin','men']}, /* 12 藏 */{a:['men','arc']},   /* 13 痴 */{a:['soc','arc']},   /* 14 诚 */
  {a:['soc','men']},  /* 15 暖 */{a:['men','coin']},  /* 16 归 */{a:['arc','soc']},   /* 17 传 */
];
/* 注意：每条世界线的 18 盏灯各有各的字（origin 是「念担守…」，cyber 是「频载驻…」），
   所以界面上显示的灯名一律用 lampName() 从世界线自己的 lamps 里取，
   下面这套只用于「跨世界线通用的语义词」（前尘缺口、旧账卡这类跨线叙述）。 */
var BEACON_WORDS=['念','担','守','孝','欠','融','路','踮','远','滚','追','桥','藏','痴','诚','暖','归','传'];
/* 序号 → 某条世界线上这盏灯真正的名字。
   两种取值环境都要照顾到：
     · 生成页：世界线是按需加载的，首屏（选道标那一刻）W 还是空的，所以走 LAMP_SET 查表；
     · 原型单文件：没有 LAMP_SET，直接读已注册的世界线数据。
   传 wk 或不传（默认当前世界线）都可以。 */
var LAMP_SET=(function(){
  try{ if(typeof LINE_META!=='undefined'&&LINE_META)return LINE_META; }catch(e){}
  return null;
})();
/* 世界线的"轻量元数据"视图。
   生成页里世界线是按需加载的：首屏 WORLDLINES 是空的，只有 LINE_META 可用，
   所以开始界面（含道标选择器）的循环与灯名一律走 metaOf()；原型单文件则走已注册的 WORLDLINES。 */
function metaOf(wk){
  if(LAMP_SET&&wk&&LAMP_SET[wk])return LAMP_SET[wk];
  if(typeof WORLDLINES!=='undefined'&&WORLDLINES[wk])return WORLDLINES[wk];
  return null;
}
function metaKeys(){
  if(LAMP_SET)return Object.keys(LAMP_SET);
  return (typeof WORLDLINES!=='undefined')?Object.keys(WORLDLINES):[];
}
function lampName(ix,wk){
  var key=wk||(typeof W!=='undefined'&&W&&W.key?W.key:'');
  if(LAMP_SET&&key&&LAMP_SET[key]&&LAMP_SET[key].lamps&&LAMP_SET[key].lamps[ix]!=null)
    return LAMP_SET[key].lamps[ix];
  var w=(typeof WORLDLINES!=='undefined'&&key)?WORLDLINES[key]:null;
  if(w&&w.lamps&&w.lamps[ix]!=null)return w.lamps[ix];
  if(typeof W!=='undefined'&&W&&W.lamps&&W.lamps[ix]!=null)return W.lamps[ix];
  return BEACON_WORDS[ix]||'?';
}
/* 灯的语义词：缺口那句"你始终没能点着【X】"要跨世界线读得通，用通用词而不是各线自己的字 */
function lampWord(ix){ return BEACON_WORDS[ix]||'?'; }

/* ---------- v2.4 玩法层⑥：寿数（年龄第一次有了后果） ----------
   设计稿：docs/人生之书/年龄维度-设计稿.md（阈值按实测定，不是拍的）
   为什么挂在「累计寿数偏移」而不是体魄：实测减体魄 20 处、加体魄只有 19 处且多集中在第 3 章，
   拿体魄当生死闸时乱点策略 15.14% 暴毙——那等于随机杀人。累计偏移可复现、可解释、玩家看得见。 */
var YEARS_SELF=2;       /* 抉择明写的 years 字段优先 */
var YEARS_CAP=6;        /* 偏移上限：不能让"养生流"活到一百三 */
var AGE_WHITE=74;       /* 未及白首：没走到该走到的岁数 */
var AGE_DRY=83;         /* 灯尽油枯：活过了本该活的岁数（定 81 时乱点命中 25%，太密；83 在 p90 之上） */
var AGE_NOMINAL=78;     /* 第十二章名义年龄，用来在结局页显示"本该活到" */
var AGE_EARLY_FROM=40;  /* 从这一章起才可能早夭：少年不算 */
var AGE_EARLY_TO=55;    /* 早夭上限：过了这个岁数就不是"没熬过去"，而是"没活到白首"（给白首段留出 56~74） */
var AGE_EARLY_SHIFT=-5; /* 早夭阈值：偏移跌到这儿就活不到终章（定 -6 时实测不可达，-4 时又吃掉了白首段） */
/* 默认折算：没写 years 的抉择，加体魄 +2、减体魄 -1，其余 0。
   寿命必须是"少数选择累积出来的结果"——大多数抉择不动它。 */
function yearsForChoice(ch){
  if(!ch)return 0;
  if(ch.years)return ch.years;
  var a=(ch.fx&&ch.fx.attrs)||{};
  if(a.vit>0)return YEARS_SELF;
  if(a.vit<0)return -1;
  return 0;
}
function applyYears(y){ if(!y)return; S.lifeShift=(S.lifeShift||0)+y; if(S.lifeShift>YEARS_CAP)S.lifeShift=YEARS_CAP;
  if(S.delta)S.delta.yrs=(S.delta.yrs||0)+y; }
/* 进入第 i 章时的岁数 = 该章名义年龄 + 累计偏移。第 0 章不加偏移（幼年不该被后半程的选择影响） */
function chapterAge(i){ var c=(W&&W.chapters)?W.chapters[i]:null; return (c?c.age:0)+((i>0)?(S.lifeShift||0):0); }
/* 结局页要读：本局实际寿数（没走到终章就是当场那个岁数） */
function finalAge(){ return S.endAge!=null?S.endAge:(S.age||0); }
/* 灯与灯是有对位的：点着一盏，常常意味着另一盏没被点着。
   所以道标只针对「点亮」，绝不削弱任何稀有结局的阈值——独照、金灯无芯那些照旧靠选择打出来。 */
function beaconNameIx(ix){ return lampName(ix); }
/* 第 0 章渲染序章时用：本局暗着的目标灯是哪盏（只做提示，不加任何数值） */
function beaconDarkNote(){
  if(!S||!S.beacon||!S.beacon.length||!W||!W.lamps)return '';
  var miss=[];
  for(var i=0;i<S.beacon.length;i++){var ix=S.beacon[i];if((S.lamps[W.lamps[ix]]||0)<=0)miss.push(lampName(ix));}
  return miss.length?miss.join('、'):'';
}
/* 命格偏置：把出身与天赋各多抽几次，挑一组与该灯相性最好的（仍然随机，只是偏一手） */
function rollBiasedStart(w,targetIx){
  var pool=w.families||FAMILIES,pool2=w.talents||TALENTS;
  var aff=LAMP_AFFINITY[targetIx]||{a:[]};
  function score(f,t){
    var s=0;
    for(var i=0;i<aff.a.length;i++){
      var k=aff.a[i];
      s+=((f&&f.fx&&f.fx[k])||0)*2+((t&&t.fx&&t.fx[k])||0);
    }
    return s;
  }
  var bf=null,bt=null,bs=-1;
  for(var n=0;n<6;n++){
    var f=pick(pool),t=pick(pool2),s=score(f,t);
    if(s>bs){bs=s;bf=f;bt=t;}
    if(bs>=3)break;                       /* 已经够贴了就不再抽，避免变成"指定出身" */
  }
  return {family:bf,talent:bt,score:bs};
}

/* 道标的跨局状态：选中的只是"这局往哪盏灯使劲"，不锁抽签、不改任何判定 */
var pendingBeacon=null;
function beaconToggle(wk,ix){
  var want=(pendingBeacon&&pendingBeacon[0]===wk&&pendingBeacon[1]===ix)?null:[wk,ix];
  pendingBeacon=want; META.beacon=want; saveMeta(); render();
}
function beaconClear(){ pendingBeacon=null; META.beacon=null; saveMeta(); render(); }
function beaconStat(wk,ix){
  var by=(META.beaconStats&&META.beaconStats.byLamp)||{};
  return by[wk+'#'+ix]||0;   /* 这条世界线上，这盏灯被"立过道标且点着"的次数 */
}

/* ---------- v2.5 玩法层⑤：回头账（中局反转） ----------
   前十一章攒下的 flags 过去只是结算时的描述，现在它会在第七章兑现一次：
   这一段人生回过头来找你，**换掉后半程的走法**（给一盏灯 + 改三四个属性），
   而不是只给一点数值。这样"结局"不再只在最后一章才被决定。
   约束：一局只兑现一张；文案跨世界线通用（不用各线的专有名词），灯按名称给，五线都能用。 */
var CALLBACKS=[
  {id:'cb_parent', pri:1, need:function(S){return S.flags.no_goodbye&&!S.flags.father_alive;},
   n:'回 头 账',
   text:'父亲走的那年，你没有赶上。这件事你后来很少提，但它一直在。',
   t:'第七年，你在旧物里翻出一张没寄出去的信纸，抬头是你的名字。你按上面的地址找过去，那户人家早搬走了，邻居说他临终前念叨过一个"没回来"的孩子。',
   fx:{lamps:{'归':1},attrs:{men:-1}}},
  {id:'cb_fired', pri:2, need:function(S){return !!S.flags.fired;},
   n:'回 头 账',
   text:'被裁那阵子你以为自己完了。后来才知道，那是这辈子里少有的、可以重新选一次的窗口。',
   t:'第七年，旧厂的老同事找上门，说新东家缺个懂行的，问你要不要回去。你想起当年那张写着你名字的名单被挪到最后一栏，最后只说了一句：我考虑两天。',
   fx:{lamps:{'路':1},attrs:{arc:1,vit:-1}}},
  {id:'cb_ill', pri:2, need:function(S){return !!S.flags.sick;},
   n:'回 头 账',
   text:'那场病之后，你才第一次认真想"还能活多久"这件事。',
   t:'第七年，体检单上又出现一行让你停顿的字。你去复查，等结果的那两个小时，你把这几十年从头到尾过了一遍——发现真正记住的没几件事。',
   fx:{lamps:{'念':1},attrs:{vit:-1,men:1}}},
  {id:'cb_home', pri:2, need:function(S){return !!S.flags.back_home;},
   n:'回 头 账',
   text:'你回过一次老家。那次之后你总觉得自己还会再回去，可你没有。',
   t:'第七年，老屋那条巷子要拆了。你赶回去，在门口站了很久，最后只从墙上揭下半张旧年画。你把它卷起来带回城里，夹在一本书里。',
   fx:{lamps:{'守':1},attrs:{men:1}}},
  {id:'cb_south', pri:2, need:function(S){return !!S.flags.south;},
   n:'回 头 账',
   text:'你往南走过。走得越远，越发现有些东西是带不走的。',
   t:'第七年，南边那间租屋的房东托人捎话，说房子要卖了，问你还回不回去看一眼。你算了算路费，最后没去，只让人把你留下的那口箱子寄了过来。',
   fx:{lamps:{'远':1},attrs:{soc:-1,arc:1}}},
  {id:'cb_job', pri:2, need:function(S){return !!S.flags.quit_job;},
   n:'回 头 账',
   text:'辞掉的那份工，你后来想过很多次：如果当时忍一忍，会不会不一样。',
   t:'第七年，你在街上碰到当年替你办离职的那位。他说现在那边换了人，问你要不要回去。你说不用了——说完你自己也愣了一下，原来这句话你早就想好了。',
   fx:{lamps:{'追':1},attrs:{coin:-1,men:1}}},
  {id:'cb_tech', pri:2, need:function(S){return !!S.flags.tech;},
   n:'回 头 账',
   text:'你学的那门手艺，最初只是为了有口饭吃。',
   t:'第七年，有人出高价请你去做一件"不一定成"的活，条件是把你以前的路全放下。你把手上的活赶完，才回他：那就试试。',
   fx:{lamps:{'传':1},attrs:{arc:1,coin:-1}}},
  {id:'cb_married', pri:2, need:function(S){return !!S.flags.married;},
   n:'回 头 账',
   text:'成家那天你以为日子从此有了锚。后来才知道，锚也会被浪扯着走。',
   t:'第七年，家里为一件小事吵了很久。夜里你起来喝水，看见桌上留着一碗给你温着的饭，忽然就不想争了。你把碗端起来，站着吃完了。',
   fx:{lamps:{'暖':1},attrs:{soc:1,men:1}}}
];
function callbackFor(){
  if(!S.flags)return null;
  var cands=CALLBACKS.filter(function(c){try{return c.need(S);}catch(e){return false;}});
  if(!cands.length)return null;
  cands.sort(function(a,b){return a.pri-b.pri;});
  return cands[0];
}

/* ---------- v2.5 玩法层④：灯的对立（选择第一次有了真正的"舍"） ----------
   18 盏灯按序号跨线通用，所以对立对按序号声明即可，五条线自动共用同一套语义。
   规则：一对里只要有一盏点到了二档，另一盏就**封顶在一档**——不是掉级，是点不上去。
   硬约束：对立对必须跨"结局桶"（BUCKETS）。同桶互斥会把某条结局线的等级和压死，
   让那个结局变成打不出来的死结局——所以每对都跨桶，且不改任何阈值。
   为什么需要它：没有对立时，点着【远】不妨碍点着【孝】，中段十个抉择的信息量很低
   （反正每个选项都能点一盏灯）。有了舍，才谈得上"这一生你选了哪一边"。 */
var LAMP_FOES=[
  [6,2],    /* 路 ↔ 守：走出去的人，守不住那间屋 */
  [8,3],    /* 远 ↔ 孝：离得越远，尽孝越难 */
  [9,14]    /* 滚 ↔ 诚：活得滚烫的人，往往不肯说实话 */
];
function lampPairIdx(ix){
  for(var i=0;i<LAMP_FOES.length;i++){
    if(LAMP_FOES[i][0]===ix)return LAMP_FOES[i][1];
    if(LAMP_FOES[i][1]===ix)return LAMP_FOES[i][0];
  }
  return -1;
}
/* 某一刻起，哪些灯被压住了（用于侧栏显示与提示） */
function lampCaps(){
  var out=[];
  (W&&W.lamps?W.lamps:[]).forEach(function(k,ix){
    var foe=lampPairIdx(ix);
    if(foe<0)return;
    var fk=W.lamps[foe];
    if(fk&&(S.lamps[fk]||0)>=2)out.push({k:k,ix:ix,by:fk});
  });
  return out;
}
function lampCapped(k){
  var c=lampCaps();
  for(var i=0;i<c.length;i++)if(c[i].k===k)return c[i];
  return null;
}


function grant(id){
  if(META.ach[id])return;
  META.ach[id]=1;saveMeta();
  var a=ACHS.filter(function(x){return x.id===id})[0];
  if(a)toast('成就达成 · '+a.n);
}
function toast(t){
  var d=document.createElement('div');d.className='toast';d.textContent=t;
  (root||document.body).appendChild(d);setTimeout(function(){d.remove()},2600);
}

/* ---------- 当前局自动存档（关掉页面也不丢这一生） ---------- */
var SAVE_KEY='pkbook2_save';
function saveGame(){
  try{
    if(!S)return;
    if(S.phase!=='end')localStorage.setItem(SAVE_KEY,JSON.stringify({v:2,wl:S.wl,S:S}));
    else localStorage.removeItem(SAVE_KEY);
  }catch(e){}
}
function loadGame(){
  try{var d=JSON.parse(localStorage.getItem(SAVE_KEY));if(!d||!d.S||!LINE_META[d.wl])return null;return d;}catch(e){return null}
}
function dropSave(){try{localStorage.removeItem(SAVE_KEY)}catch(e){}}
async function resume(){
  var d=loadGame();if(!d)return;
  try{ await ensureLine(d.wl); }catch(e){ toast('世界线加载失败'); return; }
  W=WORLDLINES[d.wl];S=d.S;
  S.pending=S.pending||[];S.lit=S.lit||{};S.seen=S.seen||{};S.peeked=S.peeked||{};
  render();
}

/* ---------- 点灯即时反馈：右上角浮出「灯 · 念 +」 ---------- */
function flashLamps(list){
  try{
    if(!root)return;
    var box=document.getElementById('lampFlash');
    if(!box){box=document.createElement('div');box.id='lampFlash';box.className='lampflash';(root||document.body).appendChild(box);}
    list.forEach(function(txt,i){
      var s=document.createElement('span');s.className='lf';s.textContent='灯 · '+txt;
      box.appendChild(s);
      setTimeout(function(){try{s.remove()}catch(e){}},1400+i*130);
    });
  }catch(e){}
}

/* ---------- 工具 ---------- */
function pick(a){return a[Math.floor(Math.random()*a.length)]}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
/* 模型返回的文本一律转义后再进 DOM（可换行） */
function escML(s){return esc(s).replace(/\n+/g,'<br>')}
var S=null, W=null;




/* ============================================================
   世界线 A：小城浮世（原版加厚）
   ============================================================ */

/* ============================================================
   灯·兼现：某一盏灯点到「二档 / 三档」时，解锁一段专属正文。
   索引顺序与所有世界线一致（0思念·1承担·2守护·3孝·4亏欠·5融入·
   6离乡·7家族肩·8远行·9滚烫·10追逐·11连接·12隐忍·13痴执·
   14坦诚·15温暖·16归乡·17传承），因此文案按索引共用、灯名按线取。
   ============================================================ */

var CN_LV=['','一','二','三'];
function queueLit(k,lv){
  if(!S)return; S.lit=S.lit||{}; S.pending=S.pending||[];
  var age=(S.age==null?0:S.age);
  var tag=k+'@'+lv+'@'+age; S.lit[tag]=1; S.pending.push(tag);
}
/* 时间线里"这一章点了哪些灯"：从 S.lit 的 k@lv@age 标记里反查（兼容旧的 k@lv 两段式） */
function lampsAtChapter(ch){
  if(!S||!S.lit)return [];
  var out=[];
  for(var tag in S.lit){
    var p=String(tag).split('@');
    var age=+p[2];
    if(!isFinite(age))continue;              /* 老存档的 k@lv 没有岁数，跳过不猜 */
    var cw=W&&W.chapters?W.chapters[ch-1]:null;
    if(cw&&age===cw.age&&out.indexOf(p[0])<0)out.push(p[0]);
  }
  return out;
}
function litBlock(){
  if(!S||!S.pending||!S.pending.length)return '';
  var w=W||{},h='';
  S.pending.forEach(function(tag){
    var p=tag.split('@'),k=p[0],lv=+p[1];
    var li=(w.lamps||[]).indexOf(k);
    var t=LAMP_TELL[li]&&LAMP_TELL[li][lv];
    if(!t)return;
    h+='<div class="epi lit"><div class="lb">灯 · '+k+'　'+CN_LV[lv]+'档</div>'+t+'</div>';
  });  S.pending=[];
  return h;
}
function deepLamps(){
  if(!S)return ''; var w=W||{},out=[];
  (w.lamps||[]).forEach(function(k,li){
    if((S.lamps[k]||0)>=3&&LAMP_TELL[li]&&LAMP_TELL[li][3])
      out.push('<div class="epi lit"><div class="lb">灯 · '+k+'　三档（满）</div>'+LAMP_TELL[li][3]+'</div>');
  });
  if(!out.length)return '';
  return '<h3 style="font-size:12px;letter-spacing:.24em;color:var(--ink2);margin:24px 0 0">亮 到 最 深 的 灯</h3>'+out.join('');
}
function sumLamps(L){var s=0;for(var k in L)s+=Math.max(0,L[k]);return s}
function mkEnd(t,kind,txt){return{title:t,kind:kind,text:txt}}










/* ============================================================
   引擎
   ============================================================ */



var app=null, root=null;

async function newGame(wk){
  try{ await ensureLine(wk); }catch(e){ toast('世界线加载失败：'+((e&&e.message)||e)); return; }
  var w=WORLDLINES[wk]; W=w;
  dropSave();
  var gender=pick(['男','女']);
  /* 道标：开局前立的那盏灯（UI 存在 S.pendingBeacon，跨局偏好存在 META.beacon） */
  var wantBeacon=(typeof pendingBeacon!=='undefined'&&pendingBeacon)?pendingBeacon:(META.beacon||null);
  var beacon=(wantBeacon&&w.lamps&&wantBeacon.indexOf(w.key)===0)?wantBeacon.slice(1):[];
  for(var bi=0;bi<beacon.length;bi++){
    if(beacon[bi]<0||beacon[bi]>=w.lamps.length){beacon=[];break;}
  }
  S={
    wl:wk, idx:-1, phase:'pro', age:0,
    gender:gender, name:pick(w.names),
    attrs:{vit:3,men:3,arc:3,soc:3,coin:3},
    lamps:{}, flags:{}, tough:0, dim:0,
    seen:{}, log:[], peeked:{}, snapshot:null, echoesUsed:0,
    lit:{}, pending:[], var:{}, v:0,
    beacon:beacon, beaconBorn:null, traceDebt:null, pendingBeacon:null, litAge:{}, dimAge:{},
    evPool:null,   /* 整局的事件池副本（临时卡插这里，不污染共享的 W.events） */
    lampCapped:{}, /* v2.5：被对位灯压住（封顶一档）的灯 */
    cbDone:null,   /* v2.5：本局已兑现的回头账 id */
    delta:null,    /* v2.5.1：这一步改变了什么（事后反馈用，每步重置） */
    ev:null,       /* v2.5：当前等待玩家选择的事件（没有 choices 的卡走原来的自动路径） */
    lifeShift:0,   /* v2.4⑥：累计寿数偏移（年龄第一次有后果） */
    endAge:null,   /* v2.4⑥：寿终岁数；早夭时是当场那个岁数，不是 78 */
    earlyDeath:null, /* v2.4⑥：早夭结局题名（未早夭为 null） */
  };
  if(beacon.length&&beacon[0]>=0){
    /* 偏置只作用于出身/天赋，不改任何灯的判定 */
    var rr=rollBiasedStart(w,beacon[0]);
    S.family=rr.family; S.talent=rr.talent; S.beaconBorn=rr.score;
  }else{
    S.family=pick(w.families||FAMILIES); S.talent=pick(w.talents||TALENTS);
  }
  var f=S.family.fx,t=S.talent.fx;
  for(var k in f)S.attrs[k]=clamp(S.attrs[k]+f[k],0,10);
  for(var k2 in t)S.attrs[k2]=clamp(S.attrs[k2]+t[k2],0,10);

  /* v2.4 玩法层②：前尘——上辈子的主灯这局开局就亮着，
     对应那盏暗灯则锁死（点不亮）。带着上辈子的性子出生，也带着上辈子的缺口。 */
  var lr=META.lastRun;
  if(lr&&w.lamps&&w.lamps[lr.mainIx]!=null){
    S.lamps[w.lamps[lr.mainIx]]=1;               /* 灯痕：起手亮一盏 */
    S.litAge[w.lamps[lr.mainIx]]=0;              /* 一出生就亮着 */
    if(lr.dimIx!=null&&w.lamps[lr.dimIx]!=null&&lr.dimIx!==lr.mainIx){
      S.traceDebt={n:lampWord(lr.dimIx),dn:lr.dimName||null,same:(lr.wl===wk),from:lr.endTitle||'',wl:lr.wl||'',
                   k:lr.lastK||null,t:lr.lastT||null,age:lr.lastAge||null};
      S.dimAge[w.lamps[lr.dimIx]]=1;             /* 缺口：这盏一辈子亮不起来 */
    }
  }
  render();
}

/* ---------- 章节场景变体：同一章在不同局里可以是不同的戏 ----------
   数据里给某章写 variants:N（N≥2），正文/选项文案就可以用 s.v 分叉：
   body:function(s){ return s.v===0?['戏A','…']:['戏B','…']; }
   变体号在进入该章时随机抽取一次，并存进存档（重玩同一线不会总读同一场戏）。 */
function rollVariants(){
  if(!W||!W.chapters)return;
  var c=W.chapters[S.idx];
  if(!c)return;
  var n=+c.variants||1;
  if(S.var[S.idx]===undefined&&n>1)S.var[S.idx]=Math.floor(Math.random()*n);
  S.v=S.var[S.idx]||0;
}

/* ---------- 文本处理 ---------- */
/* 允许选项标题/锁文案/预知提示写成 function(s)（配合 s.v 变体与 s.flags 路线分叉） */
function txt(x){ return tok(typeof x==='function'?x(S):x); }
function tok(str){
  if(!str)return '';
  var g=S.gender==='女';
  return String(str)
    .replace(/\{ta\}/g,g?'他':'她')
    .replace(/\{TA\}/g,g?'她':'他')
    .replace(/\{子\}/g,g?'闺女':'儿子')
    .replace(/\{name\}/g,S.name);
}
function arr(x){return typeof x==='function'?x(S):(Array.isArray(x)?x:[x])}

/* ---------- 渲染 ---------- */
function render(){
  if(!S){return startScreen();}
  if(S.phase==='end'){return renderEnd();}
  var w=W;
  var html='<div class="wrap'+(S.idx<0?' open-book':'')+'"><main>';
  if(S.idx<0){
    html+='<div class="chap-tag">序 章</div><h2>'+(w.prologueTitle||'二〇〇一年的雪')+'</h2><div class="age">'+w.name+' · 世界线</div>';
    arr(w.prologue).forEach(function(p,i){
      if(p.indexOf('p.ann||')===0)html+='<p class="ann fade" style="animation-delay:'+(i*60)+'ms">'+tok(p.slice(7))+'</p>';
      else html+='<p class="fade" style="animation-delay:'+(i*60)+'ms">'+tok(p)+'</p>';
    });
    html+='<div class="choices">';
    html+='<div class="epi"><div class="lb">出 生</div>'+tok(w.birthText(S))+'</div>';
    /* v2.4：道标与暗灯，在序章就交代清楚（只看不告诉你怎么走） */
    if(S.beacon&&S.beacon.length){
      html+='<div class="beacon-note"><b>这局立的道标</b>：'
        +S.beacon.map(function(ix){return '【'+lampName(ix)+'】'}).join('')
        +'　投胎时已朝它偏过一手（相性 '+S.beaconBorn+'）</div>';
    }
    if(S.traceDebt){
      html+='<div class="beacon-note dark"><b>前尘</b>：另有一条路上，【'+((S.traceDebt.same&&S.traceDebt.dn)?S.traceDebt.dn:S.traceDebt.n)+'】始终没点亮。'
        +'这一世它照样暗着——但它会在半路上找你一次。</div>';
    }
    var bdark=beaconDarkNote();
    if(bdark)html+='<div class="beacon-note dim">此刻暗着的是【'+bdark+'】。</div>';
    html+='<button class="btn pri" onclick="__pkBook.go()">开始这一生 →</button>';
    html+=' <button class="btn" onclick="__pkBook.aiPrologue()">✦ '+(aiReady()?'AI 写一句开局批注':'配置 AI 批注')+'</button>';
    html+='<div id="aiOut" class="epi" style="display:none"></div>';
    html+='</div>';
  }else{
    var c=w.chapters[S.idx];
    rollVariants();
    html+='<div class="chap-tag">第 '+zh(S.idx+1)+' 章</div><h2>'+((c.t.split(' · ')[1])||c.t)+'</h2>';
    html+='<div class="age">'+S.age+' 岁 · '+w.name+'</div>';
    if(S.phase==='story'){
      arr(c.body).forEach(function(p,i){html+='<p class="fade" style="animation-delay:'+(i*55)+'ms">'+tok(p)+'</p>'});
      html+='<div class="choices">';
      var avail=0;
      c.choices.forEach(function(ch,i){
        var ok=ch.cond?ch.cond(S):true;
        if(ok)avail++;
        html+='<button class="ch'+(ok?'':' locked')+'" '+(ok?'onclick="__pkBook.choose('+i+')"':'disabled')+'>'
          +'<span class="k">'+ch.k+'</span><span class="t">'+txt(ch.t)+'</span>'
          +(ok?'':'<span class="lk">✕ '+txt(ch.lock)+'</span>')
          +(ok&&S.peeked[S.idx+'_'+i]?'<span class="peek">◈ 预知：'+txt(ch.hint)+'</span>':'')
          +'</button>';
      });
      if(!avail)html+='<p class="ann">你哪条路都走不了。人生有时候就是这样——那就硬着头皮，原地过完这一年。</p><button class="btn pri" onclick="__pkBook.choose(-1)">继续</button>';
      if(!META.hinted&&c.choices.some(function(ch){return ch.cond&&!ch.cond(S)})){
        html+='<p class="ann hint">灰色的选项不是你点错了——是你这一生还没走到能选它的地方。先选能选的，路会自己分岔。</p>';
        META.hinted=1;saveMeta();
      }
      html+=echoBar();
      html+='</div>';
    }else if(S.phase==='result'){
      var ch=c.choices[S.picked];
      /* AI 结果改写：命中缓存就直接渲染 AI 版；没命中先渲染引擎原文，
         迟到的改写由 aiRwInto 换进 #outcome。
         原型单文件里没有 aiRwGet，typeof 判断让原型行为与旧版完全一致。 */
      var rw=(typeof aiRwGet==='function')?aiRwGet(ch):null;
      html+='<div id="outcome">';
      if(rw)String(rw).split(/\n+/).forEach(function(p,i){if(p.trim())html+='<p class="fade" style="animation-delay:'+(i*55)+'ms">'+escML(p)+'</p>'});
      else if(ch)arr(ch.body).forEach(function(p,i){html+='<p class="fade" style="animation-delay:'+(i*55)+'ms">'+tok(p)+'</p>'});
      else html+='<p>这一年就这么过去了。</p>';
      html+='</div>';
      html+=deltaLine();
      html+=litBlock();
      html+='<div class="choices"><button class="btn pri" onclick="__pkBook.afterChoice()">'+(S.idx>=w.chapters.length-1?'走向终点 →':'继续 →')+'</button></div>';
    }else if(S.phase==='event'){
      if(S.ev){
        /* v2.5：事件卡带 choices —— 玩家自己选，不再被动挨结果 */
        var cl=eventChoiceList(S.ev)||[];
        html+='<div class="epi evsel"><div class="lb">人 生 事 件</div><b>'+tok(S.ev.n)+'</b><br>'+tok(S.ev.text)+'</div>';
        html+='<div class="choices">';
        cl.forEach(function(x){
          html+='<button class="ch" onclick="__pkBook.chooseEv('+x.i+')"><span class="k">'+x.c.k+'</span><span class="t">'+tok(x.c.t)+'</span></button>';
        });
        html+='</div>';
        html+=litBlock();
        html+='</div>';
      }else{
        var tag=S.event.tag?'<span class="evtag">'+S.event.tag+'</span>':'';
        html+='<div class="epi'+(S.event.tag?' evtagged':'')+'"><div class="lb">人 生 事 件</div><b>'+tok(S.event.n)+'</b>'+tag+'<br>'+tok(S.event.text)+'</div>';
        if(S.event.capped&&S.event.capped.length){
          html+='<div class="capnote">灯 · '+S.event.capped.join('、')+' 被对位那盏压着，这一回只到一档。</div>';
        }
        if(S.event.extra)html+='<div class="epi"><div class="lb">人 生 事 件 · 其 二</div><b>'+S.event.extra.n+'</b><br>'+tok(S.event.extra.text)+'</div>';
        html+=deltaLine();
        html+=litBlock();
        html+='<div class="choices"><button class="btn pri" onclick="__pkBook.next()">'+(S.idx>=w.chapters.length-1?'结算这一生 →':'继续 →')+'</button></div>';
      }
      html+='</div>';
    }
  }
  html+='</main>'+side()+'</div>';
  app.innerHTML=html;
  saveGame();
  /* AI 结果改写：章节页预取三个选项的改写；结果页补一次迟到的情况。
     原型里这两个函数不存在，typeof 判断让原型行为与旧版完全一致。 */
  if(typeof aiPrefetchRewrites==='function')aiPrefetchRewrites();
  if(typeof aiRwInto==='function'&&S&&S.phase==='result'&&c&&c.choices)aiRwInto(c.choices[S.picked],S.picked);
}
function echoBar(){
  if(META.echoes<=0)return '';
  var first=!META.echoHinted; if(first){META.echoHinted=1;saveMeta();}
  var h='<div class="echobar"><span class="echobar-hint" title="回响：每通关一次 +1，跨周目累计。花 1 枚「预知」看选项后果，花 3 枚「改命」退回上一步重选。">回响 ×'+META.echoes+' <em>?</em></span>　';
  var c=W.chapters[S.idx];
  var unpeeked=false;
  c.choices.forEach(function(ch,i){if((ch.cond?ch.cond(S):true)&&!S.peeked[S.idx+'_'+i])unpeeked=true});
  if(unpeeked)h+='<button class="btn" onclick="__pkBook.peek()">◈ 预知（1）　</button>';
  if(S.snapshot)h+='<button class="btn" onclick="__pkBook.rewrite()">↺ 改命（3）</button>';
  h+='</div>';
  if(first)h+='<p class="ann echo-hint">「回响」是你通关攒下的资源：每通关一次 +1，跨周目累计。花 1 枚可「预知」某个选项的后果，花 3 枚可「改命」退回上一步重选。</p>';
  return h;
}
function side(){
  var w=W,h='<aside>';
  h+='<div class="panel"><h3>灯 谱</h3><div class="lamps">';
  w.lamps.forEach(function(k){
    var v=S.lamps[k]||0,fix=!!(S.dimAge&&S.dimAge[k]);
    var cls=fix?(v>0?'lp on on2 on3 fix':'lp fix'):(v>0?(v>=3?'lp on on2 on3':(v>=2?'lp on on2':'lp on')):(v<0?'lp off':'lp'));
    if(!fix&&cap&&v<2)cls+=' capped';
    var cap=(S.lampCapped&&S.lampCapped[k])||(v>=2?'':((function(){var c=lampCapped(k);return c?c.by:'';})()));
    var badge=fix?'<em class="lk">缺</em>':(S.litAge&&S.litAge[k]===0?'<em class="tr">痕</em>':(cap?'<em class="cp">⊘</em>':''));
    var tip=fix?'　前尘缺口：这一世亮不起来':(S.litAge&&S.litAge[k]===0?'　上辈子的灯痕（一出生就亮着）':(cap?('　【'+cap+'】已烧到二档，这一盏封顶一档'):''));
    h+='<div class="'+cls+'" title="'+k+tip+'">'
      +k+badge+(v>1?'<em>'+v+'</em>':'')+'</div>';
  });
  h+='</div><div class="stat" style="margin-top:10px"><span>灯芯值</span><b>'+sumLamps(S.lamps)+'</b></div>';
  if(S.beacon&&S.beacon.length){
    var bhit=0;
    for(var bqi=0;bqi<S.beacon.length;bqi++)if((S.lamps[w.lamps[S.beacon[bqi]]]||0)>0)bhit++;
    h+='<div class="stat"><span>道　标</span><b>'+S.beacon.map(function(ix){return lampName(ix)}).join('')+'　'
      +bhit+'/'+S.beacon.length+'</b></div>';
  }
  h+='<div class="stat"><span>韧　度</span><b>'+S.tough+'</b></div>';
  h+='<div class="stat"><span>回　响</span><b>'+META.echoes+'</b></div></div>';
  h+='<div class="panel"><h3>'+S.name+' · '+(S.gender==='女'?'女':'男')+'</h3>';
  for(var a in w.attrs){
    var v=S.attrs[a];
    h+='<div class="att"><div class="row"><span class="nm">'+w.attrs[a]+'</span>'
      +'<span class="bar"><i style="width:'+(v*10)+'%"></i></span><span class="vl">'+v+'</span></div></div>';
  }
  h+='<div class="stat"><span>年　岁</span><b>'+S.age+'</b></div></div>';
  var fs=flagList();
  if(fs.length)h+='<div class="panel"><h3>命 运 标 记</h3><div class="flags">'+fs.map(function(x){return '<span>'+x+'</span>'}).join('')+'</div></div>';
  h+='<div class="panel"><h3>进 度</h3><div class="stat"><span>章　节</span><b>'+(S.idx+1)+' / '+w.chapters.length+'</b></div>'
    +'<div class="stat"><span>已通　关</span><b>'+META.runs+'</b></div>'
    +'<div style="margin-top:10px"><button class="btn" style="width:100%" onclick="__pkBook.showHelp()">玩法说明</button></div></div>';
  h+='</aside>';
  return h;
}
function zh(n){var c='一二三四五六七八九十';return n<=10?c[n-1]:(n<=20?'十'+c[n-11]:String(n))}
/* 命运标记：中文名统一在这里映射（侧栏 + AI 摘要共用，避免给模型塞英文 key） */
function flagList(){
  var map={quit_school:'辍学',no_goodbye:'未告别',father_stay:'陪过父亲',fired:'被裁',quit_job:'辞过职',back_home:'回过老家',wrote_book:'著书',
           chased:'追过一个人',tech:'学了一门手艺',south:'远走南方',sick:'病过一场',married:'成了家'};
  var out=[];
  for(var f in map)if(S.flags[f])out.push(map[f]);
  return out;
}

/* ---------- 流程 ---------- */
function go(){
  S.snapshot=JSON.parse(JSON.stringify({attrs:S.attrs,lamps:S.lamps,flags:S.flags,age:S.age,tough:S.tough}));
  S.idx=0;S.phase='story';S.age=chapterAge(0);S.endAge=S.age;render();
}
function choose(i){
  deltaReset();
  S.snapshot=JSON.parse(JSON.stringify({attrs:S.attrs,lamps:S.lamps,flags:S.flags,age:S.age,tough:S.tough,idx:S.idx,lifeShift:S.lifeShift}));
  S.picked=i;
  if(i>=0){
    var ch=W.chapters[S.idx].choices[i];
    var fx=typeof ch.fx==='function'?ch.fx(S):ch.fx;
    apply(fx);
    applyYears(yearsForChoice(ch));   /* v2.4⑥：不直接改 S.age——寿命累加进 lifeShift，下一章统一结算 */
    S.log.push({ch:S.idx+1,k:ch.k,t:(typeof ch.t==='function'?ch.t(S):ch.t)});
    /* v2.4⑥ 早夭判定：从第 8 章（age>=40）起，累计寿数偏移过低就活不到终章。
       条件是确定性的（玩家能看见"寿 -2"这类提示），不是随机杀人。 */
    if(W.chapters[S.idx]&&W.chapters[S.idx].age>=AGE_EARLY_FROM&&(S.lifeShift||0)<=AGE_EARLY_SHIFT&&S.age<AGE_EARLY_TO){
      S.earlyDeath='灯没熬过那个冬天';S.endAge=S.age;finish();return;
    }
  }
  S.phase='result';render();
}
function afterChoice(){
  deltaReset();            /* 事件阶段的反馈单独算 */
  S.phase='event';
  /* v2.4 玩法层②：旧账——上辈子最后那个抉择，这一程会以一张事件卡回访一次。
     注意：绝不能 unshift 进 W.events（那是五条线共享的数据），否则每局都往里塞一张，
     越玩越脏。所以整局只复制一次事件池，临时卡插在副本里。 */
  if(!S.evPool)S.evPool=(W.events||[]).slice();
  if(S.traceDebt&&!S.traceDebt.seen&&S.log.length>=3&&S.evPool.length){
    S.traceDebt.seen=1;
    /* 优先用上一局收尾抉择的原文；旧存档没有这段时，退回"这一程"的抉择 */
    var last=S.log[S.log.length-1];
    var lk=S.traceDebt.k||last.k, lt=S.traceDebt.t||last.t;
    var lastAge=S.traceDebt.age||(W.chapters[S.idx]&&W.chapters[S.idx].age)||S.age;
    S.evPool.unshift({
      id:'trace_debt', n:'旧 账',
      text:'你想起了另一条路上的一件事。那一年'+lastAge+'岁，你选的是「'+lt+'」。'
        +'后来它把你带到了'+(S.traceDebt.from?('《'+S.traceDebt.from+'》'):'一个说不清的结局')
        +'——那时你始终没能点着【'+((S.traceDebt.same&&S.traceDebt.dn)?S.traceDebt.dn:S.traceDebt.n)+'】。',
      out:[{t:'旧账翻过去就翻过去了，只是你从这天起，把它记得比谁都清。',fx:{men:1}}]
    });
  }
  /* v2.5：回头账——flags 在第七章兑现一次，改后半程的走法 */
  if(!S.cbDone&&S.log.length>=7&&S.evPool.length){
    var cbk=callbackFor();
    if(cbk){
      S.cbDone=cbk.id;
      S.evPool.unshift({id:cbk.id, n:cbk.n, text:cbk.text, tag:'回头账', pooled:1, out:[{t:cbk.t, fx:cbk.fx}]});
    }
  }
  var pool=S.evPool.filter(function(ev){return !S.seen[ev.id]&&(!ev.when||ev.when(S))});
  if(!pool.length)pool=S.evPool.filter(function(ev){return !ev.when||ev.when(S)});
  if(pool.length){
    var ev=null;
    for(var pi=0;pi<pool.length;pi++)if(pool[pi].pooled){ev=pool[pi];break;}
    if(!ev)ev=pick(pool);
    S.seen[ev.id]=1;
    /* v2.5：带 choices 的事件卡交给玩家选（>=2 个可用选项时才拦） */
    var clist=eventChoiceList(ev);
    if(clist){ S.ev=ev; S.phase='event'; S.event=null; render(); return; }
    var o=ev.out.filter(function(x){return !x.c||x.c(S)})[0]||ev.out[ev.out.length-1];
    if(o.fx)apply(o.fx);
    META.codex.events[W.key+'_'+ev.id]=1;saveMeta();
    S.event={n:ev.n,text:o.t,tag:ev.tag||null,capped:capsMe(o.fx)};
    /* 有时这一程会连着遇上两件事：一生不再只走 11 张卡 */
    var pool2=S.evPool.filter(function(e2){return !S.seen[e2.id]&&(!e2.when||e2.when(S))});
    if(pool2.length&&Math.random()<0.35){
      var ev2=pick(pool2);S.seen[ev2.id]=1;
      var o2=ev2.out.filter(function(x){return !x.c||x.c(S)})[0]||ev2.out[ev2.out.length-1];
      if(o2.fx)apply(o2.fx);
      META.codex.events[W.key+'_'+ev2.id]=1;saveMeta();
      S.event.extra={n:ev2.n,text:o2.t,tag:ev2.tag||null};
    }
  }else{S.event=null;S.idx++;if(S.idx<W.chapters.length){S.age=chapterAge(S.idx);S.endAge=S.age;}S.phase='story';}
  render();
}
function next(){
  if(S.idx>=W.chapters.length-1){finish();return;}
  S.idx++;
  if(S.idx<W.chapters.length){S.age=chapterAge(S.idx);S.endAge=S.age;S.phase='story';}
  render();
}
/* v2.5：事件选择的结算入口。临时卡（旧账 / 回头账）属于"看着自己走过来"的一段，
   所以自动选中第一项，不让玩家在四五个选项里翻找。 */
function capsMe(fx){
  var L=S.lamps,out=[];
  (fx&&fx.lamps?Object.keys(fx.lamps):[]).forEach(function(k){
    var ix=W.lamps?W.lamps.indexOf(k):-1,foe=lampPairIdx(ix);
    if(foe>=0&&W.lamps[foe]&&(L[W.lamps[foe]]||0)>=2&&(L[k]||0)>=1)out.push(k);
  });
  return out;
}
function eventChoiceList(ev){
  if(!ev||!ev.choices||!ev.choices.length)return null;
  var out=[];
  ev.choices.forEach(function(c,i){ try{ if(!c.cond||c.cond(S))out.push({i:i,c:c}); }catch(e){} });
  return out.length>1?out:null;
}
function chooseEv(i){
  var list=eventChoiceList(S.ev);
  if(!list)return;
  var hit=null;
  for(var j=0;j<list.length;j++)if(list[j].i===i)hit=list[j].c;
  if(!hit)return;
  deltaReset();
  if(hit.fx)apply(hit.fx);
  META.codex.events[W.key+'_'+S.ev.id]=1;saveMeta();
  var capped=capsMe(hit.fx);
  S.event={n:S.ev.n,text:hit.t,tag:S.ev.tag||null,ev:S.ev,choices:S.ev.choices,capped:capped};
  S.ev=null;S.phase='event';render();
}
/* ---------- v2.5.1 事后反馈：这一步改变了什么 ----------
   只在"已经发生"之后展示，不透露未来——所以不削弱"预知"（预知是选之前花代价看）。
   属性变化此前完全没有反馈，灯也只有 1.4 秒浮动提示。 */
function deltaReset(){ S.delta={attrs:{},lamps:{},yrs:0}; }
function deltaAttr(a,d){ if(!S.delta)deltaReset(); S.delta.attrs[a]=(S.delta.attrs[a]||0)+d; }
function deltaLamp(k,from,to){ if(!S.delta)deltaReset();
  var cur=S.delta.lamps[k];
  S.delta.lamps[k]=cur?{from:cur.from,to:to}:{from:from,to:to};   /* 同一步里多次改动取净效果 */
}
function deltaLine(){
  if(!S||!S.delta)return "";
  var parts=[],a=S.delta.attrs,l=S.delta.lamps,k;
  for(k in a){ if(a[k])parts.push(((W.attrs&&W.attrs[k])||k)+" "+(a[k]>0?"+":"")+a[k]); }
  var lk=[];
  for(k in l){ var d=l[k];
    if(d.to>d.from)lk.push("灯 · "+k+(d.to>=2?"（升到"+CN_LV[d.to]+"档）":"（新亮）"));
    else if(d.to<d.from)lk.push("灯 · "+k+"（暗了一档）");
  }
  if(lk.length)parts.push(lk.join("　"));
  if(S.delta.yrs)parts.push("寿 "+(S.delta.yrs>0?"+":"")+S.delta.yrs);
  if(!parts.length)return "";
  return "<div class=\"delta\">"+parts.join("　·　")+"</div>";
}
function apply(fx){
  if(!fx)return;
  if(fx.attrs)for(var a in fx.attrs){
    var _b=S.attrs[a]||0;
    S.attrs[a]=clamp(_b+fx.attrs[a],0,10);
    if(S.attrs[a]!==_b)deltaAttr(a,S.attrs[a]-_b);   /* 只记真实变化（被夹到 0~10 的不算） */
  }
  var _g=[];
  if(fx.lamps)for(var k in fx.lamps){
    var before=S.lamps[k]||0,after=clamp(before+fx.lamps[k],-1,3);
    if(after>before&&S.dimAge&&S.dimAge[k])after=0;   /* 前尘缺口：这盏灯这一世亮不起来 */
    /* v2.5 灯的对立（双向）：对位那盏已到二档 → 这一盏封顶一档，怎么选都上不去。
       必须在"加法之前"拦，只在"升到二档时压对方"是不够的——反方向会漏（曾实测 330 次违章）。 */
    var myIx=W.lamps?W.lamps.indexOf(k):-1, myFoe=lampPairIdx(myIx);
    if(myFoe>=0&&W.lamps[myFoe]&&(S.lamps[W.lamps[myFoe]]||0)>=2&&after>1)after=1;
    S.lamps[k]=after;
    if(after!==before)deltaLamp(k,before,after);
    /* 时间线要按年龄排，所以"从暗到亮"那一刻的岁数记一份（key = 灯名） */
    if(after>0&&before<=0){
      S.litAge=S.litAge||{};
      if(S.litAge[k]==null)S.litAge[k]=(S.age==null?0:S.age);
    }
    /* v2.5 灯的对立：这一盏到二档，就把对位那盏压在一档 */
    if(after>=2&&myFoe>=0&&W.lamps[myFoe]){
      S.lampCapped=S.lampCapped||{};
      S.lampCapped[W.lamps[myFoe]]=k;       /* 记住被谁压住的，侧栏显示 ⊘ */
    }
    if(after<before){S.tough++;applyYears(-1);}   /* v2.4⑥：熬过一次，也少活一点 */
    if(after>before)_g.push(k+(after>=2?'（'+CN_LV[after]+'档）':''));
    if(after>before&&after>=2)queueLit(k,after);
    if(after>0){META.codex.lamps[W.key+'_'+k]=1;saveMeta();}
  }
  if(_g.length)flashLamps(_g);
  if(fx.flags)for(var f in fx.flags)S.flags[f]=fx.flags[f];
  var on=0;for(var k2 in S.lamps)if(S.lamps[k2]>0)on++;
  if(on>=1)grant('first');
  if(on>=12)grant('twelve');
  if(S.tough>=3)grant('tough');
  if((S.lamps[W.lamps[6]]||0)>=3)grant('south');
  if((S.lamps[W.lamps[7]]||0)>=2)grant('shoulder');
  if((S.lamps[W.lamps[11]]||0)>=2)grant('remember');
  if(S.flags.fired&&S.attrs.arc>=7)grant('comeback');
  var all=W.lamps.every(function(k){return META.codex.lamps[W.key+'_'+k]});
  if(all)grant('full');
}
function peek(){
  if(META.echoes<1){toast('回响不足');return;}
  var c=W.chapters[S.idx],idx=-1;
  c.choices.forEach(function(ch,i){if(idx<0&&(ch.cond?ch.cond(S):true)&&!S.peeked[S.idx+'_'+i])idx=i});
  if(idx<0)return;
  META.echoes--;saveMeta();S.peeked[S.idx+'_'+idx]=1;render();
}
function rewrite(){
  if(META.echoes<3||!S.snapshot){toast('回响不足（需要 3）');return;}
  META.echoes-=3;saveMeta();
  var s=S.snapshot;S.attrs=s.attrs;S.lamps=s.lamps;S.flags=s.flags;S.age=s.age;S.tough=s.tough;S.lifeShift=s.lifeShift;
  S.phase='story';S.snapshot=null;toast('改命：回到上一次抉择之前');render();
}
function finish(){
  var L=S.lamps;
  var pb=pickBucket({lamps:L},W);
  var ctx={lamps:L,attrs:S.attrs,flags:S.flags,main:pb.main,bucket:pb.id,tough:S.tough,sum:sumLamps(L)};
  var end=W.endings(ctx);
  /* v2.4⑥ 年龄三带：只在两端各切一刀，中段（75~80 岁）原样走原有的 15 个结局，
     所以七桶的相对结构不会被扰动（实测逐项未变）。 */
  if(S.earlyDeath){
    end=mkEnd(S.earlyDeath,'normal',
      '灯还亮着，人先走了。你这一生欠下的那些夜、那些觉、那些本该慢一点的路，最后一起找上了你。剩下的人替你把这盏灯添上油，谁也没说话。',ctx);
  }else{
    /* 年龄结局只覆盖「普通桶结局」。
       稀有/隐藏结局（点亮万盏灯 / 九死未悔 / 金灯无芯 / 独照 / 雪落无声系列）是玩家用
       整局选择攒出来的，不能被寿数一刀盖掉——修前实测：「独照」满足条件的 1594 局里
       54% 被灯尽油枯/未及白首吞掉，「九死未悔」30%（「点亮万盏灯」0%，因为攒七盏的人
       寿命通常也短）。kind 三种取值：normal 普通桶 / special 稀有 / hidden 隐藏。
       注意：早夭（S.earlyDeath）不在此列——那是"没活到终章"，本就该盖过一切。 */
    var keepSpecial=!!(end&&(end.kind==='hidden'||end.kind==='special'));
    if(!keepSpecial){
      var fa=finalAge();
      if(fa<=AGE_WHITE){
        end=mkEnd('未及白首','normal',
          '你走得太早，早到还有很多话没来得及说。灯不是灭的，是被人从手里拿走的。',ctx);
      }else if(fa>=AGE_DRY){
        end=mkEnd('灯尽油枯','normal',
          '你活过了所有该活的日子，把自己也熬成了灯芯的一部分。最后一夜，火苗矮下去，像一个人终于肯睡。',ctx);
      }
    }
  }
  var epi=W.epitaph(ctx);
  META.codex.endings[W.key+'_'+end.title]=1;
  META.echoes+=1;META.runs+=1;
  META.prevEpitaph=META.lastEpitaph||'';META.lastEpitaph=epi;saveMeta();
  if(end.title==='金灯无芯')grant('gold');
  if((L[W.lamps[16]]||0)>=3&&(L[W.lamps[4]]||0)<=0)grant('clear');
  if(S.flags.father_stay&&(L[W.lamps[4]]||0)<=0)grant('goodbye');
  if(META.runs>=3)grant('samsara');

  /* v2.4 玩法层①：道标结算（点着 / 半亮 / 没点着），并累计跨局的道标记录 */
  var beaconRes=null;
  if(S.beacon&&S.beacon.length){
    var hit=0,names=[];
    for(var bq=0;bq<S.beacon.length;bq++){
      var bix=S.beacon[bq],bk=W.lamps[bix];
      names.push(lampName(bix));
      if((L[bk]||0)>0)hit++;
    }
    beaconRes={names:names,hit:hit,total:S.beacon.length,born:S.beaconBorn,
      verdict:hit===S.beacon.length?'点着':(hit>0?'半亮':'没点着')};
    META.beaconStats=META.beaconStats||{lit:0,half:0,dark:0,byLamp:{}};
    if(beaconRes.verdict==='点着')META.beaconStats.lit++;
    else if(beaconRes.verdict==='半亮')META.beaconStats.half++;
    else META.beaconStats.dark++;
    if(beaconRes.verdict==='点着'){
      for(var bq2=0;bq2<S.beacon.length;bq2++){
        var key2=S.wl+'#'+S.beacon[bq2];
        META.beaconStats.byLamp[key2]=(META.beaconStats.byLamp[key2]||0)+1;
      }
      if(Object.keys(META.beaconStats.byLamp).length>=18)grant('beacon18');
    }
  }
  /* 玩法层②：把"这一生"压成几行字，留给下一局当前尘 */
  var bi=pickBucket({lamps:L},W),bmk=bi.main,bdix=null;
  for(var bz=0;bz<BUCKETS.length;bz++){
    if(BUCKETS[bz].id===bi.id&&BUCKETS[bz].ix.length>1){
      var mn=BUCKETS[bz].ix[0];
      for(var bj=1;bj<BUCKETS[bz].ix.length;bj++)if((L[W.lamps[BUCKETS[bz].ix[bj]]]||0)<(L[W.lamps[mn]]||0))mn=BUCKETS[bz].ix[bj];
      bdix=mn;break;
    }
  }
  var lastCh=S.log.length?S.log[S.log.length-1]:null;
  META.lastRun={wl:S.wl,mainIx:W.lamps.indexOf(bmk),dimIx:bdix==null?null:bdix,
    mainName:bmk,dimName:bdix==null?null:W.lamps[bdix],
    endTitle:end.title,lastK:lastCh?lastCh.k:null,lastT:lastCh?lastCh.t:null,lastAge:S.age,runs:META.runs};

  S.phase='end';S.result={end:end,epi:epi,ctx:ctx,beacon:beaconRes};render();
}
function renderEnd(){
  var r=S.result,w=W;
  var lit=[];for(var k in S.lamps)if(S.lamps[k]>0)lit.push(k);
  var h='<div class="wrap"><main style="grid-column:1/-1">';
  h+='<div class="chap-tag">终 章 · 结 算</div>';
  h+='<div class="endtitle">《'+r.end.title+'》</div>';
  h+='<div class="endtag">'+w.name+' · '+S.name+' · 寿数 '+finalAge()+'</div>';
  /* v2.4⑥：寿数与"本该活到的岁数"拉开距离时，把这句话点出来——年龄要看得见才有意义 */
  if((S.lifeShift||0)!==0){
    h+='<div class="endtag" style="margin-top:2px;opacity:.75">本该活到 '+AGE_NOMINAL+'　'
      +((S.lifeShift>0)?('多活了 '+S.lifeShift+' 年'):('少了 '+(-S.lifeShift)+' 年'))+'</div>';
  }
  h+='<p class="fade">'+r.end.text+'</p>';
  h+='<div class="epi"><div class="lb">墓 志 铭</div>'+r.epi+'</div>';
  /* v2.4 玩法层①：道标结算。没有立道标就不显示这一块 */
  if(r.beacon){
    var bc=r.beacon;
    var bcl=bc.verdict==='点着'?'ok':(bc.verdict==='半亮'?'half':'miss');
    var bsay=bc.verdict==='点着'?'道标点着了。这一生绕了一圈，还是照着那盏灯走的。'
      :(bc.verdict==='半亮'?'道标只亮了半边——另一盏始终没着，不算白走。':'道标没点着。你走了别的路，那盏灯就一直空在那儿。');
    h+='<div class="beacon-res '+bcl+'"><b>灯 火 道 标</b><span>'+bc.names.join(' · ')+'</span>'
      +'<i>'+bc.verdict+'（'+bc.hit+'/'+bc.total+'）</i><p>'+bsay+'</p>'
      +'<div class="bsay">投胎时朝这盏灯偏了一手（相性 '+bc.born+'）——偏的只是出身与天赋，点不点着看你怎么选。</div></div>';
  }
  h+='<div class="recap"><b>主灯</b>：'+r.ctx.main+'　<b>灯芯值</b>：'+r.ctx.sum+'　<b>韧度</b>：'+S.tough+'　<b>回响</b>：'+META.echoes+'<br>';
  h+='<b>点亮的灯</b>：'+(lit.length?lit.join(' · '):'无')+'</div>';
  /* v2.4 玩法层③：这一生——把 S.log 里躺着的抉择记录排成时间线 */
  if(S.log.length){
    h+='<div class="lifeline"><div class="lb">这 一 生</div>';
    S.log.forEach(function(x){
      var cw=W.chapters[x.ch-1];
      var age=cw&&cw.age!=null?cw.age:'—';
      var got=lampsAtChapter(x.ch);
      h+='<div class="ll-row"><span class="ll-age">'+age+' 岁</span>'
        +'<span class="ll-k">'+x.k+'</span>'
        +'<span class="ll-t">'+escML(x.t)+'</span>'
        +(got.length?'<span class="ll-lamp">灯 · '+got.join(' ')+'</span>':'')+'</div>';
    });
    h+='</div>';
  }
  h+=deepLamps();
  /* 前尘：今天这局会给下一局留下什么（明写出来，玩家才知道跨周目是有痕的） */
  if(META.lastRun){
    h+='<p class="ann trace">这一生的主灯是<b>【'+(META.lastRun.mainName||lampWord(META.lastRun.mainIx))+'】</b>——它会跟着你进下一局；'
      +'没点亮的那盏<b>【'+(META.lastRun.dimName||lampWord(META.lastRun.dimIx))+'】</b>，下一局点亮不了。</p>';
  }
  if(META.lastEpitaph&&META.runs>1)h+='<p class="ann">上一个你留下的话：'+META.lastEpitaph+'</p>';
  h+='<div id="aiOut" class="epi" style="display:none"></div>';
  h+='<div class="choices"><button class="btn pri" onclick="__pkBook.newGame(\''+S.wl+'\')">再活一次（同世界线）</button> '
    +'<button class="btn" onclick="__pkBook.resetLine()">换一条世界线</button> '
    +'<button class="btn" onclick="__pkBook.aiScroll()">✦ '+(aiReady()?'AI 扩写这一生':'配置 AI 扩写')+'</button> '
    +'<button class="btn" onclick="__pkBook.aiAlt()">✦ AI 另一种可能</button> '
    +'<button class="btn" onclick="__pkBook.showCodex()">看图鉴</button></div>';
  h+='</main></div>';
  app.innerHTML=h;
  saveGame();
}

/* ---------- 开始界面 & 弹窗 ---------- */
/* ============================================================
   AI 增强层（可选）—— 全流程离线可玩，AI 只做"锦上添花"的三件事：
   ① 开局批注  ② 结算散文  ③ 墓志铭
   走 OpenAI 兼容接口（/chat/completions），默认指向用户自己的网关。
   ============================================================ */
/* ---------- AI 增强层（经站点服务端代理；流式逐字返回，未配置 Key 时降级为内置文案） ----------
   服务端 /api/agent/book-ai 支持 stream:true → SSE（event: delta/done/err）。
   结算散文要等十几秒，一次性返回时前端只能干等；这里边收边渲染，让人立刻看到"在动"。
   若反代/上游不支持流式（返回普通 JSON 或空体），自动回落到一次性解析。 */
function aiSummarize(){
  var L=S.lamps,lit=[],dark=[];
  for(var k in L){if(L[k]>0)lit.push(k+'×'+L[k]);else if(L[k]<0)dark.push(k);}
  var chs=S.log.map(function(x){return '第'+x.ch+'章 '+x.k+'：'+x.t;}).join('；');
  return '世界线：'+W.name+'。'
    +'姓名：'+S.name+'，'+(S.gender==='女'?'女':'男')+'，卒年 '+S.age+' 岁。'
    +'出身：'+S.family.n+'（'+S.family.d+'），先天：'+S.talent.n+'。'
    +'五维（0-10）：'+Object.keys(W.attrs).map(function(a){return W.attrs[a]+S.attrs[a]}).join('、')+'。'
    +'点亮的灯：'+(lit.length?lit.join('、'):'无')+'。'
    +(dark.length?('被掐灭的灯：'+dark.join('、')+'。'):'')
    +'灯芯值 '+sumLamps(L)+'，韧度 '+S.tough+'，主灯【'+S.result.ctx.main+'】。'
    +'命运标记：'+(flagList().join('、')||'无')+'。'
    +'一生关键抉择：'+chs+'。'
    +'命中结局：《'+S.result.end.title+'》。';
}
function aiCall(kind,payload,cb,onDelta,_autoRetried){
  var body={kind:kind,stream:true};
  for(var k in (payload||{}))body[k]=payload[k];
  var acc='';
  /* 上游是"按分钟窗口"的共享配额（实测：三条 key 共用、一分钟约 3 次、429 不带 retry-after）。
     服务端会把建议等待时间放在 retryAfterMs 里；等待不长（≤30s）就自动重试一次，
     玩家不必手动点「重试」，也不会看到一闪而过的失败。 */
  var failed=function(msg,retryAfterMs){
    var wait=Number(retryAfterMs)||0;
    if(!_autoRetried&&wait>0&&wait<=30000){
      setTimeout(function(){aiCall(kind,payload,cb,onDelta,true)},wait+400);
      return;
    }
    cb(msg);
  };
  fetch('/api/agent/book-ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){
      var ct=(r.headers.get('content-type')||'');
      if(!(r.ok&&r.body&&ct.indexOf('text/event-stream')>=0)){
        /* 回落：普通 JSON（可能是 429/未配置/反代错误），容错解析避免抛 JSON 异常 */
        return r.text().then(function(t){
          var j=null;try{j=t?JSON.parse(t):null}catch(e){j=null}
          if(j&&j.ok&&j.text)cb(null,String(j.text).trim());
          else failed((j&&j.error)||'AI 暂时不可用（接口无响应）',j&&j.retryAfterMs);
        });
      }
      var reader=r.body.getReader(),dec=new TextDecoder(),buf='',done=false;
      var pump=function(){
        return reader.read().then(function(res){
          if(done)return;
          if(res.done){
            done=true;
            var t=acc.trim();
            if(t)cb(null,t); else failed('AI 返回为空',0);
            return;
          }
          buf+=dec.decode(res.value,{stream:true});
          var lines=buf.split('\n');buf=lines.pop();
          for(var i=0;i<lines.length;i++){
            var s=lines[i].trim();
            if(s.indexOf('data:')!==0)continue;
            var j=null;try{j=JSON.parse(s.slice(5).trim())}catch(e){continue}
            if(j&&j.t){acc+=j.t;if(onDelta)onDelta(acc);}
            else if(j&&j.text){acc=j.text;if(onDelta)onDelta(acc);}
            else if(j&&j.error){done=true;failed(j.error,j.retryAfterMs);return;}
          }
          return pump();
        });
      };
      return pump();
    })
    .catch(function(e){cb('请求失败：'+(e&&e.message||e))});
}
function aiReady(){return true}
/* 失败时给一颗「重试」按钮：额度/网络抖动时玩家不必刷新页面 */
function aiRetryBtn(kind){
  return '<div style="margin-top:8px"><button class="btn" onclick="__pkBook.aiRetry(\''+kind+'\')">↻ 重试</button></div>';
}
var aiLastScroll='';
function aiRetry(kind){
  if(kind==='prologue')aiPrologue();
  else if(kind==='scroll')aiScroll();
  else if(kind==='epitaph'){var box=document.getElementById('aiOut');if(box)sendEpitaph(aiLastScroll,box);}
  else if(kind==='alt')aiAlt();
}
function aiPrologue(){
  var box=document.getElementById('aiOut');
  var paint=function(t){ if(box)box.innerHTML='<div class="lb">AI 批注</div><span class="ts">正在生成…</span><br>'+escML(t); };
  if(box){box.style.display='block';box.innerHTML='<div class="lb">AI 批注</div><span class="ts">正在生成…</span>';}
  aiCall('book-prologue',{worldline:W.name,name:S.name,gender:S.gender,
    family:S.family.n+'（'+S.family.d+'）',talent:S.talent.n},
    function(err,txt){
      if(!box)return;
      box.innerHTML='<div class="lb">AI 批注</div>'+(err?('生成失败（'+esc(err)+'）')+aiRetryBtn('prologue'):escML(txt));
    },paint);
}
function aiScroll(){
  var box=document.getElementById('aiOut');
  var paint=function(t){ if(box)box.innerHTML='<div class="lb">AI 结算散文</div><span class="ts">正在生成…（流式）</span><br>'+escML(t); };
  if(box){box.style.display='block';box.innerHTML='<div class="lb">AI 结算散文</div><span class="ts">正在生成…（流式，约十几秒）</span>';}
  aiCall('book-scroll',{summary:aiSummarize()},function(err,txt){
    if(err){box.innerHTML='<div class="lb">AI 结算散文</div>生成失败（'+esc(err)+'）'+aiRetryBtn('scroll');return;}
    aiLastScroll=txt;
    sendEpitaph(txt,box);
  },paint);
}
function sendEpitaph(scroll,box){
  var paint=function(t){ if(box)box.innerHTML='<div class="lb">AI 结算散文</div>'+escML(scroll)
    +'<div class="lb" style="margin-top:14px">AI 墓志铭</div><span class="ts">正在生成…（流式）</span><br>'+escML(t); };
  aiCall('book-epitaph',{summary:aiSummarize(),main:S.result.ctx.main},function(err,txt){
    box.innerHTML='<div class="lb">AI 结算散文</div>'+escML(scroll)
      +'<div class="lb" style="margin-top:14px">AI 墓志铭</div>'+(err?('（生成失败：'+esc(err)+'）')+aiRetryBtn('epitaph'):escML(txt));
  },paint);
}

/* ---------- 选项结果「换一笔」 ----------
   分工：引擎写好的原文 = 事实与落点的唯一真相（模型不碰剧情、不碰数值）；
   模型只做叙述层的重渲染——同一件事，换一个切入角度。
   这正好补上「重玩走同一选项，读到的字一模一样」这个洞。 */
var AI_RW_KEY='pkbook2_ai_rw';
var AI_RW_ON=(function(){try{return localStorage.getItem(AI_RW_KEY)!=='0'}catch(e){return true}})();
/* ---------- AI「另一种可能」（v2.6）：结局页的反事实 ----------
   分岔口 = "点灯最多的那一次抉择"（并列取更晚）。键 = 世界线 + 抉择 + 结局，与玩家无关，
   所以只有剧本量级的几百条上限，能被预热脚本一次吃完（warm-rewrite-cache.cjs --alt）。
   红线不变：模型只写"没走的那条路"，不改写已经发生的结局。 */
function aiAltPick(){
  var best=null;
  for(var i=0;i<S.log.length;i++){
    var x=S.log[i], w=0, keys=(typeof lampsAtChapter==="function")?lampsAtChapter(x.ch):[];
    for(var j=0;j<keys.length;j++)w+=Math.max(1,(S.lamps[keys[j]]||0));
    if(!best||w>=best.w)best={i:i,ch:x.ch,w:w};
  }
  if(!best&&S.log.length)best={i:S.log.length-1,ch:S.log[S.log.length-1].ch,w:0};
  return best;
}
function aiAlt(){
  var box=document.getElementById("aiOut");
  if(!box||!S.log.length)return;
  var pick=aiAltPick(), x=S.log[pick.i];
  var cw=W.chapters[x.ch-1], age=(cw&&cw.age!=null)?cw.age:S.age;
  /* 提示词用数组拼行：源文件里不出现换行转义（这个坑踩过三次） */
  var ask=[
    "这个人在"+age+"岁那年做的选择是「"+x.t+"」。请写这段人生的「另一种可能」：如果那年他走了另一条路，会怎样。",
    "",
    "硬性要求：",
    "- 只写‘没走的那条路’，篇幅 100~160 字，一到两段。",
    "- 不要评价这个选择，不要说哪条路更好，不要写‘可惜’‘幸好’这类判断。",
    "- 不改变他既定的结局（《"+S.result.end.title+"》），那个结局已经发生了——把它当作回声，不要重写它。",
    "- 不要复述已知的剧情细节，不要写‘他明白了’‘从此以后’这类收束；用物象与动作说话，落点要轻。",
    "- 世界线："+W.name+"。",
    "- 这一生最亮的那盏灯是【"+S.result.ctx.main+"】，可以轻轻带一笔，但不要点题。",
  ].join(String.fromCharCode(10));
  var paint=function(t){ box.innerHTML='<div class="lb">AI 另一种可能 · '+age+' 岁那年</div><span class="ts">正在书写…</span><br>'+escML(t); };
  box.style.display="block"; box.innerHTML='<div class="lb">AI 另一种可能 · '+age+' 岁那年</div><span class="ts">正在书写…（流式，约十几秒）</span>';
  aiCall("book-alt",{pickTitle:x.t,worldline:W.name,ending:S.result.end.title,age:age,main:S.result.ctx.main},function(err,txt){
    box.innerHTML='<div class="lb">AI 另一种可能 · '+age+' 岁那年</div>'+ (err?('生成失败（'+esc(err)+'）'+aiRetryBtn("alt")):escML(txt));
  },paint);
}
function aiRwToggle(on){AI_RW_ON=!!on;try{localStorage.setItem(AI_RW_KEY,on?'1':'0')}catch(e){}}
/* 切入角度按周目轮换：不同周目走同一选项，读到的切入不同 */
var AI_RW_ANGLES=[
  '从一个物件写起：先把那件东西写清楚，再写发生了什么。',
  '从一个声音或气味写起：先给一个感官细节，再落到事情本身。',
  '只写动作，不写心情：让人物做一件小事，把情绪留在事外面。',
  '从一个时间点写起：先写那一刻的天色或时辰，再写人。'
];
function aiRwAngle(){return AI_RW_ANGLES[(META.runs||0)%AI_RW_ANGLES.length]}
/* 送给模型的原文必须先过 tok()，否则 {ta}/{子} 这类占位符会原样丢给模型 */
function aiRwCanon(ch){
  if(!ch||typeof ch.body==='function')return '';
  var a=Array.isArray(ch.body)?ch.body:[ch.body];
  var t=a.filter(function(x){return typeof x==='string'&&x.indexOf('p.ann||')!==0})
         .map(function(x){return tok(String(x))}).join('\n').trim();
  return t.length>=12?t:'';   /* 太短的重写没意义，直接跳过 */
}
var AI_RW_CACHE={};   /* canon → 文本（会话内缓存，同一局里不会重复请求） */
var AI_RW_FAIL=0;     /* 连续失败计数；熔断后本局不再发请求，避免每章白发三个 */
var aiRwPending={};
function aiRwGet(ch){ if(!AI_RW_ON)return null; var k=aiRwCanon(ch); return k?(AI_RW_CACHE[k]||null):null; }
function aiRwFetch(ch,cb){
  var canon=aiRwCanon(ch);
  if(!canon)return;
  if(AI_RW_CACHE[canon]){ if(cb)cb(null,AI_RW_CACHE[canon]); return; }
  if(!AI_RW_ON||AI_RW_FAIL>=2||aiRwPending[canon])return;
  aiRwPending[canon]=1;
  aiCall('book-rewrite',{canon:canon,angle:aiRwAngle(),worldline:W.name},function(err,txt){
    delete aiRwPending[canon];
    if(err){AI_RW_FAIL++;return;}
    AI_RW_FAIL=0;
    txt=String(txt||'').trim();
    if(txt.length<20)return;
    AI_RW_CACHE[canon]=txt;
    if(cb)cb(null,txt);
  });
}
/* 结果页：如果改写是「迟到」的，等它到了再换进 #outcome（玩家已翻页就丢弃） */
function aiRwInto(ch,picked){
  if(!AI_RW_ON||!S||S.phase!=='result'||S.picked!==picked)return;
  aiRwFetch(ch,function(err,txt){
    if(err||!S||S.phase!=='result'||S.picked!==picked)return;
    var box=document.getElementById('outcome');
    if(box)box.innerHTML='<p class="fade">'+escML(txt)+'</p>';
  });
}
/* 读章节时就把三个选项的改写预取回来——等玩家点下去，文本已经在手里，
   于是结果页可以一次性渲染出来，不会出现「字被人换掉」的突兀。串行发，避免撞限流。 */
var AI_RW_PREFETCHED={};
function aiPrefetchRewrites(){
  if(!AI_RW_ON||AI_RW_FAIL>=2||!W||!S||S.phase!=='story')return;
  var c=W.chapters[S.idx]; if(!c||!c.choices)return;
  var key=S.wl+'#'+S.idx;
  if(AI_RW_PREFETCHED[key])return;
  AI_RW_PREFETCHED[key]=1;
  var list=c.choices.filter(function(ch){return !ch.cond||ch.cond(S)});
  var i=0;
  (function step(){
    if(i>=list.length||AI_RW_FAIL>=2)return;
    var ch=list[i++];
    aiRwFetch(ch,function(){setTimeout(step,120)});
  })();
}
/* 设置面板里的开关：切换后重开面板以反映新状态 */
function aiRwSet(v){ aiRwToggle(v==='1'||v===1||v===true); showAI(); }
function showAI(){
  var on=AI_RW_ON;
  modal('<h3>AI 增强（可选）</h3><div class="ms">本站的 AI 由服务端统一提供，无需填写任何密钥</div>'
   +'<p style="text-indent:0;font-size:14.5px">可用于三处：<b>开局批注</b>（出生那一刻的命批）、<b>结算散文</b>、<b>墓志铭</b>。'
   +'不联网、未配置或额度用尽时，游戏会照常走完全程，用内置文案收尾。</p>'
   +'<p style="text-indent:0;font-size:14.5px"><b>选项结果改写</b>：引擎已经写好这一段，AI 只是换一个切入角度重写一遍——'
   +'同一件事、同样的结果，但<b>不同周目读到的字不一样</b>。剧情走向、灯谱与数值永远由引擎决定，AI 不参与。'
   +'<br>当前状态：'+(on?'<b>开启</b>':'关闭')
   +'　<button class="btn" onclick="__pkBook.aiRwSet('+(on?'0':'1')+')">'+(on?'关掉试试':'打开')+'</button></p>'
   +'<p style="text-indent:0;font-size:14.5px">服务端未配置 AI Key 时，点 AI 按钮会提示失败原因，不影响其它功能。</p>');
}
function saveAIfromForm(){
  var u=document.getElementById('aiUrl'),m=document.getElementById('aiModel'),k=document.getElementById('aiKey');
  AI.url=u?u.value.trim():'';AI.model=m?m.value.trim():'';AI.key=k?k.value.trim():'';
  saveAI();
  var mask=document.querySelector('.mask');if(mask)mask.remove();
  toast(aiReady()?'AI 已配置':'已保存（地址与模型需都填）');
  if(S&&S.phase==='end')render();
}


function startScreen(){
  var h='<div class="start"><h1>人生之书</h1><div class="sub">THE BOOK OF A LIFE · 玩法加厚版 v2</div>';
  var sv=loadGame();
  if(sv){
    var w0=LINE_META[sv.wl];
    var ch=(sv.S.idx<0)?'序章':('第 '+(sv.S.idx+1)+' 章');
    h+='<button class="wl resume" onclick="__pkBook.resume()"><b>继续上一次的人生 →</b>'
      +'<div class="d">'+w0.name+' · '+ch+' · '+(sv.S.age||0)+' 岁</div>'
      +'<div class="m">页面关掉了也不怕，这一生还在原地等你</div></button>';
  }
  /* v2.4 玩法层①：立一盏灯火道标——只做偏置与提示，不保底、不改结局判定 */
  var bkeys=metaKeys();
  var bwl=(sv&&sv.wl&&metaOf(sv.wl))?sv.wl:bkeys[0];
  var bsel=null;
  if(pendingBeacon&&pendingBeacon[0]===bwl)bsel=pendingBeacon[1];
  else if(META.beacon&&META.beacon[0]===bwl)bsel=META.beacon[1];
  var bw=metaOf(bwl);
  if(bw&&bw.lamps){
    var bst=META.beaconStats||{lit:0,half:0,dark:0};
    h+='<div class="beacon-panel"><div class="lb">灯 火 道 标</div>'
      +'<p class="bp-hint">开局前立一盏灯：这局投胎时朝它偏一手（只偏出身与天赋），'
      +'序章会点出哪盏灯暗着。<b>不保底、不锁抽签</b>——点不点得着，还是看你怎么选。</p><div class="bp-grid">';
    bw.lamps.forEach(function(k,ix){
      var on=(bsel===ix);
      var got=beaconStat(bw.key,ix);
      h+='<button class="bp-lamp'+(on?' on':'')+(got?' got':'')+'" onclick="__pkBook.beaconToggle(\''+bwl+'\','+ix+')" '
        +'title="'+k+(got?('　道标点着过 '+got+' 次'):'')+'">'+lampName(ix,bw.key)+(got?'<i>'+got+'</i>':'')+'</button>';
    });
    h+='</div>';
    h+='<div class="bp-foot">'+(bsel!=null
        ?('已立：<b>【'+lampName(bsel,bwl)+'】</b>　选一条世界线就开始这一生　'
          +'<button class="btn sm" onclick="__pkBook.beaconClear()">撤掉道标</button>')
        :('还没立道标。不立也行——那就是原来的“天注定”。'))
      +'<span class="bp-stat">道标记录：点着 '+bst.lit+' · 半亮 '+bst.half+' · 没点着 '+bst.dark+'</span></div></div>';
  }
  h+='<div class="wl-grid">';
  for(var k in LINE_META){
    var w=LINE_META[k];
    /* 跨周目进度：点亮的灯 + 已解锁的结局（都来自 META.codex） */
    var lampN=(w.lamps&&w.lamps.length)||0, lampGot=0;
    if(w.lamps)for(var li=0;li<w.lamps.length;li++){ if(META.codex.lamps[k+'_'+w.lamps[li]])lampGot++; }
    var endTot=(typeof w.endings==='number')?w.endings:12, endGot=0;
    for(var ek in META.codex.endings){ if(ek.indexOf(k+'_')===0)endGot++; }
    var pct=lampN?Math.round(lampGot/lampN*100):0;
    h+='<button class="wl" onclick="__pkBook.newGame(\''+k+'\')">'
      +'<div class="wl-hd"><b>'+w.name+'</b>'+(lampGot?'<span class="wl-badge">已探索</span>':'')+'</div>'
      +'<div class="d">'+w.sub+'</div>'
      +'<div class="wl-prog"><span class="wl-bar"><i style="width:'+pct+'%"></i></span>'
      +'<span class="wl-num">灯 '+lampGot+'/'+lampN+' · 结局 '+endGot+'/'+endTot+'</span></div>'
      +'<div class="m">'+w.meta+' · 12 章</div></button>';
  }
  h+='</div>';
  h+='<p class="center" style="margin-top:26px;font-size:13px">性别、姓名、家境、天赋由天定，玩家不挑。<br>'
    +'每通关一次获得 1 枚「回响」，可用于预知（1）与改命（3）。</p>'
    +'<p class="center" style="margin-top:12px"><button class="btn" onclick="__pkBook.showHelp()">玩法说明</button>'
    +' <button class="btn" onclick="__pkBook.showCodex()">看图鉴</button></p></div>';
  app.innerHTML=h;
}

function modal(html){
  var box=(typeof root!=='undefined'&&root)?root:document.body;
  /* 先关掉已有的浮层，避免连点按钮叠层 */
  var old=box.querySelectorAll('.mask');for(var i=0;i<old.length;i++)old[i].remove();
  var d=document.createElement('div');d.className='mask';
  d.innerHTML='<div class="modal">'+html+'<div style="text-align:right;margin-top:20px"><button class="btn" onclick="this.closest(\'.mask\').remove()">关闭</button></div></div>';
  d.addEventListener('click',function(e){if(e.target===d)d.remove()});
  (root||document.body).appendChild(d);
}
function showCodex(){
  /* 汇总格：有总数才画进度条 */
  function cell(label,got,tot,unit){
    var hasT=(typeof tot==='number');
    var pct=(hasT&&tot>0)?Math.round(got/tot*100):0;
    return '<div class="cx-cell"><div class="cx-k">'+label+'</div>'
      +'<div class="cx-v"><b>'+got+'</b>'+(hasT?'<span>/'+tot+'</span>':(unit?'<span> '+unit+'</span>':''))+'</div>'
      +(hasT?'<div class="cx-bar"><i style="width:'+pct+'%"></i></div>':'')
      +'</div>';
  }
  /* 只用一个循环：边渲染每行、边累计汇总。
     这样能直接复用 split.cjs 对「遍历世界线」那条 for 的既有重写
     （App 里会被换成轻量 meta，未加载任何世界线时也能列全），
     不必给它加新锚点 —— 那条 replace 链「只换首个匹配」，加锚点很容易误伤。
     注意：注释里不要写出该 for 语句的字面量，否则会抢在真代码之前被替换掉。 */
  var lampTot=0,lampGot=0,endTot=0;
  var lines='';
  for(var wk in LINE_META){
    var w=LINE_META[wk];
    var lg=0;
    w.lamps.forEach(function(k){if(META.codex.lamps[wk+'_'+k])lg++;});
    /* codex.endings 只存已解锁的，键形如「世界线_结局名」 */
    var got=Object.keys(META.codex.endings)
      .filter(function(x){return x.indexOf(wk+'_')===0})
      .map(function(x){return x.slice(wk.length+1)});
    var et=(typeof w.endings==='number')?w.endings:12;
    var pctL=w.lamps.length?Math.round(lg/w.lamps.length*100):0;

    lampTot+=w.lamps.length; lampGot+=lg; endTot+=et;

    lines+='<div class="cx-line"><div class="cx-hd"><b>'+w.name+'</b>'
      +'<span>灯 '+lg+'/'+w.lamps.length+' · 结局 '+got.length+'/'+et+'</span></div>'
      +'<div class="cx-bar"><i style="width:'+pctL+'%"></i></div>'
      +'<div class="grid cx-lamps" style="margin-top:9px">';
    w.lamps.forEach(function(k){
      var g=META.codex.lamps[wk+'_'+k];
      lines+='<div class="gc'+(g?' on':'')+'">'+(g?k:'?')+'<small>'+(g?'已点亮':'未点亮')+'</small></div>';
    });
    /* 结局槽位：已解锁显示名字，未解锁留一个「？」位置，让人知道还差几个 */
    lines+='</div><div class="grid cx-ends">';
    for(var i=0;i<et;i++){
      lines+= got[i]
        ? '<div class="gc on">'+got[i]+'<small>已抵达</small></div>'
        : '<div class="gc">？<small>未解锁</small></div>';
    }
    lines+='</div></div>';
  }
  var endGot=Object.keys(META.codex.endings).length;
  var evN=Object.keys(META.codex.events).length;

  var h='<h3>图鉴</h3><div class="ms">灯谱 / 结局 / 人生事件 —— 跨周目永久保留</div>';
  h+='<div class="cx-sum">'
    +cell('灯 谱',lampGot,lampTot)
    +cell('结 局',endGot,endTot)
    +cell('人生事件',evN,null,'种')
    +cell('通 关',META.runs||0,null,'次')
    +'</div>'+lines;
  h+='<div class="ms">已遭遇人生事件：'+evN+' 种</div>';
  modal(h);
}
function showAch(){
  var h='<h3>成就</h3><div class="ms">'+Object.keys(META.ach).length+' / '+ACHS.length+'</div>';
  ACHS.forEach(function(a){
    var got=META.ach[a.id];
    h+='<div class="ach'+(got?' got':'')+'"><div class="ic">'+(got?'◆':'◇')+'</div><div><div class="an">'+a.n+'</div><div class="ad">'+a.d+'</div></div></div>';
  });
  modal(h);
}
function showHelp(){
  modal('<h3>玩法</h3><div class="ms">五种属性、十八盏灯、十二种结局</div>'
   +'<p style="text-indent:0;font-size:14.5px"><b>属性</b>：体魄 / 心力 / 才学 / 人情 / 积蓄，范围 0–10。它们决定你能不能选某些选项，也决定随机事件的走向。</p>'
   +'<p style="text-indent:0;font-size:14.5px"><b>灯谱</b>：18 盏，每盏可累加。灯芯值＝所有灯等级之和；韧度＝灯被掐灭过的次数。</p>'
   +'<p style="text-indent:0;font-size:14.5px"><b>抉择锁</b>：灰掉的选项表示你此刻不具备条件——被锁死不是 bug，是你上一个选择的后果。</p>'
   +'<p style="text-indent:0;font-size:14.5px"><b>人生事件</b>：每章之间随机抽一张，结果按属性判定。同一事件一生只遇一次。</p>'
   +'<p style="text-indent:0;font-size:14.5px"><b>回响</b>：每通关一次 +1。预知（1 枚）显示选项后果；改命（3 枚）退回上一步重选。</p>'
   +'<p style="text-indent:0;font-size:14.5px"><b>结局</b>：18 盏灯分成 7 个互斥桶计分，外加 5 个特殊/隐藏结局，共 12 种。判定见《机制设计v2.md》。</p>'
   +'<p style="text-indent:0;font-size:14.5px"><b>灯火道标</b>：开局前可以在开始界面立一盏灯，这局投胎会朝它偏一手（只偏出身与天赋），序章会写明它此刻暗着。'
   +'<b>不保底</b>——点不点得着还是看你怎么选；稀有结局的阈值一概不变。</p>'
   +'<p style="text-indent:0;font-size:14.5px"><b>前尘</b>：上一局的<b>主灯</b>会跟着你进下一局（一出生就亮着），上一局没点亮的那盏则在这一局<b>亮不起来</b>；'
   +'上一局最后那个抉择，会在这一局以一张「旧账」事件卡回访一次。所以每一生给下一生留的东西，比一个数字多。</p>'
   +'<p style="text-indent:0;font-size:14.5px"><b>这一生</b>：结局页会把你这辈子的每个抉择按年龄排成一条时间线，标出每一步点了哪盏灯。</p>'
   +'<p style="text-indent:0;font-size:14.5px"><b>另一种可能（AI，可选）</b>：结局页可以让 AI 以“点灯最多的那一次抉择”为分岔口，写一段“没走的那条路”。它不改写已经发生的结局，只写那个回声。</p>'
   +'<p style="text-indent:0;font-size:14.5px"><b>AI（可选）</b>：配置任意 OpenAI 兼容接口后，可用于开局批注、结算散文、墓志铭三处。不配置也能完整游玩，全部内容离线可用。</p>');
}


function resetLine(){ S = null; render(); }
function bindHeader(){
  var g = function(id, fn){ var el = document.getElementById(id); if (el) el.onclick = fn; };
  g('bCodex', showCodex); g('bAch', showAch); g('bHelp', showHelp); g('bAI', showAI);
  g('bReset', function(){ if (confirm('放弃当前人生，重新开始？')) resetLine(); });
}

export class LifeBookPage {
  init(rootEl) {
    if (this._inited) return;
    this._inited = true;
    root = rootEl;
    app = rootEl.querySelector('.pkb-app');
    window.__pkBook = { go, choose, afterChoice, next, newGame, resume, peek, rewrite, showCodex, showAch, showHelp, showAI, aiPrologue, aiScroll, aiRetry, aiRwSet, resetLine, beaconToggle, beaconClear, chooseEv, aiAlt };
    bindHeader();
    startScreen();
  }
}
