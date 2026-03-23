# New Repo + Azure Web App Setup

## 1) Create the new GitHub repository

Example repo name:

- `enrollment-flow-monitor-webapp`

Initialize and push from this folder:

```powershell
Set-Location "C:\temp\KillWindowsApp\Enrollment-Webapp"
git init
git checkout -b main
git add .
git commit -m "Initial Enrollment Flow Monitor web app"
git remote add origin https://github.com/<your-org>/enrollment-flow-monitor-webapp.git
git push -u origin main
```

## 2) Create new Web App on the same App Service plan

Use the same resource group and the same App Service plan as your existing app.
The deployment script auto-detects Linux vs Windows plan runtime configuration.

One-command option (recommended):

```powershell
Set-Location "C:\temp\KillWindowsApp\Enrollment-Webapp"
.\tools\Deploy-EnrollmentWebApp-SamePlan.ps1 `
  -SubscriptionId "<subscription-id>" `
  -ResourceGroupName "<resource-group>" `
  -ExistingAppServicePlanName "<existing-app-service-plan>" `
  -WebAppName "EnrollmentFlowMonitor-Wa"
```

```powershell
$rg = "<resource-group>"
$plan = "<existing-app-service-plan>"
$app = "EnrollmentFlowMonitor-Wa"
$location = "israelcentral"

az webapp create --name $app --resource-group $rg --plan $plan --runtime "NODE|22-lts"
az webapp config set --name $app --resource-group $rg --startup-file "node out/apps/api/server.js"
```

## 3) App settings

```powershell
az webapp config appsettings set --name $app --resource-group $rg --settings `
  NODE_ENV=production `
  SCM_DO_BUILD_DURING_DEPLOYMENT=false `
  ENABLE_ORYX_BUILD=false `
  WEBSITE_WARMUP_PATH=/health `
  WEBSITES_CONTAINER_START_TIME_LIMIT=1800 `
  SESSION_SECRET="<long-random-secret>" `
  WEB_APP_URL="https://app.<your-domain>" `
  CORS_ORIGINS="https://app.<your-domain>" `
  ENTRA_REDIRECT_URI="https://api.<your-domain>/api/auth/callback" `
  ENTRA_CLIENT_ID="<entra-client-id>" `
  ENTRA_CLIENT_SECRET="<entra-client-secret>" `
  ENTRA_TENANT_ID="<entra-tenant-id>" `
  GRAPH_SCOPES="openid profile offline_access DeviceManagementServiceConfig.Read.All DeviceManagementManagedDevices.Read.All Directory.Read.All"
```

## 4) GitHub Actions secrets (new repo)

Add these repository secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

The workflow file is:

- `.github/workflows/main_enrollmentflowmonitor-wa.yml`

## 5) Validate after first deployment

- `https://<your-app-name>.azurewebsites.net/health`
- `https://<your-app-name>.azurewebsites.net/api/auth/login`
- Ensure callback URI in Entra app registration includes:
  - `https://api.<your-domain>/api/auth/callback`
  - `https://<your-app-name>.azurewebsites.net/api/auth/callback`
