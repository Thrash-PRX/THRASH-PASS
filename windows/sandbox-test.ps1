# Integration tests deliberately restricted to GitHub's disposable hosted Windows VM.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Run this integration test only on a disposable GitHub-hosted Windows runner.'
}
$root = Join-Path $env:LOCALAPPDATA 'THRASH-PASS'
if (Test-Path -LiteralPath $root) { throw 'Expected a clean VM without an installed THRASH-PASS.' }
$exe = Join-Path $PSScriptRoot 'dist\THRASH-PASS-Updater.exe'
$installed = Join-Path $root 'THRASH-PASS-Updater.exe'
$extension = Join-Path $root 'extension'
$taskName = 'THRASH-PASS Updates ' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$results = [Collections.Generic.List[string]]::new()
function Assert-Check([bool]$success, [string]$description) {
    if (!$success) { throw $description }
    $results.Add($description)
    Write-Output ('PASS: ' + $description)
}
function Run-Updater([string]$path, [string]$argument) {
    $process = Start-Process -FilePath $path -ArgumentList $argument -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(180000)) { $process.Kill(); throw "Updater timed out: $argument" }
    $process.Refresh()
    if ($process.ExitCode -ne 0) {
        if (Test-Path -LiteralPath (Join-Path $root 'updater.log')) { Get-Content (Join-Path $root 'updater.log') }
        throw "Updater exited with $($process.ExitCode): $argument"
    }
}
try {
    Run-Updater $exe '--install'
    $version = (Get-Content (Join-Path $extension 'manifest.json') -Raw | ConvertFrom-Json).version
    Assert-Check ($version -eq (Get-Content (Join-Path $PSScriptRoot '..\update.json') -Raw | ConvertFrom-Json).version) 'Fresh installation matches published version'
    Assert-Check (Test-Path -LiteralPath $installed) 'Updater copies itself into the installation folder'
    Assert-Check ((Get-FileHash $exe).Hash -eq (Get-FileHash $installed).Hash) 'Installed executable matches the tested executable'
    $task = Get-ScheduledTask -TaskName $taskName
    Assert-Check ($task.Actions.Execute.Trim('"') -eq $installed) 'Scheduled task executable path is quoted correctly'
    Assert-Check ($task.Actions.Arguments -eq '--background') 'Scheduled task uses background mode'
    Assert-Check ($task.Triggers.Repetition.Interval -eq 'PT6H') 'Scheduled task repeats every six hours'
    Assert-Check ($task.Principal.RunLevel -eq 'Limited') 'Scheduled task uses limited privileges'

    $before = (Get-FileHash (Join-Path $extension 'worker.js')).Hash
    Run-Updater $installed '--background'
    Assert-Check ($before -eq (Get-FileHash (Join-Path $extension 'worker.js')).Hash) 'Up-to-date background check keeps installed files intact'

    $manifestPath = Join-Path $extension 'manifest.json'
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    $manifest.version = '0.0.1'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 30))
    $sentinel = Join-Path $extension 'old-build-marker.txt'
    [IO.File]::WriteAllText($sentinel, 'test old build')
    Run-Updater $installed '--background'
    Assert-Check ((Get-Content $manifestPath -Raw | ConvertFrom-Json).version -eq $version) 'Older build automatically upgrades to the current build'
    Assert-Check (!(Test-Path -LiteralPath $sentinel)) 'Old build files are removed from the active installation'
    Assert-Check (Test-Path -LiteralPath (Join-Path $root 'extension.previous\old-build-marker.txt')) 'Previous build is preserved for recovery'
    Assert-Check ((Get-Content (Join-Path $root 'updater.log') -Raw).Contains('Installed extension ' + $version)) 'Successful automatic updates are logged'

    # Execute through Windows Task Scheduler, rather than only starting the process directly.
    Start-ScheduledTask -TaskName $taskName
    $deadline = (Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Seconds 1
        $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
        $task = Get-ScheduledTask -TaskName $taskName
    } while (($taskInfo.LastRunTime.Year -lt 2020 -or $task.State -eq 'Running') -and (Get-Date) -lt $deadline)
    Assert-Check ($taskInfo.LastRunTime.Year -ge 2020 -and $task.State -ne 'Running' -and $taskInfo.LastTaskResult -eq 0) 'Windows Task Scheduler runs the installed executable successfully'

    Run-Updater $installed '--disable-updates'
    Assert-Check (!(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) 'Disabling automatic updates removes the scheduled task'
    Assert-Check (Test-Path -LiteralPath $manifestPath) 'Disabling updates preserves the installed extension'
    Assert-Check (@(Get-ChildItem -LiteralPath $root -Directory -Filter 'staging-*').Count -eq 0) 'No staging folders remain after successful updates'
    $results | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'dist\sandbox-results.json') -Encoding UTF8
    Write-Output ('All ' + $results.Count + ' Windows integration checks passed.')
}
finally {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    if (Test-Path -LiteralPath (Join-Path $root 'updater.log')) {
        Copy-Item -LiteralPath (Join-Path $root 'updater.log') -Destination (Join-Path $PSScriptRoot 'dist\updater.log')
    }
    # The disposable runner deletes the files at job completion; retain them as failure evidence.
}
