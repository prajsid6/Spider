#!/usr/bin/env bash
# ==============================================================================
# SPIDER - AWS S3 + CloudFront Automated Deployment Script (Bash)
# ==============================================================================
set -e

BUCKET_NAME="$1"
DISTRIBUTION_ID="$2"
AWS_REGION="${3:-us-east-1}"

if [ -z "$BUCKET_NAME" ]; then
    echo "Usage: ./deploy-aws.sh <bucket-name> [cloudfront-distribution-id] [aws-region]"
    exit 1
fi

echo "🕷 Building Spider production bundle..."
npm run build

echo "☁️ Syncing assets to s3://${BUCKET_NAME}..."
# Sync hashed assets with 1y cache
aws s3 sync dist/assets "s3://${BUCKET_NAME}/assets" \
    --cache-control "max-age=31536000, public, immutable" \
    --region "$AWS_REGION"

# Sync index.html with no-cache for instant updates
aws s3 sync dist/ "s3://${BUCKET_NAME}" \
    --exclude "assets/*" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --region "$AWS_REGION"

if [ -n "$DISTRIBUTION_ID" ]; then
    echo "⚡ Invalidating CloudFront cache for ${DISTRIBUTION_ID}..."
    aws cloudfront create-invalidation \
        --distribution-id "$DISTRIBUTION_ID" \
        --paths "/*"
fi

echo "🎉 Deployment to AWS complete!"

