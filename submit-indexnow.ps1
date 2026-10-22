# Submit ToolAdda PDF pages to IndexNow (Bing, Yandex, etc.)
# Run in PowerShell from the C:\Projects\toolsa folder AFTER the key file is live on the site:
#   https://tooladda.online/42e7905bc10d06e4a3dfaa7a9fd01576.txt
# Usage:  powershell -ExecutionPolicy Bypass -File .\submit-indexnow.ps1

$body = Get-Content -Raw -Path ".\indexnow-submit.json"
$resp = Invoke-WebRequest -Uri "https://api.indexnow.org/indexnow" `
    -Method POST `
    -ContentType "application/json; charset=utf-8" `
    -Body $body

Write-Host "HTTP status:" $resp.StatusCode
Write-Host "Response:" $resp.Content
# 200 or 202 = accepted. 403 = key file not found/verified on the domain yet.
