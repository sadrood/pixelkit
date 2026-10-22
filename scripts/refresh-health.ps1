$ErrorActionPreference = 'Stop'
Set-Location 'D:\aaa\work\work\workbuddy\new pinxlkite\pixelkit-source'
$log = Join-Path $PSScriptRoot '..\..\..\health-refresh.log'
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 开始刷新探活数据" | Add-Content $log
node scripts/fetch-health.mjs *>> $log
node scripts/probe-streams.mjs 3000 *>> $log
node -e "const fs=require('fs');const raw=JSON.parse(fs.readFileSync('public/data/station-health.json','utf8'));if(!raw.deadIds){const dead=[];let alive=0;for(const [id,v] of Object.entries(raw.items)){if(v[0]===1)alive++;else dead.push(id)};fs.writeFileSync('public/data/station-health.json',JSON.stringify({builtAt:raw.builtAt,source:raw.source,total:raw.total,alive,dead:dead.length,deadIds:dead}))}" *>> $log
npm run build *>> $log
git add public/data/station-health.json public/data/health-probe.json | Out-Null
git commit -m "定时刷新探活数据 $(Get-Date -Format 'yyyy-MM-dd')" *>> $log
git push deploy test *>> $log
git push deploy test:main *>> $log
git branch -f main test
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 完成" | Add-Content $log