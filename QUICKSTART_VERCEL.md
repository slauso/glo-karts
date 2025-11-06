# Quick Start: Deploy to Vercel in 5 Minutes

## Fastest Method: Vercel Dashboard

### 1. Go to Vercel
Visit: https://vercel.com/new

### 2. Import Your Repository
- Click **"Import Git Repository"**
- Select: **`slauso1/twistedkart`**

### 3. Configure (IMPORTANT!)

```
Framework Preset: Vite
Root Directory: frontend  ← MUST SET THIS!
Build Command: npm run build
Output Directory: dist
```

### 4. Add Environment Variable

Click "Environment Variables" and add:

```
Name:  VITE_API_URL
Value: https://twistedkart.koyeb.app
```

### 5. Deploy
Click **"Deploy"** button and wait ~2 minutes

### 6. Update Backend CORS

Go to Koyeb → Your backend service → Environment variables

Add:
```
Name:  CORS_ALLOW_ALL_ORIGINS
Value: True
```

**Done!** Your game is live at `https://[your-project].vercel.app`

---

## Alternative: Vercel CLI (For Developers)

```powershell
# Install CLI
npm install -g vercel

# Login
vercel login

# Navigate to frontend
cd "c:\Users\computer\Desktop\Twisted Kart\frontend"

# Deploy
vercel --prod
```

---

## What Gets Deployed?

✅ Lobby page (index.html)  
✅ Racing game (game.html)  
✅ 3D models and assets  
✅ All game logic and physics  
✅ Multiplayer connectivity  

## URLs After Deployment

- **Frontend (Vercel)**: `https://[your-project].vercel.app`
- **Backend (Koyeb)**: `https://twistedkart.koyeb.app`

Both work together to power your racing game!

---

## Troubleshooting

**"Cannot find module 'three'"**
- Solution: Vercel will auto-install from package.json

**CORS Error**
- Solution: Add `CORS_ALLOW_ALL_ORIGINS=True` to backend environment variables

**404 on page refresh**
- Solution: Already fixed in vercel.json

---

For complete details, see [VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md)
