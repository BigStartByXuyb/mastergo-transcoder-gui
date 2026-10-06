<#
    一条命令装客户端（不依赖 winget 源、不需要管理员、不跑安装程序）。

    winget 的 portable 包内部就是「下载 zip → 解压到自己的目录 → 建一个入口」；
    保密机上 winget 源不一定可用（清单要提交到公网 winget-pkgs，或由 IT 建内网源），
    这个脚本把那三步自己走一遍：下载 → 按发布时那份 checksums.json 校验 → 解压到用户目录 → 建快捷方式。

    用法（普通用户权限即可）：
      powershell -ExecutionPolicy Bypass -File install-client.ps1
      powershell -ExecutionPolicy Bypass -File install-client.ps1 -Version 0.6.47
      # 内网 / GitLab / 任意镜像：地址长什么样由那边决定，这里不猜 —— 直接给 zip 直链与它的 sha256
      powershell -ExecutionPolicy Bypass -File install-client.ps1 -ZipUrl <zip 直链> -Sha256 <64 位哈希>

    机器上还没有这个脚本时（一条命令取下来再跑）：
      $u = "<基址>/releases/latest/download/install-client.ps1"; $f = "$env:TEMP\install-client.ps1"
      Invoke-WebRequest -UseBasicParsing $u -OutFile $f; powershell -ExecutionPolicy Bypass -File $f

    参数：
      -Version  要装的版本；默认 latest（从远端清单读当前最新）
      -Base     从哪个基址取（**只支持 GitHub 形状**：<基址>/releases/…）。
                默认值与 lib/source.js 的 DEFAULT_BASE 一致，换默认源时两处一起改（有用例盯着不许漂）。
      -ZipUrl   直接给 zip 的完整地址（配 -Sha256 一起用）；给了它就不查版本、不查 checksums.json
      -Sha256   上面那个 zip 的 sha256（十六进制）
      -Target   装到哪儿；默认 %LOCALAPPDATA%\MasterGoTranscoder（不需要管理员）
      -NoShortcut 不建桌面快捷方式

    装完：双击 Target 下的 mastergo-transcoder.exe，或直接运行它（它缺运行组件时自己补）。
#>
[CmdletBinding()]
param(
    [string] $Version = "latest",
    # 与 lib/source.js 的 DEFAULT_BASE 保持一致（tests/install-client.test.js 会盯着这两处别漂）。
    [string] $Base = "https://github.com/BigStartByXuyb/mastergo-transcoder-gui",
    [string] $ZipUrl = "",
    [string] $Sha256 = "",
    [string] $Target = "$env:LOCALAPPDATA\MasterGoTranscoder",
    [switch] $NoShortcut
)

$ErrorActionPreference = "Stop"

# Windows PowerShell 5.1 默认可能只开 TLS 1.0，而 GitHub 只收 TLS 1.2+；显式打开，PowerShell 7 上无副作用。
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$Base = $Base.TrimEnd("/")

function Step([string] $text) { Write-Host ("→ " + $text) }
function Fail([string] $text) { Write-Host ("✗ " + $text) -ForegroundColor Red; exit 1 }

if ($ZipUrl) {
    # 非 GitHub 形状的来源：地址与哈希都由调用方给全，这里只负责下载、校验、解压。
    if ($Sha256 -notmatch "^[0-9A-Fa-f]{64}$") { Fail "-ZipUrl 要配一份 -Sha256（64 位十六进制）" }
    $zipUrl = $ZipUrl
    $zipName = Split-Path $zipUrl -Leaf
    $expected = $Sha256.ToLower()
    $label = "指定的直链"
}
else {
    # 1) 定版本：latest 就读远端清单里的版本号（那是发布时打上去的，不需要额外查 API）
    if ($Version -eq "latest") {
        Step "读远端清单，看最新是哪一版：$Base/releases/latest/download/manifest.json"
        try {
            $manifest = Invoke-RestMethod -Uri "$Base/releases/latest/download/manifest.json" -TimeoutSec 60
        }
        catch {
            Fail "取不到清单：$($_.Exception.Message)。内网机器请用 -ZipUrl 直接给 zip 地址与哈希。"
        }
        $Version = [string]$manifest.version
    }
    if (-not $Version) { Fail "没拿到版本号" }

    $zipName = "mastergo-transcoder-gui-$Version.zip"
    $zipUrl = "$Base/releases/download/v$Version/$zipName"

    # 2) 期望的哈希：取同一次发布里的 checksums.json（专门给安装用的那一份，不去啃 winget 清单）
    $sumsUrl = "$Base/releases/download/v$Version/checksums.json"
    Step "取这一版的校验值：$sumsUrl"
    try {
        $sums = Invoke-RestMethod -Uri $sumsUrl -TimeoutSec 60
    }
    catch {
        Fail "取不到校验值：$($_.Exception.Message)。也可以用 -ZipUrl + -Sha256 直接指定。"
    }
    if (-not $sums.zip -or -not $sums.zip.sha256) { Fail "checksums.json 里没有 zip.sha256" }
    $expected = ([string]$sums.zip.sha256).ToLower()
    $label = "v$Version"
}

# 3) 下载 + 校验
$work = Join-Path $env:TEMP ("mgtg-install-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$zip = Join-Path $work $zipName
Step "下载 $zipName"
try {
    Invoke-WebRequest -UseBasicParsing -Uri $zipUrl -OutFile $zip -TimeoutSec 900
}
catch {
    Fail "下载失败：$($_.Exception.Message)"
}
Step "校验 sha256"
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) {
    Remove-Item $zip -Force
    Fail "校验不过：期望 $expected，实际 $actual。包可能不完整，重跑一次或换来源。"
}

# 4) 解压到用户目录（覆盖旧的；用户状态不在这里，不受影响）
$stage = Join-Path $work "unpack"
Step "解压到 $Target"
Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
$inner = Get-ChildItem $stage -Directory | Select-Object -First 1
if (-not $inner) { Fail "包里没有目录，下载的是不是 zip？" }
if (Test-Path $Target) { Remove-Item $Target -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Split-Path $Target) | Out-Null
Move-Item $inner.FullName $Target
Remove-Item $work -Recurse -Force

$exe = Join-Path $Target "mastergo-transcoder.exe"
if (-not (Test-Path $exe)) { Fail "解压后没找到 $exe" }

# 5) 桌面快捷方式（可选）
if (-not $NoShortcut) {
    Step "建桌面快捷方式"
    try {
        $shell = New-Object -ComObject WScript.Shell
        $link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "MasterGo 转码客户端.lnk"))
        $link.TargetPath = $exe
        $link.WorkingDirectory = $Target
        $link.Save()
    }
    catch {
        Write-Host ("  快捷方式没建上（不影响使用）：" + $_.Exception.Message) -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host ("装好了：" + $label + " → " + $Target) -ForegroundColor Green
Write-Host ("双击 " + $exe + "（或桌面快捷方式）即可；它缺运行组件时自己补。")
