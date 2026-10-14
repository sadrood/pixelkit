/* 一条命令跑全套回归
   用法：
     node tools/check-all.cjs            # 快线：语法/冒烟/兼现与存档/多样性/生成物一致性
     node tools/check-all.cjs --full     # 追加：《金灯无芯》逐利可达性（较慢，约 2-3 分钟）
     node tools/check-all.cjs --browser  # 追加：真机流式 + 整页 E2E（需要本机已起站点 + Edge）
   浏览器项需要 BOOK_URL（默认 http://localhost:3101/） */
const path = require('path'), { spawnSync } = require('child_process');
const args = process.argv.slice(2);
const dir = __dirname;
const proto = path.join(dir, '..', 'index.html');   // 子进程 cwd 在 tools/，必须用绝对路径

const steps = [
  ['原型冒烟（每线 120 局）', 'smoke.cjs', [proto, '120']],
  ['灯·兼现 / 存档续玩 / 图鉴', 'feature-check.cjs', []],
  ['内容多样性（跨线重复 + 同线重玩差异）', 'diversity-check.cjs', ['2']],
  ['灯的对立 / 回头账（不变量 + 稀有结局可达性）', 'core-check.cjs', []],
  ['生成物与母本一致性', 'check-generated.cjs', []],
];
if (args.includes('--full')) steps.push(['《金灯无芯》逐利可达性', 'gold-check.cjs', []]);
if (args.includes('--browser')) {
  steps.push(['真机流式（按秒采样字数）', 'ai-stream-check.mjs', []]);
  steps.push(['整页 E2E（桌面 + 移动）', 'book-page-e2e.mjs', []]);
}

let failed = 0;
const results = [];
for (const [title, file, argv] of steps) {
  process.stdout.write(`\n=== ${title} ===\n`);
  const r = spawnSync(process.execPath, [path.join(dir, file), ...argv], { stdio: 'inherit', cwd: dir });
  const ok = r.status === 0;
  if (!ok) failed++;
  results.push(`${ok ? '✓' : '✗'} ${title}`);
}

console.log('\n=========== 汇总 ===========');
results.forEach((l) => console.log('  ' + l));
console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
