param([string]$WebViewSdk = "$PSScriptRoot/../.tools/webview2/sdk")
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath("$PSScriptRoot/..")
$outputDir=Join-Path $projectRoot 'dist/windows/TurtleTogether'
New-Item -ItemType Directory -Force -Path $outputDir,(Join-Path $outputDir 'runtime') | Out-Null
& node (Join-Path $projectRoot 'scripts/prepare-clients.mjs')
if($LASTEXITCODE -ne 0){throw '客户端资源准备失败'}
foreach($entry in @('client-host.mjs','proxy.mjs','public')){Copy-Item -LiteralPath (Join-Path $projectRoot "clients/windows/$entry") -Destination $outputDir -Recurse -Force}
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $outputDir 'runtime/node.exe')
foreach($assembly in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')){Copy-Item -LiteralPath (Join-Path $WebViewSdk "lib/net462/$assembly") -Destination $outputDir}
Copy-Item -LiteralPath (Join-Path $WebViewSdk 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $outputDir
Copy-Item -LiteralPath (Join-Path $WebViewSdk 'LICENSE.txt') -Destination (Join-Path $outputDir 'WebView2-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $WebViewSdk 'NOTICE.txt') -Destination (Join-Path $outputDir 'WebView2-NOTICE.txt')
Copy-Item -LiteralPath (Join-Path $projectRoot 'clients/windows/Node-LICENSE.txt') -Destination (Join-Path $outputDir 'runtime/LICENSE.txt')
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:winexe /platform:x64 "/out:$outputDir/TurtleTogether.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/reference:$outputDir/Microsoft.Web.WebView2.Core.dll" "/reference:$outputDir/Microsoft.Web.WebView2.WinForms.dll" (Join-Path $projectRoot 'clients/windows/TurtleTogether.cs')
if($LASTEXITCODE -ne 0){throw 'Windows 编译失败'}
Write-Output "Windows exe 已生成：$outputDir/TurtleTogether.exe"
