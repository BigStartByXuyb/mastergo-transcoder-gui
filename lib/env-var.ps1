param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$Value,
  [switch]$Clear
)

$ErrorActionPreference = 'Stop'

$result = [ordered]@{
  name = $Name
  process = ''
  user = ''
  machine = ''
  written = $false
}

# 只在显式给了值或 Clear 时才写；两者都没给就是纯读。
if ($Clear -or $PSBoundParameters.ContainsKey('Value')) {
  $next = $null
  if (-not $Clear) { $next = $Value }
  [Environment]::SetEnvironmentVariable($Name, $next, 'User')
  $result.written = $true

  # 通知已经在跑的进程（资源管理器）刷新环境块，否则从资源管理器起的新窗口还是老值。
  # 这段失败不影响写入结果，所以单独兜住。
  try {
    $signature = '[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'
    $native = Add-Type -MemberDefinition $signature -Name NativeMethods -Namespace Win32 -PassThru
    $previous = [UIntPtr]::Zero
    $native::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$previous) | Out-Null
  }
  catch { }
}

$result.process = [Environment]::GetEnvironmentVariable($Name, 'Process')
$result.user = [Environment]::GetEnvironmentVariable($Name, 'User')
$result.machine = [Environment]::GetEnvironmentVariable($Name, 'Machine')

$result | ConvertTo-Json -Compress | Set-Content -LiteralPath $OutFile -Encoding UTF8
