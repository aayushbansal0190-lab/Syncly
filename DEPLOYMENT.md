# 🚀 Deployment Guide (AWS: S3 + CloudFront + EC2)

This app deploys as three pieces. After the **one-time setup** below, every `git push` to `main` auto-deploys via GitHub Actions — you never run AWS commands by hand.

```
Frontend (React build)  →  S3 (files) + CloudFront (CDN/HTTPS)
Backend  (Express+socket) →  EC2 (Node + Nginx + PM2)
Database                →  MongoDB Atlas
Media / voice notes     →  Cloudinary
AI                      →  Groq API
```

> ⚠️ The backend **cannot** live on S3 — it's a long-running server (Socket.IO). S3 is for the static frontend only.

---

## Part 1 — Backend on EC2 (one time)

1. **Launch an EC2 instance** — Ubuntu 22.04, `t2.micro` (free tier). In its **Security Group**, allow inbound **22 (SSH)**, **80 (HTTP)**, **443 (HTTPS)**.

2. **SSH in and install tooling:**
   ```bash
   ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs nginx
   sudo npm install -g pm2
   ```

3. **Clone the repo + configure env:**
   ```bash
   cd ~ && git clone <your-repo-url> fullstack-chat-app
   cd fullstack-chat-app/backend
   npm ci --omit=dev
   nano .env        # paste all backend env vars (see below)
   ```
   `backend/.env` on the server:
   ```env
   PORT=5001
   NODE_ENV=production
   CLIENT_URL=https://<your-cloudfront-domain>    # the frontend origin (CORS)
   TOKEN_SECRET=<long-random-string>
   CONNECTION_STRING=<mongodb-atlas-uri>
   CLOUD_NAME=...
   API_KEY=...
   API_SECRET=...
   GROQ_API_KEY=...
   ```

4. **Start it with PM2 (survives crashes + reboots):**
   ```bash
   pm2 start src/index.js --name chat-backend
   pm2 startup   # run the command it prints
   pm2 save
   ```

5. **Nginx reverse proxy** (`sudo nano /etc/nginx/sites-available/default`) — the WebSocket upgrade lines are essential for Socket.IO:
   ```nginx
   server {
     listen 80;
     server_name api.yourdomain.com;   # or the EC2 public DNS
     location / {
       proxy_pass http://localhost:5001;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
   ```bash
   sudo nginx -t && sudo systemctl restart nginx
   ```

6. **HTTPS (required for mic/video):** point a domain at the EC2 IP, then:
   ```bash
   sudo snap install --classic certbot
   sudo certbot --nginx -d api.yourdomain.com
   ```

Backend is now at `https://api.yourdomain.com`.

---

## Part 2 — Frontend on S3 + CloudFront (one time)

1. **Create an S3 bucket** (any name, e.g. `chat-app-frontend`). Leave "Block all public access" **on** — CloudFront will read it privately.

2. **Create a CloudFront distribution:**
   - **Origin:** your S3 bucket, using **Origin Access Control (OAC)** (CloudFront creates the bucket policy for you).
   - **Viewer protocol policy:** Redirect HTTP → HTTPS.
   - **Default root object:** `index.html`.
   - **SPA routing (important for React Router):** add two **Custom Error Responses** — for HTTP **403** and **404**, respond with `/index.html` and status **200**. Without this, refreshing on `/settings` gives an error.

Note the **Distribution ID** and the **domain** (`dxxxx.cloudfront.net`) — you'll need both.

---

## Part 3 — IAM user for GitHub Actions (one time)

Create an IAM user with **programmatic access** and this least-privilege policy (fill in your bucket + distribution ARN):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::chat-app-frontend" },
    { "Effect": "Allow", "Action": ["s3:PutObject","s3:DeleteObject"], "Resource": "arn:aws:s3:::chat-app-frontend/*" },
    { "Effect": "Allow", "Action": ["cloudfront:CreateInvalidation"], "Resource": "*" }
  ]
}
```
Save the **Access Key ID** and **Secret Access Key**.

---

## Part 4 — GitHub Secrets (one time)

Repo → **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user key (Part 3) |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret (Part 3) |
| `AWS_REGION` | e.g. `ap-south-1` |
| `S3_BUCKET` | your bucket name |
| `CLOUDFRONT_DISTRIBUTION_ID` | from Part 2 |
| `VITE_API_URL` | `https://api.yourdomain.com/api` |
| `VITE_SOCKET_URL` | `https://api.yourdomain.com` |
| `EC2_HOST` | EC2 public IP / DNS |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | contents of your `.pem` private key |

---

## Part 5 — How upgrades work (the whole point)

Once the above is done, **you never run AWS commands again.** Just:
```bash
git add .
git commit -m "my change"
git push origin main
```
- Change frontend files → [deploy-frontend.yml](.github/workflows/deploy-frontend.yml) builds, syncs to S3, invalidates CloudFront.
- Change backend files → [deploy-backend.yml](.github/workflows/deploy-backend.yml) SSHes to EC2, pulls, reinstalls, restarts PM2.

Watch progress in the repo's **Actions** tab. To redeploy without a code change, use **workflow_dispatch** (the "Run workflow" button).

### Notes
- The EC2 `.env` and the GitHub `VITE_*` secrets are the only places URLs live — update those if a domain changes; no code edits needed.
- If the repo is **private**, give EC2 read access (deploy key or a fine-grained PAT) so `git pull` works in the backend workflow.
- The backend deploy assumes the repo is cloned at `~/fullstack-chat-app` — adjust the path in the workflow if you cloned elsewhere.
