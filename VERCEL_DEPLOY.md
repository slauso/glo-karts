# Deploying Frontend to Vercel - Complete Guide

## Prerequisites

1. **Vercel Account**: Sign up at https://vercel.com (free tier works perfectly)
2. **GitHub Repository**: Your code is already at https://github.com/slauso1/twistedkart
3. **Node.js Installed**: Check with `node --version` (should be 16+ or 18+)

---

## Method 1: Deploy via Vercel Dashboard (Easiest)

### Step 1: Connect GitHub to Vercel

1. Go to https://vercel.com and sign in
2. Click **"Add New..."** → **"Project"**
3. Click **"Import Git Repository"**
4. Authorize Vercel to access your GitHub account
5. Select the **`slauso1/twistedkart`** repository

### Step 2: Configure Build Settings

In the Vercel import screen, configure:

#### Framework Preset
- **Framework Preset**: Vite
- (Vercel should auto-detect this)

#### Root Directory
- Click **"Edit"** next to Root Directory
- Set to: **`frontend`**
- ✅ **CRITICAL**: This tells Vercel your app is in the frontend folder

#### Build Settings
- **Build Command**: `npm run build` (or leave default)
- **Output Directory**: `dist` (or leave default)
- **Install Command**: `npm install` (or leave default)

#### Environment Variables
Click **"Add Environment Variable"** and add:

| Name | Value |
|------|-------|
| `VITE_COLYSEUS_URL` | `wss://realtime.your-domain.com` |

### Step 3: Deploy

1. Click **"Deploy"**
2. Wait 2-3 minutes for build to complete
3. Once deployed, Vercel will show your live URL (e.g., `twistedkart.vercel.app`)

### Step 4: Test Your Deployment

1. Visit your Vercel URL
2. You should see the Twisted Kart lobby
3. Test private/open lobby create/join and quick-match

---

## Method 2: Deploy via Vercel CLI

### Step 1: Install Vercel CLI

Open PowerShell and run:

```powershell
npm install -g vercel
```

### Step 2: Login to Vercel

```powershell
vercel login
```

Follow the email verification link.

### Step 3: Navigate to Frontend Directory

```powershell
cd "c:\Users\computer\Desktop\Twisted Kart\frontend"
```

### Step 4: Create Environment File

Create a `.env.production` file in the frontend folder:

```powershell
New-Item -Path .env.production -ItemType File
```

Add this content to `.env.production`:

```
VITE_COLYSEUS_URL=wss://realtime.your-domain.com
```

### Step 5: Deploy to Vercel

```powershell
vercel
```

Answer the prompts:
- **Set up and deploy?**: Yes
- **Which scope?**: Your account
- **Link to existing project?**: No
- **Project name**: twistedkart-frontend (or your choice)
- **Directory**: `.` (current directory)
- **Override settings?**: No

### Step 6: Deploy to Production

```powershell
vercel --prod
```

---

## Method 3: One-Click Deploy Button (Optional)

### Step 1: Add vercel.json Configuration

Create `frontend/vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "installCommand": "npm install"
}
```

### Step 2: Add Deploy Button to README

Add this to your main README.md:

```markdown
## Deploy Frontend

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/slauso1/twistedkart&root-directory=frontend&env=VITE_COLYSEUS_URL&envDescription=Colyseus%20Realtime%20WebSocket%20URL)
```

---

## Configuration Files Summary

### Required Files (Already Present)

✅ `frontend/package.json` - Dependencies and build scripts  
✅ `frontend/vite.config.js` - Vite configuration with multi-page setup  
✅ `frontend/index.html` - Lobby page  
✅ `frontend/game.html` - Racing game page  

### Optional Files to Add

#### 1. `frontend/.env.production` (For CLI deployment)

```env
VITE_API_URL=https://twistedkart.koyeb.app
```

#### 2. `frontend/vercel.json` (For advanced config)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "installCommand": "npm install",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

---

## Environment Variables Explained

### VITE_COLYSEUS_URL

- **Purpose**: Tells your frontend where the realtime Colyseus server is hosted
- **Production Value**: `wss://realtime.your-domain.com`
- **Local Development**: `ws://localhost:2567`

### How It Works

Your frontend realtime flow checks for this variable:

```javascript
const env = import.meta.env.VITE_COLYSEUS_URL;
if (env) return env;
return `ws://${window.location.hostname}:2567`;
```

---

## Post-Deployment Steps

### 1. Update Backend CORS Settings

Your backend needs to allow requests from Vercel. In Koyeb, add these environment variables:

| Variable | Value |
|----------|-------|
| `CORS_ALLOWED_ORIGINS` | `https://twistedkart.vercel.app` |

Or replace with your actual Vercel URL. You can also use:

| Variable | Value |
|----------|-------|
| `CORS_ALLOW_ALL_ORIGINS` | `True` |

(Note: `CORS_ALLOW_ALL_ORIGINS=True` is easier for development but less secure)

### 2. Test Your Deployment

Visit your Vercel URL and test:

1. ✅ Lobby loads
2. ✅ Create private lobby works
3. ✅ Lobby code is generated and displayed
4. ✅ Join lobby by code works
5. ✅ Open quick match joins a public lobby
5. ✅ Game page loads when starting race

### 3. Configure Custom Domain (Optional)

1. In Vercel dashboard, go to your project
2. Click **"Settings"** → **"Domains"**
3. Add your custom domain (e.g., `play.twistedkart.com`)
4. Follow Vercel's DNS configuration instructions
5. Update `CORS_ALLOWED_ORIGINS` in backend to include custom domain

---

## Troubleshooting

### Build Fails: "Cannot find module"

**Solution**: Make sure all dependencies are in `package.json`

```powershell
cd frontend
npm install
```

Then commit and push:

```powershell
git add package-lock.json
git commit -m "Update package lock"
git push
```

### CORS Error in Browser Console

**Error**: `Access to fetch at 'https://twistedkart.koyeb.app' blocked by CORS`

**Solution**: Add Vercel URL to backend CORS settings (see Post-Deployment Steps above)

### Environment Variable Not Working

**Check**: 
1. Variable name starts with `VITE_` (required for Vite)
2. Redeploy after adding environment variables
3. Check browser console: `console.log(import.meta.env.VITE_API_URL)`

### Game Loads but Multiplayer Doesn't Work

**Check**:
1. Realtime server is running: open your Colyseus health endpoint (for local, `http://localhost:2567/health`)
2. Frontend env has `VITE_COLYSEUS_URL` pointing to the realtime host (`ws://` local, `wss://` production)
3. Browser can reach WebSocket endpoint (check network tab for `ws` handshake failures)

### Pages Not Found (404 on Refresh)

**Solution**: Add `vercel.json` with rewrites (see Configuration Files above)

---

## Local Development Testing

Before deploying, test locally:

```powershell
cd "c:\Users\computer\Desktop\Twisted Kart\frontend"
npm install
npm run dev
```

Visit `http://localhost:5173`

To test with production realtime server:

```powershell
$env:VITE_COLYSEUS_URL="wss://realtime.your-domain.com"
npm run dev
```

---

## Quick Reference Commands

### Deploy to Vercel (CLI)
```powershell
cd "c:\Users\computer\Desktop\Twisted Kart\frontend"
vercel --prod
```

### Build Locally
```powershell
cd frontend
npm run build
```

### Preview Build Locally
```powershell
npm run preview
```

### Check Build Output
```powershell
dir dist
```

---

## Complete Deployment Checklist

- [ ] Vercel account created
- [ ] GitHub repository connected to Vercel
- [ ] Root directory set to `frontend`
- [ ] `VITE_COLYSEUS_URL` environment variable added
- [ ] Project deployed successfully
- [ ] Vercel URL opens and shows lobby
- [ ] Private lobby create/join tested
- [ ] Open quick-match tested
- [ ] Game page loads successfully
- [ ] Multiplayer functionality tested

---

## Support & Resources

- **Vercel Documentation**: https://vercel.com/docs
- **Vite Documentation**: https://vitejs.dev/guide/
- **Realtime Health (local)**: http://localhost:2567/health
- **GitHub Repository**: https://github.com/slauso1/twistedkart

---

## Next Steps After Deployment

1. **Custom Domain**: Point a custom domain to your Vercel deployment
2. **Analytics**: Vercel includes built-in analytics (already have @vercel/analytics package)
3. **Performance**: Optimize assets, enable Vercel's image optimization
4. **Monitoring**: Set up alerts for downtime or errors
5. **CI/CD**: Every push to master will auto-deploy to Vercel

---

**Your deployment should now be live and accessible to players worldwide! 🎮🏎️**
