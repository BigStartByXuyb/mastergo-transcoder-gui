<#
    一条命令装客户端（不依赖 winget 源、不需要管理员、不跑安装程序）。

    winget 的 portable 包内部就是「下载 zip → 解压到自己的目录 → 建一个入口」；
    保密机上 winget 源不一定可用（清单要提交到公网 winget-pkgs 或由 IT 建内网源），
    这个脚本把那三步自己走一遍：下载 → 按清单里的 sha256 校验 → 解压到用户目录 → 建快捷方式。

    用法（普通用户权限即可）：
      powershell -ExecutionPolicy Bypass -File install-client.ps1
      powershell -ExecutionPolicy Bypass -File install-client.ps1 -Version 0.6.46
      powershell -ExecutionPolicy Bypass -File install-client.ps1 -Base https://git.公司.com/组/仓库 -Version 0.6.46

    参数：
      -Version  要装的版本；默认 latest（从清单里读当前最新）
      -Base     从哪个地址取（默认内置 GitHub 仓库；换公司 GitLab/内网目录时给这个）
      -Target   装到哪儿；默认 %LOCALAPPDATA%\MasterGoTranscoder（不需要管理员）
      -NoShortcut 不建桌面快捷方式

    装完：双击 Target 下的 mastergo-transcoder.exe，或直接运行它（它缺运行组件时自己补）。
#>
[CmdletBinding()]
param(
    [string] $Version = "latest",
    [string] $Base = "https://github.com/BigStartByXuyb/mastergo-transcoder-gui",
    [string] $Target = "$env:LOCALAPPDATA\MasterGoTranscoder",
    [switch] $NoShortcut
)

$ErrorActionPreference = "Stop"
$Base = $Base.TrimEnd("/")

function Step([string] $text) { Write-Host ("→ " + $text) }
function Fail([string] $text) { Write-Host ("✗ " + $text) -ForegroundColor Red; exit 1 }

# 1) 定版本：latest 就读远端清单里的版本号（那是发布时打上去的，不需要额外查 API）
if ($Version -eq "latest") {
    Step "读远端清单，看最新是哪一版：$Base/releases/latest/download/manifest.json"
    try {
        $manifest = Invoke-RestMethod -Uri "$Base/releases/latest/download/manifest.json" -TimeoutSec 60
    }
    catch {
        Fail "取不到清单：$($_.Exception.Message)。内网机器请用 -Base 指到内网地址。"
    }
    $Version = [string]$manifest.version
}
if (-not $Version) { Fail "没拿到版本号" }

$zipName = "mastergo-transcoder-gui-$Version.zip"
$zipUrl = "$Base/releases/download/v$Version/$zipName"
$yamlUrl = "$Base/releases/download/v$Version/BigStart.MasterGoTranscoder.installer.yaml"

# 2) 期望的 sha256：取同一次发布里的 winget 清单（那份里的 InstallerSha256 就是 zip 的哈希）
Step "取这一版的校验值：$yamlUrl"
try {
    # 资产是按 octet-stream 发的：Content 是字节数组，得自己按 UTF-8 解出来再匹配。
    $response = Invoke-WebRequest -UseBasicParsing -Uri $yamlUrl -TimeoutSec 60
    $yaml = if ($response.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($response.Content) } else { [string]$response.Content }
}
catch {
    Fail "取不到校验值：$($_.Exception.Message)"
}
$match = [regex]::Match($yaml, "InstallerSha256:\s*([0-9A-Fa-f]{64})")
if (-not $match.Success) { Fail "校验值里没找到 InstallerSha256" }
$expected = $match.Groups[1].Value.ToLower()

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
    Fail "校验不过：期望 $expected，实际 $actual。包可能不完整，重跑一次或换 -Base。"
}

# 4) 解压到用户目录（覆盖旧的；用户状态在 %LOCALAPPDATA%\MasterGoTranscoder 之外的地方不受影响）
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
Write-Host ("装好了：v" + $Version + " → " + $Target) -ForegroundColor Green
Write-Host ("双击 " + $exe + "（或桌面快捷方式）即可；它缺运行组件时自己补。")
