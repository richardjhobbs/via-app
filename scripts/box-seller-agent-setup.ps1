# Registers the recurring "VIA Seller Agents" scheduled task on the Box.
# Runs the seller-agent poll every 10 minutes, S4U (no interactive session
# needed), never overlapping (IgnoreNew). Re-runnable (-Force replaces).
$run = Join-Path $env:USERPROFILE 'box-seller-agent-run.ps1'
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$run`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 9)
Register-ScheduledTask -TaskName 'VIA Seller Agents' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
'registered: ' + (Get-ScheduledTask -TaskName 'VIA Seller Agents').State
