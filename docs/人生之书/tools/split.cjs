/* 把 docs/人生之书/index.html 的原型拆成 PixelKit 站点页面：
   - src/pages/life/book/data.js      五条世界线 + 桶/成就/灯·兼现文案/默认出身天赋
   - src/pages/LifeBookPage.js        引擎（源码级切分，逻辑与原版一致，仅做站点适配）
   - src/styles/life-book.css         原样式作用域化到 .pkb
   运行：node split.cjs */
const fs = require('fs'), path = require('path');
// 本文件位于 <repo>/docs/人生之书/tools/，向上三级即仓库根
const repo = path.resolve(__dirname, '..', '..', '..');
// 母本本身是 CRLF：统一按 LF 读入，否则切出来的产物会带着 CRLF 片段，
// 导致 Windows 本地与 Linux 服务器的字节数不一致（内容虽同，但比对/校验会误报）
const src = fs.readFileSync(path.join(repo, 'docs/人生之书/index.html'), 'utf8').replace(/\r\n/g, '\n');
const css = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const script = (src.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
if (!css || !script) throw new Error('提取 style/script 失败');

// 产物一律写成 LF，保证同一份母本在任何平台切出来的字节完全一致
const writeText = (file, text) => fs.writeFileSync(file, String(text).replace(/\r\n/g, '\n'), 'utf8');

/* ================= 1. CSS 作用域化 ================= */
const SCOPE = '.pkb';
function splitRules(text) {
  const rules = []; let i = 0, buf = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      const sel = buf.trim(); buf = '';
      let depth = 1, j = i + 1;
      while (j < text.length && depth > 0) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      rules.push({ sel, body: text.slice(i + 1, j - 1) });
      i = j;
    } else { buf += ch; i++; }
  }
  if (buf.trim()) rules.push({ sel: buf.trim(), body: null });
  return rules;
}
function prefixSel(sel) {
  return sel.split(',').map((s) => {
    s = s.trim(); if (!s) return '';
    if (s === ':root' || s === 'html' || s === 'body' || s === '*') return s === '*' ? SCOPE + ' *' : SCOPE;
    if (/^(html|body)\b/.test(s)) return SCOPE;
    if (s.startsWith(SCOPE)) return s;
    return SCOPE + ' ' + s;
  }).filter(Boolean).join(',');
}
function scopeRules(text, indent) {
  const out = [];
  for (const r of splitRules(text)) {
    if (r.body === null) continue;
    if (/^@keyframes/.test(r.sel)) { out.push(r.sel + '{' + r.body + '}'); continue; }
    if (/^@media/.test(r.sel)) { out.push(r.sel + '{' + scopeRules(r.body, indent + '  ') + '}'); continue; }
    if (/^@(font-face|import|supports|charset)/.test(r.sel)) { out.push(r.sel + '{' + r.body + '}'); continue; }
    out.push(prefixSel(r.sel) + '{' + r.body.trim() + '}');
  }
  return out.join('\n' + indent);
}
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const scopedCss = `/* 人生之书 · 玩法加厚版 v2 —— 由 docs/人生之书/index.html 的样式作用域化而来（前缀 .pkb）
   勿手改：改样式请改原型后再跑一次切分脚本；本文件仅在 index.html 中于 life.css 之后引入 */
${scopeRules(noComments, '')}
/* —— 站点外壳适配 —— */
/* 纸张四周原本直接露出站点背景（body::before 的暖色渐变），显得发浑；
   这里给工作区一层不透明的暖底，再给纸张加投影，让它读起来是「桌上的纸」而不是没铺满 */
.book-workspace{ height:100%; overflow:auto; scrollbar-gutter:stable; padding:20px 12px 24px;
  background:var(--bg-tertiary,#f7f4ef); }
${SCOPE}{ background:var(--paper); color:var(--ink); font-family:"Songti SC","SimSun","Noto Serif CJK SC",Georgia,serif;
  font-size:17px; line-height:1.95; letter-spacing:.02em; border-radius:14px; padding:0 0 8px;
  max-width:1180px; margin:0 auto; box-shadow:0 12px 36px -22px rgba(28,27,26,.28), 0 2px 6px -2px rgba(28,27,26,.06); }
${SCOPE} .pkb-bar{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:10px 20px; border-bottom:1px solid var(--line); }
${SCOPE} .pkb-bar .pkb-bar-title{ font-size:13px; letter-spacing:.18em; color:var(--ink2); }
${SCOPE} .pkb-bar .pkb-sp{ flex:1; }
${SCOPE} .wrap{ padding-top:18px; }
@media (max-width:880px){ ${SCOPE} .pkb-bar{ padding:8px 12px; } }
`;

/* ================= 2. 数据切分 ================= */
function cut(anchor, endRe) {
  const s = script.indexOf(anchor);
  if (s < 0) throw new Error('缺少锚点: ' + anchor);
  const rest = script.slice(s);
  const m = rest.match(endRe);
  if (!m) throw new Error('缺少结束标记: ' + anchor);
  return rest.slice(0, m.index + m[0].length);
}
const pieces = [];
const data = {
  BUCKETS: cut('var BUCKETS=[', /\n\];/),
  ACHS: cut('var ACHS=[', /\n\];/),
  LAMP_TELL: cut('var LAMP_TELL=[', /\n\];/),
  FAMILIES: cut('var FAMILIES=[', /\n\];/),
  TALENTS: cut('var TALENTS=[', /\n\];/),
};
pieces.push(...Object.values(data));
const wlVars = { origin: 'ORIGIN', cyber: 'CYBER', xianxia: 'XIANXIA', minguo: 'MINGUO', xiaoyuan: 'XIAOYUAN' };
const wlCode = {};
for (const [key, v] of Object.entries(wlVars)) {
  wlCode[key] = cut(`var ${v}={`, /\n\};/);
  pieces.push(wlCode[key]);
}

/* ---- 每条线生成独立模块 + 轻量元数据（首屏只加载 meta，选线时才下载那条线的全文） ---- */
function countChapters(code) {
  const at = code.indexOf('chapters:[');
  if (at < 0) return 0;
  const open = code.indexOf('[', at);
  let i = open + 1, depth = 1, n = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < code.length) { if (code[i] === '\\') { i += 2; continue; } if (code[i] === q) break; i++; }
      i++; continue;
    }
    if (c === '{') {
      if (depth === 1) n++;
      let d2 = 0, j = i, quote = null;
      for (; j < code.length; j++) {
        const cj = code[j];
        if (quote) { if (cj === '\\') { j++; continue; } if (cj === quote) quote = null; continue; }
        if (cj === "'" || cj === '"' || cj === '`') { quote = cj; continue; }
        if (cj === '{') d2++;
        else if (cj === '}') { d2--; if (d2 === 0) break; }
      }
      i = j + 1; continue;
    }
    if (c === '[') { depth++; i++; continue; }
    if (c === ']') { depth--; if (depth <= 0) break; i++; continue; }
    i++;
  }
  return n;
}
function metaOf(code) {
  const g = (re) => (code.match(re) || [])[1] || '';
  const lampsRaw = g(/\blamps:\[([^\]]*)\]/);
  const lampsList = lampsRaw.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  return {
    name: g(/\bname:'([^']+)'/), sub: g(/\bsub:'([^']+)'/), meta: g(/\bmeta:'([^']+)'/),
    prologueTitle: g(/\bprologueTitle:'([^']+)'/) || '序章',
    /* lamps 保持为"灯名数组"（图鉴要按名字列出），另给一个数量字段供开始界面文案使用 */
    lamps: lampsList, lampsCount: lampsList.length,
    chapters: countChapters(code),
    endings: (code.match(/mkEnd\(/g) || []).length,
  };
}
const linesDir = path.join(repo, 'src/pages/life/book/lines');
fs.mkdirSync(linesDir, { recursive: true });
const metaLines = [];
for (const [key, v] of Object.entries(wlVars)) {
  const code = wlCode[key];
  metaLines.push(`  ${key}: ${JSON.stringify(metaOf(code))},`);
  const mod = `// 自动生成：${metaOf(code).name}（来自 docs/人生之书/index.html 的 ${v} 段）
// 按需加载：只有玩家真的进这条世界线时才会下载这一份文本
export function make(H) {
  const { mkEnd, pick, sumLamps } = H;
${code}
  return ${v};
}
`;
  writeText(path.join(linesDir, `${key}.js`), mod);
}
const dataJs = `// 自动生成：来自 docs/人生之书/index.html（玩法加厚版 v2 原型）的公共数据段
// 五条世界线的正文分别在 ./lines/<key>.js，按需动态 import（首屏只带下面的 meta）
// 结局分桶 / 成就 / 灯·兼现文案 / 默认出身天赋池都在这里
// 改文本：改原型后重跑切分脚本（tools/split.cjs）

export ${data.BUCKETS}

export ${data.ACHS}

export ${data.LAMP_TELL}

export ${data.FAMILIES}

export ${data.TALENTS}

export const LINE_META = {
${metaLines.join('\n')}
};

const LINE_LOADERS = {
${Object.keys(wlVars).map((k) => `  ${k}: () => import('./lines/${k}.js'),`).join('\n')}
};

export async function loadLine(key, H) {
  const m = await LINE_LOADERS[key]();
  return m.make(H);
}
`;

/* ================= 3. 引擎 ================= */
let engine = script;
for (const p of pieces) engine = engine.replace(p, '');
engine = engine
  .replace('var WORLDLINES={};', '')
  .replace(/WORLDLINES\.(origin|cyber|xianxia|minguo|xiaoyuan)=[A-Z]+;\n?/g, '')
  .replace('var app=document.getElementById(\'app\');', 'var app=null, root=null;')
  // 存档/AI 的 localStorage 键加站点前缀，避免与原型/其他页面互相覆盖
  .replace("'renshzh_v2_meta'", "'pkbook2_meta'")
  .replace("'renshzh_v2_save'", "'pkbook2_save'")
  // 浮层挂到页面容器内（作用域样式才生效；也让 .mask 能盖住本页）
  .replace(/document\.body\.appendChild\(/g, '(root||document.body).appendChild(')
  .replace('if(!document.body)return;', 'if(!root)return;')
  /* —— 按世界线懒加载：只改入口与图鉴/开始界面的数据来源，其余逻辑不动 —— */
  .replace('function newGame(wk){', "async function newGame(wk){\n  try{ await ensureLine(wk); }catch(e){ toast('世界线加载失败：'+((e&&e.message)||e)); return; }")
  .replace(/function resume\(\)\{/, 'async function resume(){')
  .replace('var d=loadGame();if(!d)return;', "var d=loadGame();if(!d)return;\n  try{ await ensureLine(d.wl); }catch(e){ toast('世界线加载失败'); return; }")
  .replace('!WORLDLINES[d.wl]', '!LINE_META[d.wl]')
  .replace('var w0=WORLDLINES[sv.wl];', 'var w0=LINE_META[sv.wl];')
  .replace('for(var k in WORLDLINES){', 'for(var k in LINE_META){')
  .replace('var w=WORLDLINES[k];', 'var w=LINE_META[k];')
  .replace("' · 18 灯 · 12 章 · 12 结局</div>'", "' · '+w.lampsCount+' 灯 · '+w.chapters+' 章 · '+w.endings+' 结局</div>'")
  .replace('for(var wk in WORLDLINES){', 'for(var wk in LINE_META){')
  .replace('var w=WORLDLINES[wk];', 'var w=LINE_META[wk];')
  /* 上面那条 replace 只换首个匹配，会误伤 newGame 的 `var w=WORLDLINES[wk]; W=w;`（那里必须用已加载的线数据），
     而图鉴那句（第二个匹配）反而没换到——它遍历 meta，必须在"只加载了部分世界线"时也能列全 18 盏灯。逐个定点修正： */
  .replace('var w=LINE_META[wk]; W=w;', 'var w=WORLDLINES[wk]; W=w;')
  .replace(/for\(var wk in LINE_META\)\{\s*\r?\n\s*var w=WORLDLINES\[wk\];/, 'for(var wk in LINE_META){\n    var w=LINE_META[wk];')
  // 清掉残留的数据段注释（世界线内容已移入 data.js）
  .replace('/* ---------- 世界线数据（在下方注册） ---------- */', '')
  .replace(/\/\* =+\s*\n\s*世界线 [B-E]：[\s\S]*?=+ \*\/\n?/g, '')
  // 行内 onclick → 命名空间（模块作用域里没有全局函数）
  .replace(/onclick="([A-Za-z_$][\w$]*)\(/g, 'onclick="__pkBook.$1(')
  .replace('onclick="S=null;render()"', 'onclick="__pkBook.resetLine()"');
/* 3.1 AI 层：改走站点服务端代理（密钥不进浏览器，避免直连网关的 CORS/混合内容问题） */
const aiStart = engine.indexOf('var AI_KEY=');
const aiEnd = engine.indexOf('function showAI(){');
if (aiStart < 0 || aiEnd < 0) throw new Error('AI 段定位失败');
const aiNew = `/* ---------- AI 增强层（经站点服务端代理；流式逐字返回，未配置 Key 时降级为内置文案） ----------
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
          var lines=buf.split('\\n');buf=lines.pop();
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
  return '<div style="margin-top:8px"><button class="btn" onclick="__pkBook.aiRetry(\\''+kind+'\\')">↻ 重试</button></div>';
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
         .map(function(x){return tok(String(x))}).join('\\n').trim();
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
`;
engine = engine.slice(0, aiStart) + aiNew + engine.slice(aiEnd);

/* 3.2 showAI：不再让玩家填接口，改成说明（AI 由站点服务端提供） */
const showAiStart = engine.indexOf('function showAI(){');
const showAiEnd = engine.indexOf('function saveAIfromForm(){');
if (showAiStart < 0 || showAiEnd < 0) throw new Error('showAI 段定位失败');
engine = engine.slice(0, showAiStart) + `function showAI(){
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
` + engine.slice(showAiEnd);
const clearAiStart = engine.indexOf('function clearAI(){');
if (clearAiStart >= 0) {
  const end = engine.indexOf('\n}', clearAiStart);
  engine = engine.slice(0, clearAiStart) + engine.slice(end + 2);
}

/* 3.3 尾部 bootstrap → init() 绑定 + window.__pkBook 句柄 */
const bootStart = engine.indexOf("document.getElementById('bCodex').onclick=showCodex;");
if (bootStart < 0) throw new Error('bootstrap 段定位失败');
engine = engine.slice(0, bootStart);

const handles = ['go', 'choose', 'afterChoice', 'next', 'newGame', 'resume', 'peek', 'rewrite',
  'showCodex', 'showAch', 'showHelp', 'showAI', 'aiPrologue', 'aiScroll', 'aiRetry', 'aiRwSet', 'resetLine',
  /* v2.4 玩法层：灯火道标的选择与撤销（行内 onclick 用） */
  'beaconToggle', 'beaconClear',
  /* v2.5 玩法层：事件卡选项（行内 onclick 用）——漏登记的后果是线上点了报 undefined */
  'chooseEv',
  /* v2.6：结局页 AI「另一种可能」 */
  'aiAlt'];
const out = `// 人生之书 · 玩法加厚版 v2 —— 站点页面引擎
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

${engine}
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
    window.__pkBook = { ${handles.join(', ')} };
    bindHeader();
    startScreen();
  }
}
`;
writeText(path.join(repo, 'src/pages/life/book/data.js'), dataJs);
writeText(path.join(repo, 'src/pages/LifeBookPage.js'), out);
writeText(path.join(repo, 'src/styles/life-book.css'), scopedCss);
console.log('data.js    ' + dataJs.length + ' 字节');
console.log('LifeBookPage.js ' + out.length + ' 字节');
console.log('life-book.css   ' + scopedCss.length + ' 字节');
console.log('引擎里残留 WORLDLINES. 注册: ' + /WORLDLINES\.(origin|cyber|xianxia|minguo|xiaoyuan)=/.test(out));
console.log('残留 document.body.appendChild: ' + (out.match(/document\.body\.appendChild/g) || []).length);
console.log('残留 renshzh_v2_ 键名: ' + (out.match(/renshzh_v2_/g) || []).length);
console.log('未命名空间化的 onclick: ' + (out.match(/onclick="(?!__pkBook|this\.)/g) || []).length);
