[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SubscriptionId,

    [Parameter(Mandatory = $true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory = $true)]
    [string]$ExistingAppServicePlanName,

    [Parameter()]
    [string]$WebAppName = 'EnrollmentFlowMonitor-Wa',

    [Parameter()]
    [ValidateSet('NODE|22-lts', 'NODE|20-lts')]
    [string]$LinuxRuntime = 'NODE|22-lts',

    [Parameter()]
    [ValidateSet('NODE:22-lts', 'NODE:20-lts')]
    [string]$WindowsRuntime = 'NODE:22-lts',

    [Parameter()]
    [string]$SessionSecret,

    [Parameter()]
    [string]$WebAppUrl,

    [Parameter()]
    [string]$CorsOrigins,

    [Parameter()]
    [string]$EntraRedirectUri,

    [Parameter()]
    [string]$EntraClientId,

    [Parameter()]
    [string]$EntraClientSecret,

    [Parameter()]
    [string]$EntraTenantId,

    [Parameter()]
    [string]$GraphScopes = 'openid profile offline_access DeviceManagementServiceConfig.Read.All DeviceManagementManagedDevices.Read.All Directory.Read.All',

    [switch]$SkipIfExists
)

$ErrorActionPreference = 'Stop'

function Assert-AzCli {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        throw @"
Azure CLI (az) is not installed or not in PATH.
Install (Windows): winget install -e --id Microsoft.AzureCLI
Then close and reopen PowerShell, and rerun this script.
"@
    }
}

function Ensure-Login {
    $null = az account show --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'No active Azure login found. Opening login...'
        az login --only-show-errors | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw 'Azure login failed. Run az login manually and ensure the correct tenant/account is selected.'
        }
    }
}

function Set-SubscriptionContext {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetSubscriptionId
    )

    az account set --subscription $TargetSubscriptionId --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw @"
Unable to set subscription '$TargetSubscriptionId'.
Your signed-in account likely has no access to this subscription.
Run:
  az account list --all -o table
  az login --tenant <tenant-id> --use-device-code
Then rerun this script.
"@
    }

    $active = az account show --query id -o tsv --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($active) -or $active -ne $TargetSubscriptionId) {
        throw "Subscription context verification failed. Expected '$TargetSubscriptionId' but active context is '$active'."
    }
}

function New-RandomSecret {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToBase64String($bytes)
}

Assert-AzCli
Ensure-Login

$planName = $ExistingAppServicePlanName
if ($planName -match '^(?<name>.+?)\s*\([^\)]*\)\s*$') {
    $planName = $Matches['name'].Trim()
    Write-Host "Normalized plan name from display text to '$planName'."
}

Write-Host "Setting subscription: $SubscriptionId"
Set-SubscriptionContext -TargetSubscriptionId $SubscriptionId

$plan = az appservice plan show `
    --name $planName `
    --resource-group $ResourceGroupName `
    --query "{name:name,kind:kind,sku:sku.tier,isLinux:reserved}" `
    -o json | ConvertFrom-Json

if (-not $plan) {
    throw "App Service Plan '$planName' not found in resource group '$ResourceGroupName'."
}

Write-Host "Using existing plan: $($plan.name) (Tier: $($plan.sku), Linux: $($plan.isLinux))"

$runtimeToUse = if ($plan.isLinux) { $LinuxRuntime } else { $WindowsRuntime }
$osLabel = if ($plan.isLinux) { 'Linux' } else { 'Windows' }
Write-Host "Plan OS detected: $osLabel. Runtime: $runtimeToUse"

$existingApp = az webapp show `
    --name $WebAppName `
    --resource-group $ResourceGroupName `
    --query "{name:name}" `
    -o json --only-show-errors 2>$null

if ($LASTEXITCODE -eq 0 -and $existingApp) {
    if ($SkipIfExists) {
        Write-Host "Web App '$WebAppName' already exists. Continuing because -SkipIfExists was provided."
    }
    else {
        throw "Web App '$WebAppName' already exists. Use a different name or pass -SkipIfExists."
    }
}
else {
    Write-Host "Creating Web App '$WebAppName' on existing plan '$planName'..."
    az webapp create `
        --name $WebAppName `
        --resource-group $ResourceGroupName `
        --plan $planName `
    --runtime $runtimeToUse `
        --only-show-errors | Out-Null
}

if ([string]::IsNullOrWhiteSpace($SessionSecret)) {
    $SessionSecret = New-RandomSecret
}

if ([string]::IsNullOrWhiteSpace($WebAppUrl)) {
    $WebAppUrl = "https://$WebAppName.azurewebsites.net"
}

if ([string]::IsNullOrWhiteSpace($CorsOrigins)) {
    $CorsOrigins = $WebAppUrl
}

if ([string]::IsNullOrWhiteSpace($EntraRedirectUri)) {
    $EntraRedirectUri = "https://$WebAppName.azurewebsites.net/api/auth/callback"
}

if ($plan.isLinux) {
    Write-Host 'Applying Linux startup command...'
    az webapp config set `
        --name $WebAppName `
        --resource-group $ResourceGroupName `
        --startup-file 'node out/apps/api/server.js' `
        --only-show-errors | Out-Null
}
else {
    Write-Host 'Windows App Service detected. Startup command is not used; relying on package.json start/web.config.'
}

$appSettings = @(
    'NODE_ENV=production',
    'SCM_DO_BUILD_DURING_DEPLOYMENT=false',
    'ENABLE_ORYX_BUILD=false',
    'WEBSITE_WARMUP_PATH=/health',
    'WEBSITES_CONTAINER_START_TIME_LIMIT=1800',
    "SESSION_SECRET=$SessionSecret",
    "WEB_APP_URL=$WebAppUrl",
    "CORS_ORIGINS=$CorsOrigins",
    "ENTRA_REDIRECT_URI=$EntraRedirectUri",
    "GRAPH_SCOPES=$GraphScopes"
)

if (-not $plan.isLinux) {
    $appSettings += 'WEBSITE_NODE_DEFAULT_VERSION=~22'
}

if (-not [string]::IsNullOrWhiteSpace($EntraClientId)) {
    $appSettings += "ENTRA_CLIENT_ID=$EntraClientId"
}
if (-not [string]::IsNullOrWhiteSpace($EntraClientSecret)) {
    $appSettings += "ENTRA_CLIENT_SECRET=$EntraClientSecret"
}
if (-not [string]::IsNullOrWhiteSpace($EntraTenantId)) {
    $appSettings += "ENTRA_TENANT_ID=$EntraTenantId"
}

Write-Host 'Applying app settings...'
az webapp config appsettings set `
    --name $WebAppName `
    --resource-group $ResourceGroupName `
    --settings $appSettings `
    --only-show-errors | Out-Null

$defaultHost = az webapp show `
    --name $WebAppName `
    --resource-group $ResourceGroupName `
    --query defaultHostName -o tsv --only-show-errors

Write-Host ''
Write-Host 'Deployment baseline is ready.' -ForegroundColor Green
Write-Host "Web App: $WebAppName"
Write-Host "Plan: $planName (same plan reused)"
Write-Host "Health URL: https://$defaultHost/health"
Write-Host "Login URL: https://$defaultHost/api/auth/login"
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '1) Push this project to your new GitHub repo.'
Write-Host '2) In the new GitHub repo, configure workflow secrets:'
Write-Host '   - AZURE_CLIENT_ID'
Write-Host '   - AZURE_TENANT_ID'
Write-Host '   - AZURE_SUBSCRIPTION_ID'
Write-Host '3) Commit and push to main to trigger deployment workflow.'
