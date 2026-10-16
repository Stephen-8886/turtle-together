param(
    [string]$AndroidTools="$PSScriptRoot/../.tools/android/unpacked",
    [string]$NanoHttpd="$PSScriptRoot/../.tools/android/nanohttpd.jar"
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath("$PSScriptRoot/..")
$androidProject=Join-Path $projectRoot 'clients/android'
$tools=(Get-ChildItem -LiteralPath $AndroidTools -Filter aapt2.exe -File -Recurse | Select-Object -First 1).DirectoryName
$androidJar=(Get-ChildItem -LiteralPath $AndroidTools -Filter android.jar -File -Recurse | Select-Object -First 1).FullName
if(!$tools -or !$androidJar -or !(Test-Path -LiteralPath $NanoHttpd)){throw '请先安装 Android 35 平台、build-tools 35 和 NanoHTTPD 2.3.1，或传入它们的目录。'}
$build=Join-Path $projectRoot ('.tools/android/build-'+[Guid]::NewGuid().ToString('N'))
$output=Join-Path $projectRoot 'dist/android'
New-Item -ItemType Directory -Force -Path $build,$output,(Join-Path $build 'classes'),(Join-Path $build 'dex'),(Join-Path $build 'generated') | Out-Null
& node (Join-Path $projectRoot 'scripts/prepare-clients.mjs')
if($LASTEXITCODE -ne 0){throw '客户端资源准备失败'}
Copy-Item -LiteralPath (Join-Path $androidProject 'app/src/main/res') -Destination (Join-Path $build 'res') -Recurse
Copy-Item -Path (Join-Path $androidProject 'app/src/debug/res/*') -Destination (Join-Path $build 'res') -Recurse -Force
$manifest=[IO.File]::ReadAllText((Join-Path $androidProject 'app/src/main/AndroidManifest.xml')).Replace('<manifest xmlns:android=','<manifest package="cn.turtle.together" xmlns:android=').Replace('<application android:label=','<application android:debuggable="true" android:label=')
[IO.File]::WriteAllText((Join-Path $build 'AndroidManifest.xml'),$manifest,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $build 'generated/BuildConfig.java'),'package cn.turtle.together; public final class BuildConfig { public static final boolean DEBUG=true; }',[Text.UTF8Encoding]::new($false))
function Check-Step([string]$name){if($LASTEXITCODE -ne 0){throw "$name 失败"}}
& (Join-Path $tools 'aapt2.exe') compile --dir (Join-Path $build 'res') -o (Join-Path $build 'resources.zip'); Check-Step '编译资源'
& (Join-Path $tools 'aapt2.exe') link -I $androidJar --manifest (Join-Path $build 'AndroidManifest.xml') --min-sdk-version 26 --target-sdk-version 35 --version-code 20000 --version-name '2.0.0-local' --java (Join-Path $build 'generated') -A (Join-Path $androidProject 'app/src/main/assets') -o (Join-Path $build 'unsigned.apk') (Join-Path $build 'resources.zip'); Check-Step '链接资源'
$javaSources=Get-ChildItem (Join-Path $androidProject 'app/src/main/java'),(Join-Path $build 'generated') -Filter '*.java' -File -Recurse | ForEach-Object { '"'+$_.FullName.Replace('\','/')+'"' }
[IO.File]::WriteAllLines((Join-Path $build 'sources.txt'),$javaSources,[Text.UTF8Encoding]::new($false))
& (Join-Path $env:JAVA_HOME 'bin/javac.exe') --release 17 -encoding UTF-8 -classpath "$androidJar;$NanoHttpd" -d (Join-Path $build 'classes') ('@'+(Join-Path $build 'sources.txt')); Check-Step '编译 Java'
& (Join-Path $env:JAVA_HOME 'bin/jar.exe') cf (Join-Path $build 'classes.jar') -C (Join-Path $build 'classes') .; Check-Step '生成类归档'
& (Join-Path $tools 'd8.bat') --lib $androidJar --min-api 26 --output (Join-Path $build 'dex') (Join-Path $build 'classes.jar') $NanoHttpd; Check-Step '生成 DEX'
& (Join-Path $env:JAVA_HOME 'bin/jar.exe') uf (Join-Path $build 'unsigned.apk') -C (Join-Path $build 'dex') classes.dex; Check-Step '打包 DEX'
& (Join-Path $tools 'zipalign.exe') -f 4 (Join-Path $build 'unsigned.apk') (Join-Path $build 'aligned.apk'); Check-Step '对齐 APK'
$keystore=Join-Path $projectRoot '.tools/android/debug.keystore'
if(!(Test-Path -LiteralPath $keystore)){& (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -keystore $keystore -storepass android -alias androiddebugkey -keypass android -dname 'CN=Turtle Local Development,O=Turtle,C=CN' -keyalg RSA -keysize 2048 -validity 10000; Check-Step '生成本地调试签名'}
$apk=Join-Path $output 'TurtleTogether-2.0.0-local.apk'
& (Join-Path $tools 'apksigner.bat') sign --ks $keystore --ks-pass pass:android --key-pass pass:android --out $apk (Join-Path $build 'aligned.apk'); Check-Step '签名 APK'
& (Join-Path $tools 'apksigner.bat') verify --verbose $apk; Check-Step '校验 APK'
Write-Output "本地测试 APK 已生成：$apk"
