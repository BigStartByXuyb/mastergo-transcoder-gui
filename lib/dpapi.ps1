<#
    用 Windows DPAPI（CurrentUser 域）加解密字符串。

    为什么走 PowerShell：Node 没有内置的 DPAPI 绑定，而 ProtectedData 类型在
    PowerShell 7（.NET Core）里不随附；ConvertFrom-SecureString 在 Windows 上
    正是用 DPAPI 保护的，7 里可用。

    接口：明文/密文从 stdin 读，结果写 stdout，避免命令行引号转义问题。
    用法： pwsh -NoProfile -File dpapi.ps1 -Mode protect|unprotect
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('protect', 'unprotect')]
    [string] $Mode
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# 按字节读 stdin 再自己按 UTF-8 解码：[Console]::In 用的是控制台输入编码（本机 GBK），
# 拿它读 UTF-8 会把中文解成乱码。
$stream = [Console]::OpenStandardInput()
$buffer = New-Object System.IO.MemoryStream
$stream.CopyTo($buffer)
$payload = [System.Text.Encoding]::UTF8.GetString($buffer.ToArray())

if ($Mode -eq 'protect') {
    $secure = ConvertTo-SecureString -String $payload -AsPlainText -Force
    [Console]::Out.Write((ConvertFrom-SecureString $secure))
}
else {
    $secure = ConvertTo-SecureString -String $payload.Trim()
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr))
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}
