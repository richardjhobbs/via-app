# Box runner for the VIA seller agents. Sources the DeepSeek key from the
# via-crm env (LLM_API_KEY, which points at api.deepseek.com) and runs the
# self-contained seller-agent poll once. Scheduled to run on an interval.
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $env:USERPROFILE 'via-crm\.env.local'
$line = Get-Content $envFile | Where-Object { $_ -match '^LLM_API_KEY=' } | Select-Object -First 1
$env:DEEPSEEK_API_KEY = ($line -split '=', 2)[1].Trim().Trim('"')
node (Join-Path $env:USERPROFILE 'via-seller-agent.mjs')
