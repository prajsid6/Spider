# ==============================================================================
# SPIDER - AWS S3 + CloudFront Automated Deployment Script (PowerShell)
# ==============================================================================
param (
    [Parameter(Mandatory=$true)]
    [string]$BucketName,

    [Parameter(Mandatory=$false)]
    [string]$DistributionId,

    [Parameter(Mandatory=$false)]
    [string]$Region = "us-east-1"
)

Write-Host "🕷 Starting Spider AWS Deployment..." -ForegroundColor Cyan

# 1. Build the production app
Write-Host "📦 Building production bundle with Vite..." -ForegroundColor Yellow
cmd.exe /c npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed! Aborting deployment." -ForegroundColor Red
    exit 1
}

# 2. Check S3 bucket
Write-Host "☁️ Syncing assets to S3 bucket: s3://$BucketName" -ForegroundColor Yellow

# Upload immutable assets with 1-year cache
aws s3 sync dist/assets s3://$BucketName/assets `
    --cache-control "max-age=31536000, public, immutable" `
    --region $Region

# Upload index.html and other root files with no-cache so updates are instant
aws s3 sync dist/ s3://$BucketName `
    --exclude "assets/*" `
    --cache-control "no-cache, no-store, must-revalidate" `
    --region $Region

Write-Host "✅ S3 sync completed successfully!" -ForegroundColor Green

# 3. Invalidate CloudFront Cache if DistributionId is supplied
if ($DistributionId) {
    Write-Host "⚡ Invalidating CloudFront cache for distribution: $DistributionId..." -ForegroundColor Yellow
    aws cloudfront create-invalidation `
        --distribution-id $DistributionId `
        --paths "/*"
    Write-Host "✅ CloudFront invalidation triggered!" -ForegroundColor Green
}

Write-Host "🎉 Spider is now live on AWS!" -ForegroundColor Magenta

