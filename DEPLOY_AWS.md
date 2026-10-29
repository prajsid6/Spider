# Spider — AWS Production Deployment Guide 🚀

Spider is a modern, high-performance web marketplace built with **React 19**, **TypeScript**, **Tailwind CSS**, and **Supabase (PostgreSQL + Auth + Realtime)**.

This guide provides step-by-step instructions for taking Spider from local development into **AWS production**.

---

## 🏛 Architecture Overview

```
                      ┌──────────────────────┐
                      │   Route 53 (DNS)     │
                      └──────────┬───────────┘
                                 │
                      ┌──────────▼───────────┐
                      │ CloudFront CDN (SSL) │
                      └──────────┬───────────┘
                                 │
            ┌────────────────────┴────────────────────┐
            ▼                                         ▼
  ┌───────────────────┐                     ┌────────────────────┐
  │   AWS S3 Bucket   │                     │   Supabase Cloud   │
  │ (Static Frontend) │                     │ (Postgres + Auth)  │
  └───────────────────┘                     └────────────────────┘
```

---

## Step 1: Set Up Supabase Cloud (Backend & Database)

1. **Create Project:** Go to [database.new](https://database.new) or [supabase.com](https://supabase.com) and create a new project.
2. **Execute Database Schema:**
   - In your Supabase dashboard, open the **SQL Editor** on the left menu.
   - Open [`supabase/schema.sql`](file:///c:/Users/prajw/Desktop/Spider/supabase/schema.sql) in this repository.
   - Copy the entire SQL content, paste it into the Supabase SQL editor, and click **Run**.
   - This sets up:
     - `profiles` with the 4 required fields (`name`, `username`, `mobile_number`, `date_of_birth` with 13+ age validation).
     - `public_profiles` view protecting phone numbers and DOB from public queries.
     - `help_requests` and `help_offers` tables.
     - Auto-connect trigger (`handle_offer_accepted()`) that changes request status to `Connected` and declines competing offers.
     - Row-Level Security (RLS) policies allowing connected parties to view each other's contact details upon acceptance.
     - Realtime publication subscriptions.
3. **Copy API Credentials:**
   - Go to **Project Settings** → **API**.
   - Note down:
     - **Project URL** (`https://<project-ref>.supabase.co`)
     - **Anon Public API Key** (`eyJhbGci...`)

---

## Step 2: Choose Your AWS Deployment Strategy

Select the strategy that best matches your AWS infrastructure:

### Strategy A: AWS Amplify Hosting (Recommended & Easiest)

AWS Amplify Hosting offers zero-maintenance, global CDN, automated SSL certificates, and git-connected CI/CD.

1. **Push code to GitHub / GitLab / CodeCommit:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit for Spider"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
2. **Connect to AWS Amplify:**
   - Open the **AWS Amplify Console** in your AWS account.
   - Click **Deploy an app** → select your Git provider (e.g. GitHub).
   - Select the repository and `main` branch.
   - Amplify will automatically detect the build settings from [`amplify.yml`](file:///c:/Users/prajw/Desktop/Spider/amplify.yml):
     - Build Command: `npm run build`
     - Base Directory: `dist`
3. **Add Environment Variables in Amplify:**
   - In the **App Settings** → **Environment variables**, add:
     - `VITE_SUPABASE_URL`: `https://your-project.supabase.co`
     - `VITE_SUPABASE_ANON_KEY`: `your-anon-key`
4. **Configure SPA Rewrites / Redirects:**
   - In Amplify Console, navigate to **Rewrites and redirects**.
   - Ensure the standard SPA rule exists so refreshing any URL works seamlessly:
     - **Source address:** `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/>`
     - **Target address:** `/index.html`
     - **Type:** `200 (Rewrite)`
5. Click **Save and deploy**. Your app will be live with a free HTTPS URL in under 2 minutes!

---

### Strategy B: AWS S3 + CloudFront (Serverless CDN)

Best for full infrastructure control and ultra-low cost.

1. **Create an S3 Bucket:**
   ```powershell
   aws s3 mb s3://spider-marketplace-prod --region us-east-1
   ```
2. **Build the Production Bundle:**
   Ensure `.env.production` has your live Supabase credentials, then:
   ```powershell
   cmd.exe /c npm run build
   ```
3. **Deploy with the Included Automation Script:**
   ```powershell
   .\deploy-aws-s3-cloudfront.ps1 -BucketName "spider-marketplace-prod" -Region "us-east-1"
   ```
4. **Create a CloudFront Distribution:**
   - Origin Domain: your S3 bucket.
   - Viewer Protocol Policy: **Redirect HTTP to HTTPS**.
   - Custom Error Response (CRITICAL for React SPA):
     - HTTP error code: **404** (and **403**)
     - Customize error response: **Yes**
     - Response page path: `/index.html`
     - HTTP Response code: **200: OK**
5. Once created, supply your `DistributionId` to `deploy-aws-s3-cloudfront.ps1` for future one-command automated deployments:
   ```powershell
   .\deploy-aws-s3-cloudfront.ps1 -BucketName "spider-marketplace-prod" -DistributionId "E12345EXAMPLE"
   ```

---

### Strategy C: Containerized with Docker (AWS App Runner / ECS Fargate)

A ready-to-run [`Dockerfile`](file:///c:/Users/prajw/Desktop/Spider/Dockerfile) and [`nginx.conf`](file:///c:/Users/prajw/Desktop/Spider/nginx.conf) are included.

1. **Build the Docker Image locally:**
   ```bash
   docker build \
     --build-arg VITE_SUPABASE_URL="https://your-project.supabase.co" \
     --build-arg VITE_SUPABASE_ANON_KEY="your-anon-key" \
     -t spider-app:latest .
   ```
2. **Test locally with Docker:**
   ```bash
   docker run -d -p 8080:80 spider-app:latest
   ```
   Open `http://localhost:8080` in your browser.
3. **Push to AWS Elastic Container Registry (ECR):**
   ```bash
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <aws_account_id>.dkr.ecr.us-east-1.amazonaws.com
   docker tag spider-app:latest <aws_account_id>.dkr.ecr.us-east-1.amazonaws.com/spider-app:latest
   docker push <aws_account_id>.dkr.ecr.us-east-1.amazonaws.com/spider-app:latest
   ```
4. **Deploy to AWS App Runner:**
   - In AWS App Runner console, create a new service.
   - Point to the container image in ECR.
   - Port: `80`.
   - App Runner provides automatic TLS certificates and auto-scaling.

---

## 🔒 Security Checklist for Production

* [x] **Strict Age Verification:** Users must be at least 13 years old to register.
* [x] **Private Contact Protection:** Phone numbers are only visible between the requester and accepted helper via Row-Level Security policies.
* [x] **Database Constraints:** Budgets, character lengths, and status enum checks strictly enforced in Postgres.
* [x] **Content Security & HTTP Headers:** Configured in `nginx.conf` (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`).
* [x] **Optimized Code Splitting:** Vendor, Supabase, and Lucide chunks separated for optimal browser caching on CloudFront.

