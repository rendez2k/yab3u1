<#
Checks a *deployed* copy of the web converter.

  1. every file the page needs, with its Content-Type -- the one thing that
     realistically breaks a static ES-module site is a server handed .js files as
     text/plain, which stops the modules loading
  2. the live self-test page, run in headless Edge and captured as a screenshot:
     the page is self-verifying (it converts a fixture in the browser and prints
     the result), so a picture of it is the proof

    .\check_live.ps1 -Url https://your-site.netlify.app
#>
param(
    [Parameter(Mandatory = $true)][string]$Url,
    [string]$Shot = "$env:TEMP\u1-live-selftest.png",
    [int]$VirtualTime = 45000
)
$ProgressPreference = 'SilentlyContinue'
$base = $Url.TrimEnd('/')

Write-Output "=== files and content types ==="
$problems = @()
foreach ($path in @("", "index.html", "zip.js", "converter.js", "base_settings.js",
                    "icon.ico", "selftest.html", "selftest-fixture.3mf")) {
    $target = "$base/$path"
    try {
        $r = Invoke-WebRequest $target -UseBasicParsing -TimeoutSec 30
        $ct = $r.Headers['Content-Type']
        $flag = ""
        if ($path -like "*.js" -and $ct -notmatch "javascript") {
            $flag = "   <-- WRONG, modules will not load"
            $problems += $path
        }
        Write-Output ("  {0,-24} {1}  {2,10} bytes  {3}{4}" -f
            ($(if ($path) { $path } else { "(root)" })), $r.StatusCode,
            $r.RawContentLength, $ct, $flag)
    }
    catch {
        Write-Output ("  {0,-24} FAILED: {1}" -f $path, $_.Exception.Message)
        $problems += $path
    }
}

Write-Output ""
Write-Output "=== live self-test in headless Edge ==="
$edge = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
          "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
          "C:\Program Files\Google\Chrome\Application\chrome.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Output "no Edge/Chrome found, skipping"; exit 1 }

$profile = Join-Path $env:TEMP "edge-livecheck"
Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $Shot -Force -ErrorAction SilentlyContinue

$p = Start-Process -FilePath $edge -PassThru -ArgumentList @(
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=$profile", "--window-size=1100,1400",
    "--virtual-time-budget=$VirtualTime", "--screenshot=$Shot",
    "$base/selftest.html"
)
Start-Sleep -Seconds 25
$mine = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
    Where-Object { $_.CommandLine -like "*$profile*" }
foreach ($proc in $mine) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue

if (Test-Path $Shot) {
    Write-Output "screenshot written: $Shot ($((Get-Item $Shot).Length) bytes) - read it to see PASS/FAIL"
} else {
    Write-Output "no screenshot produced"
    $problems += "screenshot"
}

Write-Output ""
if ($problems.Count) {
    Write-Output "PROBLEMS: $($problems -join ', ')"
    exit 1
}
Write-Output "files all served correctly"
