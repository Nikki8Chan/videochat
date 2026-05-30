# 🌐 GlobalChat — Video Chat Room

A fully functional peer-to-peer global video chat app. Anyone with the **access code `5566`** can join the same live room — no accounts, no sign-up.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🔑 Access code gate | Code `5566` required to enter |
| 📹 Live video | Camera + microphone via WebRTC |
| 🌐 Full-mesh P2P | Every participant connects directly to each other |
| 💬 Room chat | Real-time text chat for all participants |
| 🎙️ Mic / Camera toggle | Mute or disable camera any time |
| 📱 Responsive | Works on desktop and mobile |
| 🔒 Encrypted | WebRTC is end-to-end encrypted by default |

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
node server.js
```

### 3. Open in browser
```
http://localhost:3000
```

Enter any name and access code **`5566`** to join.

---

## 🌍 Share with Others (LAN)

Find your local IP:
```bash
# macOS / Linux
ifconfig | grep "inet "

# Windows
ipconfig
```

Share `http://YOUR_IP:3000` with anyone on your network.

---

## ☁️ Deploy to the Internet

### Option A — Railway (free tier)
1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Set **Start Command**: `node server.js`
4. Railway gives you a public URL automatically

### Option B — Render (free tier)
1. Push to GitHub
2. [render.com](https://render.com) → New Web Service → Connect repo
3. Build command: `npm install`
4. Start command: `node server.js`

### Option C — VPS (DigitalOcean, Linode, etc.)
```bash
# On your server
git clone <your-repo>
cd videochat
npm install
node server.js
# Or use pm2 for persistence:
npm install -g pm2
pm2 start server.js --name globalchat
```

> **Tip:** For production with many users, add a TURN server (e.g. Twilio Network Traversal) to the `RTC_CONFIG` in `public/app.js` so peers behind strict NAT/firewalls can connect.

---

## 📁 Project Structure

```
videochat/
├── server.js          ← Express + Socket.io signaling server
├── package.json
└── public/
    ├── index.html     ← App shell (join + room screens)
    ├── style.css      ← Dark futuristic UI
    └── app.js         ← WebRTC mesh + chat logic
```

---

## 🔧 Change the Access Code

In `server.js`, line 7:
```js
const SECRET_CODE = '5566'; // ← change this
```

---

## 🔒 Security Notes

- The access code is validated **server-side** via Socket.io
- WebRTC streams are encrypted using DTLS-SRTP (browser standard)
- No video/audio ever passes through the server — only signaling messages do
- For production use, consider HTTPS (required for camera access on remote URLs)

---

Built with **Node.js**, **Express**, **Socket.io**, and **WebRTC**
