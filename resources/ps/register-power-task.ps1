# 관리자 권한(UAC 승인)으로 1회 실행: 전력 제한 적용 스크립트를 보호 폴더에 복사하고
# "가장 높은 권한" 예약 작업(로그온 시 + 앱에서 수동 실행)을 등록한다.
param(
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [Parameter(Mandatory = $true)][string]$User
)
$ErrorActionPreference = 'Stop'
$taskName = 'Crypthy-PowerLimit'
$dir = Join-Path $env:ProgramData 'Crypthy'
$admins = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
$system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$users = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')

# ProgramData 는 일반 사용자도 하위 폴더를 만들 수 있다. 누군가 미리 만들어 둔 폴더·파일(소유자·ACE)을
# 이어받지 않도록 기존 폴더는 지우고, ACL 을 붙인 채로 한 번에 새로 만든다.
if (Test-Path -LiteralPath $dir) {
  # junction/symlink 이면 따라가서 지우지 않도록 중단 (Windows PowerShell 5.1 Remove-Item 은 junction 을 따라감)
  if ((Get-Item -LiteralPath $dir -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "$dir is a reparse point (junction/symlink). Remove it manually and retry."
  }
  # rmdir /s /q 는 하위 junction 을 따라가지 않고 링크만 지운다
  & cmd.exe /d /c rmdir /s /q $dir
  if (Test-Path -LiteralPath $dir) { throw "failed to remove existing $dir" }
}

# 소유자 Administrators, 상속 차단, Administrators·SYSTEM 전체 / Users 읽기·실행만
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetOwner($admins)
$acl.SetAccessRuleProtection($true, $false)
$inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$none = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($admins, 'FullControl', $inherit, $none, $allow)))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system, 'FullControl', $inherit, $none, $allow)))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($users, 'ReadAndExecute', $inherit, $none, $allow)))
# 생성과 동시에 보안 설명자를 적용 → 생성 직후 Users 쓰기 권한이 상속되는 틈이 없음
[System.IO.Directory]::CreateDirectory($dir, $acl) | Out-Null

# 다른 프로세스가 먼저 만들었거나 끼어들었는지 확인: 소유자·reparse·빈 폴더
$item = Get-Item -LiteralPath $dir -Force
if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "unexpected reparse point at $dir" }
$owner = (Get-Acl -LiteralPath $dir).GetOwner([System.Security.Principal.SecurityIdentifier])
if ($owner -ne $admins) { throw "unexpected owner on $dir : $owner" }
if (Get-ChildItem -LiteralPath $dir -Force) { throw "$dir is not empty right after creation" }

$script = Join-Path $dir 'apply-power-limits.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'apply-power-limits.ps1') -Destination $script

$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -ConfigPath `"$ConfigPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
$trigger.Delay = 'PT30S'
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
