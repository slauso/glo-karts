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
Name:  VITE_COLYSEUS_URL
Value: wss://realtime.your-domain.com
```

### 5. Deploy
Click **"Deploy"** button and wait ~2 minutes

### 6. Verify Realtime Health

Check your realtime service health endpoint and confirm frontend `VITE_COLYSEUS_URL` points at it.

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
- **Realtime (Colyseus)**: `wss://realtime.your-domain.com`

Both work together to power your racing game!

---

## Troubleshooting

**"Cannot find module 'three'"**
- Solution: Vercel will auto-install from package.json

**WebSocket Connect Error**
- Solution: Verify `VITE_COLYSEUS_URL` and realtime server availability

**404 on page refresh**
- Solution: Already fixed in vercel.json

---

For complete details, see [VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md)
