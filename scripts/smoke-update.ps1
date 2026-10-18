# Windows 설치 업데이트 스모크 테스트 (CI 용).
# 이전 버전을 설치·실행해 둔 채로, electron-updater 와 같은 인자(--updated /S --force-run)로 새 설치 파일을 돌린 뒤
# Crypthy.exe 가 있고 버전이 새 버전이며 실제로 실행되는지 확인한다. 사용자 데이터 폴더(%APPDATA%\Crypthy)는 지우지 않아야 한다.
# -Lock: 다른 프로세스가 Crypthy.exe 를 공유 없이 열어 둔 상태(파일 교체 실패)를 만든다. 이때 설치 파일은
#        (silent 여도) 오류 창을 띄우고 오류 코드 2로 끝나야 하며, 반쯤 설치된 앱을 실행하지 않아야 한다.
#        CI 에서는 뜬 창의 내용을 기록하고 Enter 로 닫는다.
param(
  [Parameter(Mandatory = $true)][string]$From,
  [Parameter(Mandatory = $true)][string]$To,
  [Parameter(Mandatory = $true)][string]$ExpectVersion,
  [string]$UpdateArgs = '--updated /S --force-run',
  [switch]$Lock
)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'Programs\Crypthy'
$exe = Join-Path $dir 'Crypthy.exe'
$data = Join-Path $env:APPDATA 'Crypthy'

function Ver { if (Test-Path $exe) { (Get-Item $exe).VersionInfo.ProductVersion } else { '<missing>' } }
function Procs([string]$label) {
  Write-Host "--- processes under install dir ($label)"
  Get-CimInstance Win32_Process | Where-Object { $_.Path -and $_.Path.StartsWith($dir, 'CurrentCultureIgnoreCase') } |
    ForEach-Object { Write-Host ("{0,7} {1}" -f $_.ProcessId, ($_.CommandLine -replace '\s+', ' ').Substring(0, [Math]::Min(160, $_.CommandLine.Length))) }
}

Write-Host "== install $From"
$p = Start-Process $From -ArgumentList '/S' -PassThru
$p.WaitForExit()
Write-Host "exit $($p.ExitCode), version $(Ver)"

# 사용자 데이터가 남는지 확인하려고 표식 파일을 둔다
New-Item -ItemType Directory -Force $data | Out-Null
Set-Content -Path (Join-Path $data 'smoke-marker.txt') -Value 'keep'

Write-Host "== start the installed app (tray, hidden)"
Start-Process $exe -ArgumentList '--hidden' | Out-Null
Start-Sleep -Seconds 20
Procs 'before update'

$locker = $null
if ($Lock) {
  # 공유 없이 열어 둔다: 옛 파일을 지우지도 새 파일로 바꾸지도 못한다. 설치 파일은 오류를 보이고 끝나야 한다
  Write-Host "== hold Crypthy.exe open from another process (no sharing)"
  $locker = Start-Process pwsh -ArgumentList '-NoProfile', '-Command', "`$f = [IO.File]::Open('$exe', 'Open', 'Read', 'Read'); Start-Sleep 900" -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

Write-Host "== update with $To ($UpdateArgs) while the app is running"
$env:CRYPTHY_INSTALLER_NO_UI = '1'
$sw = [Diagnostics.Stopwatch]::StartNew()
$i = Start-Process $To -ArgumentList $UpdateArgs -PassThru
# 설치 파일이 (silent 인데도) 창을 띄워 멈추면 실패로 본다
# silent 설치인데도 대화상자가 뜨면(예: 파일을 바꾸지 못함) 그 내용을 기록하고 Enter 로 닫아 끝까지 진행시킨다
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static string Texts(uint pid) {
    var sb = new StringBuilder();
    EnumWindows((h, p) => {
      uint wp; GetWindowThreadProcessId(h, out wp);
      if (wp == pid && IsWindowVisible(h)) {
        var t = new StringBuilder(512); GetWindowText(h, t, 512); sb.Append("[" + t + "] ");
        EnumChildWindows(h, (c, q) => { var ct = new StringBuilder(1024); GetWindowText(c, ct, 1024); if (ct.Length > 0) sb.Append(ct + " | "); return true; }, IntPtr.Zero);
      }
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
"@
$dialogs = 0
while (-not $i.WaitForExit(60000)) {
  $dialogs++
  Write-Host "installer waiting on a window: $([Win]::Texts([uint32]$i.Id))"
  if ($dialogs -gt 5) { Write-Host 'FAIL: installer keeps waiting'; exit 1 }
  $sh = New-Object -ComObject WScript.Shell
  [void]$sh.AppActivate($i.Id); Start-Sleep -Milliseconds 500; $sh.SendKeys('{ENTER}')
}
Write-Host "dialogs answered: $dialogs"
Write-Host "installer exit $($i.ExitCode) after $([int]$sw.Elapsed.TotalSeconds)s"
Start-Sleep -Seconds 15
Procs 'after update'

$v = Ver
$size = if (Test-Path $exe) { (Get-Item $exe).Length } else { 0 }
Write-Host "Crypthy.exe version $v, size $size"
Get-ChildItem $dir -ErrorAction SilentlyContinue | Select-Object Name, Length | Format-Table -AutoSize | Out-String -Width 200 | Write-Host

$fail = @()
if (-not (Test-Path (Join-Path $data 'smoke-marker.txt'))) { $fail += 'user data folder was removed' }
$running = Get-CimInstance Win32_Process | Where-Object { $_.Path -eq $exe }
if ($Lock) {
  if ($i.ExitCode -ne 2) { $fail += "locked install should exit with 2, got $($i.ExitCode)" }
  if ($running) { $fail += 'a half-installed app was started' }
  if ($locker) { Stop-Process -Id $locker.Id -Force -ErrorAction SilentlyContinue }
} else {
  if ($i.ExitCode -ne 0) { $fail += "installer exit $($i.ExitCode)" }
  if ($v -ne $ExpectVersion) { $fail += "expected version $ExpectVersion, got $v" }
  if (-not $running) { $fail += 'updated app is not running after --force-run' }
}

Get-Process Crypthy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if ($fail.Count) { Write-Host "FAIL: $($fail -join '; ')"; exit 1 }
Write-Host 'OK'
