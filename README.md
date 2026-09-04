# TikTok Live Chat & Stream Bridge

Real-time TikTok Live SSE & HLS Stream Bridge for Takanashi Renna VTuber Live Theater.

## Deployment on Render.com
1. Click **New +** -> **Web Service**
2. Connect this repository
3. Set:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment Variables**:
     - `TIKTOK_USERNAME`: `foxy.2491` (or test with `icingcandy` / `nybun_bunny`)
4. Click **Create Web Service**
