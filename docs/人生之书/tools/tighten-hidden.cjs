/* 隐藏结局收紧：把各线的隐藏条件从"七盏灯各 ≥1"改成"各 ≥2（点亮到第二格）"
   随机压测显示原条件过于宽松（校园线 36% 就能拿到），改后可显著变稀有。
   用法：node tools/tighten-hidden.cjs  [--revert] */
const fs = require('fs'), path = require('path');
const repo = path.resolve(__dirname, '..', '..', '..');
const file = path.join(repo, 'docs/人生之书/index.html');
const revert = process.argv.includes('--revert');
const pairs = [
  ["if(L['念']>=1&&L['担']>=1&&L['路']>=1&&L['孝']>=1&&L['传']>=1&&L['归']>=1&&L['暖']>=1)",
   "if(L['念']>=2&&L['担']>=2&&L['路']>=2&&L['孝']>=2&&L['传']>=2&&L['归']>=2&&L['暖']>=2)"],
  ["if(L['频']>=1&&L['载']>=1&&L['轨']>=1&&L['燃']>=1&&L['播']>=1&&L['源']>=1&&L['温']>=1)",
   "if(L['频']>=2&&L['载']>=2&&L['轨']>=2&&L['燃']>=2&&L['播']>=2&&L['源']>=2&&L['温']>=2)"],
  ["if(L['忆']>=1&&L['扛']>=1&&L['行']>=1&&L['燃']>=1&&L['继']>=1&&L['返']>=1&&L['温']>=1)",
   "if(L['忆']>=2&&L['扛']>=2&&L['行']>=2&&L['燃']>=2&&L['继']>=2&&L['返']>=2&&L['温']>=2)"],
  ["if(L['问']>=1&&L['挑']>=1&&L['走']>=1&&L['供']>=1&&L['托']>=1&&L['还']>=1&&L['温']>=1)",
   "if(L['问']>=2&&L['挑']>=2&&L['走']>=2&&L['供']>=2&&L['托']>=2&&L['还']>=2&&L['温']>=2)"],
  ["if(L['念']>=1&&L['扛']>=1&&L['走']>=1&&L['孝']>=1&&L['传']>=1&&L['回']>=1&&L['暖']>=1)",
   "if(L['念']>=2&&L['扛']>=2&&L['走']>=2&&L['孝']>=2&&L['传']>=2&&L['回']>=2&&L['暖']>=2)"],
];
let src = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file + '.bak', src);
let n = 0;
for (const [loose, tight] of pairs) {
  const [from, to] = revert ? [tight, loose] : [loose, tight];
  const c = src.split(from).length - 1;
  if (c === 1) { src = src.replace(from, to); n++; console.log((revert ? '放宽' : '收紧') + '：' + from.slice(0, 46) + '…'); }
  else console.log('跳过（命中 ' + c + ' 次）：' + from.slice(0, 46) + '…');
}
fs.writeFileSync(file, src);
console.log(`\n完成 ${n}/5 条线。备份在 index.html.bak`);
