# 예약 작업(가장 높은 권한)이 실행. 앱이 쓴 JSON 에서 값만 읽어 nvidia-smi -pl 을 적용한다.
# 입력은 데이터로만 취급: gpu 는 PCI bus id 형식, watts 는 100~1000 정수가 아니면 건너뜀.
param([Parameter(Mandatory = $true)][string]$ConfigPath)
$log = Join-Path $env:ProgramData 'Crypthy\power-limit.log'
$lines = @("[$(Get-Date -Format s)] apply $ConfigPath")
try {
  $cfg = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
  $smi = Join-Path $env:SystemRoot 'System32\nvidia-smi.exe'
  foreach ($l in (@($cfg.limits) | Select-Object -First 16)) {
    $gpu = [string]$l.gpu
    $w = 0
    if ($gpu -notmatch '^[0-9A-Fa-f]{4,8}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}\.[0-9A-Fa-f]$') { $lines += 'skip: invalid gpu id'; continue }
    if (-not [int]::TryParse([string]$l.watts, [ref]$w) -or $w -lt 100 -or $w -gt 1000) { $lines += "skip ${gpu}: invalid watts"; continue }
    $out = (& $smi -i $gpu -pl $w 2>&1 | Out-String).Trim()
    $lines += "$gpu -> $w W (exit $LASTEXITCODE) $out"
  }
} catch {
  $lines += "error: $($_.Exception.Message)"
}
Set-Content -LiteralPath $log -Value $lines -Encoding UTF8
