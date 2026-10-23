# 本地构建 + 云端发布的部署脚本
# 用途：服务器内存不足（1.7GB）无法稳定 vite build，改为本地构建后上传 dist 产物
# 用法：
#   pwsh scripts/deploy-prebuilt.ps1 -Target both -Message "本次改动说明"
#   pwsh scripts/deploy-prebuilt.ps1 -Target test
#   pwsh scripts/deploy-prebuilt.ps1 -Target main
param(
  [ValidateSet('test', 'main', 'both')]
  [string]$Target = 'both',
  [string]$Message = '',
  [string]$Server = 'root@139.9.176.191'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }

Step '1/5 本地构建（vite build）'
npm run build | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw 'npm run build 失败' }
if (-not (Test-Path 'dist/index.html')) { throw '构建失败：dist/index.html 不存在' }

Step '2/5 打包 dist'
$tgz = Join-Path $root '.tmp/dist.tgz'
New-Item -ItemType Directory -Force (Split-Path $tgz) | Out-Null
if (Test-Path $tgz) { Remove-Item $tgz -Force }
tar -czf $tgz -C dist .
$mb = [math]::Round((Get-Item $tgz).Length / 1MB, 2)
Write-Host "    dist.tgz = $mb MB"

Step '3/5 提交源码改动（若有）'
$changes = git status --porcelain | Where-Object { $_ -notmatch '^\?\?' } | Measure-Object | Select-Object -ExpandProperty Count
if ($changes -gt 0) {
  # 只提交已跟踪文件的改动 + scripts/docs 新增，避免把其它任务的未跟踪文件带上
  git add -u
  git add scripts docs 2>$null
  $msg = if ($Message) { $Message } else { "部署：$(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
  git commit -q -m $msg
  Write-Host "    已提交：$msg"
} else {
  Write-Host '    无未提交改动'
}

Step '4/5 上传预构建产物'
scp -o StrictHostKeyChecking=no $tgz "${Server}:/tmp/pk-dist-test.tgz" | Out-Null
scp -o StrictHostKeyChecking=no $tgz "${Server}:/tmp/pk-dist-main.tgz" | Out-Null
Write-Host '    已上传 test/main 两份产物'

Step '5/5 推送触发部署（服务器跳过构建）'
git commit --allow-empty -q -m "deploy: prebuilt $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
if ($Target -eq 'test' -or $Target -eq 'both') {
  git push deploy test | Select-Object -Last 4
}
if ($Target -eq 'main' -or $Target -eq 'both') {
  git push deploy test:main | Select-Object -Last 4
}

Start-Sleep -Seconds 8
$health = @'
curl -s -o /dev/null -w "prod:%{http_code} " http://127.0.0.1:8081/
curl -s -o /dev/null -w "test:%{http_code}\n" http://127.0.0.1:3002/
'@
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($health -replace "`r`n", "`n")))
$out = ssh -o StrictHostKeyChecking=no $Server "echo $b64 | base64 -d | bash"
Write-Host "    健康检查：$out" -ForegroundColor Green
Write-Host '部署完成。' -ForegroundColor Green
exit 0
