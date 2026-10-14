/* 【一次性脚本】给五条世界线各补 3 个与「寿数」相关的抉择（第 6/8/11 章）
 *
 * 为什么需要：2026-09-14 实测发现全 195 个抉择里只有 5 个能加体魄（每线 1 个、全在第 3 章），
 * 却有 20 个减体魄——"爱惜身体"这条路在内容层不存在，年龄维度因此拿不到正向回报。
 *
 * 做法：显式写 `years` 字段（引擎 v2.4 已支持 `if(ch.years)S.age+=ch.years`），
 * 其余抉择仍走引擎的默认规则（偏移 0）。这样"寿数"是少数抉择积累出来的结果。
 *
 * 用法：node tools/add-age-choices.cjs            # 改 docs/人生之书/index.html
 *       node tools/add-age-choices.cjs --dry      # 只报告将插入的位置，不写文件
 *
 * 幂等：已存在 k:'D' 的章节会跳过（重跑不会重复插入）。
 */
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..', '..', '..');
const FILE = path.join(repo, 'docs', '人生之书', 'index.html');
const DRY = process.argv.includes('--dry');

/* 五条线 × 三章 = 15 个新抉择。文风与外层保持一致：白描、具体、不解释。 */
const ADD = {
  origin: {
    6: `   {k:'D',t:'不再等那个消息，把心思放回自己身上',
    body:['你把窗子擦干净，把攒了几年的旧课本摞到墙角。那天以后你开始按时吃饭，夜里十一点前睡。没有人知道你在等什么，你自己也不说了。'],
    fx:{lamps:{守:1},attrs:{men:2,soc:-1}},years:2,hint:'守↑｜心力↑↑ 人情↓｜寿 +2'}`,
    8: `   {k:'D',t:'开始在意身体，少接一点活',
    body:['你把夜里那份活退了，改成早上绕桥走一圈。钱是少挣了，可你头一回觉得，天亮时候的风是有味道的。'],
    fx:{lamps:{暖:1},attrs:{vit:2,coin:-1}},years:2,hint:'暖↑｜体魄↑↑ 积蓄↓｜寿 +2'}`,
    11: `   {k:'D',t:'退了休，每天早起扫院子',
    body:['你把院子扫得很干净，扫完坐在门槛上晒太阳。医生的话你听进去了：慢一点，能多走几年。'],
    fx:{lamps:{暖:1},attrs:{vit:2,men:1,coin:-1}},years:3,hint:'暖↑｜体魄↑↑ 心力↑｜寿 +3'}`,
  },
  cyber: {
    6: `   {k:'D',t:'拒绝加装，按时下线',
    body:['你把神经链的时段调回了最基础的那一档。少挣的信用点你记在本子上，一次也没去补。'],
    fx:{lamps:{守:1},attrs:{vit:2,coin:-1}},years:2,hint:'守↑｜体魄↑↑ 信用点↓｜寿 +2'}`,
    8: `   {k:'D',t:'去做一次完整的义体维护',
    body:['维修舱的灯很白。技师问你多久没来了，你说记不清。醒来以后你摸着自己的手，第一次觉得这副身体是自己的。'],
    fx:{lamps:{念:1},attrs:{vit:2,coin:-2}},years:3,hint:'念↑｜体魄↑↑ 信用点↓↓｜寿 +3'}`,
    11: `   {k:'D',t:'定期维护，不再硬扛',
    body:['你终于学会在警报响之前就下线。灰雪落在窗外，你端着热的东西坐着，什么也没做。'],
    fx:{lamps:{暖:1},attrs:{vit:2,men:1}},years:3,hint:'暖↑｜体魄↑↑ 心力↑｜寿 +3'}`,
  },
  xianxia: {
    6: `   {k:'D',t:'不再强冲瓶颈，改温养经脉',
    body:['你把那股冲劲压下来，改为日日温养。同门笑你慢，你不辩解。三个月后，你的气反而稳了。'],
    fx:{lamps:{守:1},attrs:{vit:2,men:1}},years:2,hint:'守↑｜体魄↑↑ 心力↑｜寿 +2'}`,
    8: `   {k:'D',t:'花灵石换一炉养元的丹',
    body:['丹炉开的时候药香漫了半个院子。你把灵石数了三遍，还是买了。这一炉下去，你觉得自己又长回来一点。'],
    fx:{lamps:{暖:1},attrs:{vit:2,coin:-2}},years:3,hint:'暖↑｜体魄↑↑ 灵石↓↓｜寿 +3'}`,
    11: `   {k:'D',t:'放下争胜的心，在山里养灯',
    body:['你把灯挪到背风的地方，日日添油。山里的日子慢，慢到你能数清每一片落下来的叶子。'],
    fx:{lamps:{归:1},attrs:{vit:2,men:2}},years:3,hint:'归↑｜体魄↑↑ 心力↑↑｜寿 +3'}`,
  },
  minguo: {
    6: `   {k:'D',t:'不再进夜场，改成白天做账',
    body:['你把夜里的活推了，改成白天替人理账。钱是薄了，可你每天都能看见太阳落在算盘上。'],
    fx:{lamps:{守:1},attrs:{vit:2,coin:-1}},years:2,hint:'守↑｜体魄↑↑ 银元↓｜寿 +2'}`,
    8: `   {k:'D',t:'花钱请大夫调养',
    body:['大夫说你这是熬出来的病，得慢慢养。药很贵，你还是抓了三副，一副也没少。'],
    fx:{lamps:{暖:1},attrs:{vit:2,coin:-2}},years:3,hint:'暖↑｜体魄↑↑ 银元↓↓｜寿 +3'}`,
    11: `   {k:'D',t:'关掉铺子，回乡置一处院子',
    body:['匾额摘下来那天你没让人帮忙。院子里后来种了两棵石榴，秋天落一地红。'],
    fx:{lamps:{归:1},attrs:{vit:2,men:1,coin:-1}},years:3,hint:'归↑｜体魄↑↑ 心力↑｜寿 +3'}`,
  },
  xiaoyuan: {
    6: `   {k:'D',t:'不再抢那个职称，把作息调回来',
    body:['你把课表挪开一节，晚上不再备课到十二点。学生的本子还是那些，可你批得动了。'],
    fx:{lamps:{守:1},attrs:{vit:2,men:1,arc:-1}},years:2,hint:'守↑｜体魄↑↑ 心力↑ 才学↓｜寿 +2'}`,
    8: `   {k:'D',t:'每天跟学生一起跑操',
    body:['你站在队伍最前面，跑起来比谁都慢。学生笑你，你也笑。一学期下来，你的体检单好看了。'],
    fx:{lamps:{暖:1},attrs:{vit:2,soc:1}},years:3,hint:'暖↑｜体魄↑↑ 人情↑｜寿 +3'}`,
    11: `   {k:'D',t:'申请不带毕业班，把身体养回来',
    body:['你在办公室门口站了很久才开口。主任说，行啊，早该这样了。你忽然有点想哭。'],
    fx:{lamps:{暖:1},attrs:{vit:2,men:1}},years:3,hint:'暖↑｜体魄↑↑ 心力↑｜寿 +3'}`,
  },
};

/* 每个世界线 chapters 块的搜索范围（行号，1-based 转 0-based 由调用处处理） */
const WL = [
  ['origin', 700, 950],
  ['cyber', 1150, 1560],
  ['xianxia', 1540, 1925],
  ['minguo', 1905, 2290],
  ['xiaoyuan', 2270, 2660],
];

const raw = fs.readFileSync(FILE, 'utf8');
const hasCRLF = raw.includes('\r\n');
const lines = raw.replace(/\r\n/g, '\n').split('\n');

let inserted = 0, skipped = 0;
for (const [name, a, b] of WL) {
  let start = -1;
  for (let i = Math.max(0, a); i < b && i < lines.length; i++) {
    if (/^chapters:\[/.test(lines[i])) { start = i; break; }
  }
  if (start < 0) { console.error(`✗ 找不到 ${name} 的 chapters 块`); continue; }

  const starts = [];
  for (let i = start; i < b && i < lines.length; i++) {
    if (/^ \{/.test(lines[i])) starts.push(i);
    if (/^endings:/.test(lines[i])) break;
  }

  /* 从后往前插，避免行号位移 */
  for (let n = starts.length - 1; n >= 0; n--) {
    const chNo = n + 1;
    const add = ADD[name][chNo];
    if (!add) continue;
    const s0 = starts[n], s1 = starts[n + 1] || b;
    let ci = -1;
    for (let k = s0; k < s1 && k < lines.length; k++) {
      if (/^  choices:\[/.test(lines[k])) { ci = k; break; }
    }
    if (ci < 0) { console.error(`✗ ${name} 第${chNo}章 找不到 choices 块`); continue; }

    /* 用「字符级扫描」找 choices:[ 的配对右括号所在行：
       选项对象可能是多行的（如 {k:'C',t:...,cond:function(s){...},lock:..., 换行再 body:...），
       按「行首是不是 {k:'」来找最后一个选项会插进对象中间——上一版就是这么坏的。
       扫描时跳过字符串字面量与模板字面量，避免中文标点/引号里的括号干扰深度计数。 */
    const scan = (str, from) => {
      let depth = 0, i = from, q = null, tpl = false, esc = false;
      for (; i < str.length; i++) {
        const c = str[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (tpl) { if (c === '`') tpl = false; continue; }
        if (q) { if (c === q) q = null; continue; }
        if (c === '`') { tpl = true; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === '[') depth++;
        else if (c === ']') { depth--; if (depth === 0) return i; }
      }
      return -1;
    };
    const lineOffsets = [];
    { let acc = 0; for (let k = 0; k < lines.length; k++) { lineOffsets.push(acc); acc += lines[k].length + 1; } }
    const chunk = lines.slice(ci, s1).join('\n');
    const closeIdx = scan(chunk, chunk.indexOf('choices:[') + 'choices:['.length - 1);
    if (closeIdx < 0) { console.error(`✗ ${name} 第${chNo}章 choices 括号不配对`); continue; }
    const closeLine = ci + chunk.slice(0, closeIdx).split('\n').length - 1;

    /* 幂等：这一段里若已有 k:'D'，跳过 */
    if (chunk.slice(0, closeIdx).includes("k:'D'")) { skipped++; continue; }

    /* 插入点 = 配对右括号所在行的上一行（即最后一个选项对象的收尾行） */
    let lastOpt = closeLine - 1;
    while (lastOpt > ci && lines[lastOpt].trim() === '') lastOpt--;
    if (!/,\s*$/.test(lines[lastOpt])) lines[lastOpt] = lines[lastOpt].replace(/\}\s*$/, '},');
    lines.splice(lastOpt + 1, 0, ...add.split('\n'));
    inserted++;
    console.log(`  + ${name} 第${chNo}章 追加选项 D（插在第 ${lastOpt + 2} 行之前）`);
  }
}

console.log(`\n合计：新增 ${inserted} 个抉择，跳过(已存在) ${skipped} 个`);
if (inserted !== 15 - skipped) console.error(`⚠ 预期新增 ${15 - skipped} 个，实际 ${inserted} 个——请检查定位规则`);
if (DRY) { console.log('--dry：未写文件'); process.exit(0); }
fs.writeFileSync(FILE, lines.join(hasCRLF ? '\r\n' : '\n').replace(/\r\n/g, '\n'));
console.log('已写入 ' + FILE);
