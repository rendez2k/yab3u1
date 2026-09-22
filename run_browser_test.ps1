param(
  [string]$Url = "http://127.0.0.1:8231/selftest.html",
  [int]$Wait = 15,
  [string]$Tag = "run",
  [switch]$VirtualTime
)
$ProgressPreference = 'SilentlyContinue'
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$profile = Join-Path $env:TEMP "edge-$Tag"
Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue

$args = @(
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--user-data-dir=$profile"
)
# virtual time makes timers fire instantly, which is handy for small pages but
# aborts in-flight uploads, so it is opt-in
if ($VirtualTime) { $args += "--virtual-time-budget=60000" }
$args += $Url

Write-Output "launching Edge headless -> $Url"
$proc = Start-Process -FilePath $edge -PassThru -ArgumentList $args
Start-Sleep -Seconds $Wait

# kill only the browser we started (matched by its private profile dir),
# never the user's own Edge windows
$mine = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
  Where-Object { $_.CommandLine -like "*$profile*" }
Write-Output "stopping $($mine.Count) msedge process(es) belonging to this test"
foreach ($p in $mine) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "done"
