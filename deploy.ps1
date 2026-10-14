# ============================================================
# PixelKit One-Click Deploy (Windows / PowerShell)
# Usage: run .\deploy.ps1 in the project root
#
# What it does:
#   - Commit all changes
#   - Auto-detect current branch (test -> test env :3002 / main -> prod env :8081)
#   - Push to server, the server git hook does: deploy code -> npm install
#     -> vite build -> restart service
#
# Daily flow:
#   develop on test branch -> .\deploy.ps1 -> verify test env (port 3002)
#   after test passed      -> git checkout main && git merge test && .\deploy.ps1
# ============================================================

# ---- Server info (already configured) ----
$SERVER_USER = "root"
$SERVER_IP   = "139.9.176.191"
$SERVER_REPO = "pixelkit.git"
# -----------------------------------------

# Auto-detect current branch
$BRANCH = git rev-parse --abbrev-ref HEAD
Write-Host "Current branch: $BRANCH" -ForegroundColor Cyan
if ($BRANCH -eq "main") {
    Write-Host "WARNING: About to deploy to PRODUCTION (port 8081). Make sure tests passed first!" -ForegroundColor Yellow
} elseif ($BRANCH -ne "test") {
    Write-Host "WARNING: Branch '$BRANCH' is neither 'test' nor 'main'. Server may not have a hook for it." -ForegroundColor Yellow
}

# Ask for confirmation on production deploy
if ($BRANCH -eq "main") {
    $answer = Read-Host "Deploy to PRODUCTION? Type 'yes' to continue"
    if ($answer -ne "yes") {
        Write-Host "Deploy cancelled." -ForegroundColor Red
        exit 1
    }
}

# Commit and push
git add -A
if ($LASTEXITCODE -ne 0) {
    Write-Host "git add failed." -ForegroundColor Red
    exit 1
}
git commit -m "deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm') [$BRANCH]"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Nothing to commit? Or commit failed. Continuing to push anyway." -ForegroundColor Yellow
}
git push deploy $BRANCH

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Pushed ($BRANCH). Server is auto-deploying (npm install + build + restart)..." -ForegroundColor Green
    if ($BRANCH -eq "test") {
        Write-Host "Test env: http://$SERVER_IP:3002  (no auth by default)" -ForegroundColor Cyan
    } else {
        Write-Host "Prod env: http://$SERVER_IP:8081" -ForegroundColor Cyan
    }
} else {
    Write-Host "Push failed. Check: git remote -v" -ForegroundColor Red
}
