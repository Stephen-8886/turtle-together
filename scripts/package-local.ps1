$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath("$PSScriptRoot/..")
$stage=Join-Path $projectRoot ('dist/package-'+[Guid]::NewGuid().ToString('N'))
$windows=Join-Path $stage 'windows'
$android=Join-Path $stage 'android'
$backend=Join-Path $stage 'backend'
New-Item -ItemType Directory -Path $stage,$windows,$android,$backend | Out-Null
$builtWindows=Join-Path $projectRoot 'dist/windows/TurtleTogether'
foreach($entry in @('TurtleTogether.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','WebView2-LICENSE.txt','WebView2-NOTICE.txt','client-host.mjs','proxy.mjs','public','runtime')){
    Copy-Item -LiteralPath (Join-Path $builtWindows $entry) -Destination $windows -Recurse
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist/android/TurtleTogether-2.0.0-local.apk') -Destination $android
Copy-Item -LiteralPath (Join-Path $projectRoot 'clients/android/NanoHTTPD-LICENSE.txt') -Destination $android
foreach($entry in @('package.json','server.mjs','auth-server.mjs','server-clock.mjs','community-server.mjs','public')){
    Copy-Item -LiteralPath (Join-Path $projectRoot $entry) -Destination $backend -Recurse
}
$launcher=@'
@echo off
setlocal
cd /d "%~dp0"
if not defined DATA_DIR set "DATA_DIR=%LOCALAPPDATA%\TurtleTogetherBackend\data"
if not defined HOST set "HOST=127.0.0.1"
set "PORT=4173"
"%~dp0..\windows\runtime\node.exe" "%~dp0server.mjs"
pause
'@
[IO.File]::WriteAllText((Join-Path $backend 'start-backend.cmd'),$launcher.Replace("`n","`r`n"),[Text.ASCIIEncoding]::new())
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/local-clients.md') -Destination (Join-Path $stage '使用说明.md')
$zip=Join-Path $projectRoot 'dist/TurtleTogether-2.0.0-local.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
$sha=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($zip+'.sha256'),"$sha  TurtleTogether-2.0.0-local.zip`n",[Text.ASCIIEncoding]::new())
Write-Output "本地体验包：$zip"
Write-Output "SHA256：$sha"
