const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { TikTokLiveConnection } = require('tiktok-live-connector');

const PORT = process.env.PORT || 3005;
const LAST_ROOM_FILE = path.join(__dirname, 'last_room.json');

let defaultUser = process.env.TIKTOK_USERNAME || 'leepungg';
if (fs.existsSync(LAST_ROOM_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(LAST_ROOM_FILE, 'utf8'));
        if (saved && saved.username) {
            defaultUser = saved.username;
            console.log(`[Bridge] Restored last active room from disk: @${defaultUser}`);
        }
    } catch (e) {}
}

let currentUsername = defaultUser;
let currentConn = null;
const clients = new Set();
const recentMessages = [];
const MAX_RECENT = 50;

let currentLiveInfo = {
    isLive: false,
    username: currentUsername,
    roomId: null,
    title: '',
    streamUrl: null,
    hlsUrl: null,
    flvUrl: null,
    viewers: 0
};

function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
        try {
            res.write(payload);
        } catch (e) {
            clients.delete(res);
        }
    }
}

function connectRoom(username) {
    if (currentConn) {
        try {
            currentConn.removeAllListeners();
            currentConn.disconnect();
        } catch (e) {}
        currentConn = null;
    }

    currentUsername = username;
    recentMessages.length = 0; // Clear old room messages
    try {
        fs.writeFileSync(LAST_ROOM_FILE, JSON.stringify({ username, savedAt: new Date().toISOString() }));
    } catch (e) {}
    currentLiveInfo = {
        isLive: false,
        username,
        roomId: null,
        title: '',
        streamUrl: null,
        hlsUrl: null,
        flvUrl: null,
        viewers: 0
    };
    console.log(`\n[Bridge] Connecting TikTok Live to: @${username}...`);

    const conn = new TikTokLiveConnection(username, {});
    currentConn = conn;

    conn.connect().then(state => {
        const d = state.roomInfo?.data || state.roomInfo || {};
        const streamData = d.stream_url || {};
        let hlsUrl = streamData.hls_pull_url || null;
        if (!hlsUrl && streamData.live_core_sdk_data?.pull_data?.stream_data) {
            try {
                const parsed = JSON.parse(streamData.live_core_sdk_data.pull_data.stream_data);
                hlsUrl = parsed.data?.hd?.main?.hls || parsed.data?.sd?.main?.hls || parsed.data?.ld?.main?.hls || null;
            } catch (e) {}
        }
        const flvUrl = streamData.flv_pull_url?.HD1 || streamData.rtmp_pull_url || null;
        const streamUrl = hlsUrl || flvUrl;

        const title = d.title || 'TikTok Live Stream';
        const viewers = d.user_count || d.stats?.total_user || 0;

        currentLiveInfo = {
            isLive: true,
            username,
            roomId: state.roomId,
            title,
            streamUrl,
            hlsUrl,
            flvUrl,
            viewers
        };

        console.log(`[Bridge] Connected to @${username}! Room ID: ${state.roomId}`);
        console.log(`[Bridge] Title: "${title}" | Viewers: ${viewers}`);
        if (hlsUrl) console.log(`[Bridge] HLS URL: ${hlsUrl.slice(0, 60)}...`);

        broadcast('connected', currentLiveInfo);
        broadcast('live_status', currentLiveInfo);
    }).catch(err => {
        console.log(`[Bridge] Connection offline (@${username}):`, err.message);
        currentLiveInfo.isLive = false;
        broadcast('live_status', currentLiveInfo);
    });

    conn.on('chat', data => {
        const nickname = data.nickname || data.user?.nickname || data.user?.uniqueId || data.uniqueId || 'ผู้ชม';
        
        let comment = data.comment || data.content || data.text || '';
        if (!comment && data.emotes && Array.isArray(data.emotes) && data.emotes.length > 0) {
            comment = data.emotes.map(e => e.emoteImageUrl ? `<img src="${e.emoteImageUrl}" alt="sticker" class="chat-inline-emote" referrerpolicy="no-referrer" style="height:26px;vertical-align:middle;display:inline-block;" />` : '').join(' ');
        }
        if (!comment && (data.defaultPattern || data.describe)) {
            comment = data.defaultPattern || data.describe;
        }

        // Do not broadcast empty messages
        if (!comment || !comment.trim()) {
            return;
        }

        const avatar = data.profilePictureUrl
            || data.user?.profilePictureUrl
            || (data.userDetails?.profilePictureUrls ? data.userDetails.profilePictureUrls[0] : null)
            || (data.profilePicture?.url ? data.profilePicture.url[0] : null)
            || (data.user?.profilePicture?.url ? data.user.profilePicture.url[0] : null)
            || `https://ui-avatars.com/api/?name=${encodeURIComponent(nickname.slice(0, 3))}&background=FF2E51&color=fff&bold=true`;
        
        const badge = (data.userBadges && data.userBadges.some(b => (b.type && b.type.includes('moderator')) || b.isModerator)) ? 'VIP'
            : (data.followRole || data.user?.followInfo?.followStatus ? 'FAN' : 'SUB');

        const msg = {
            id: 'tt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            user: nickname,
            text: comment,
            avatar,
            badge,
            timestamp: Date.now()
        };

        console.log(`[CHAT] ${nickname}: ${comment}`);
        recentMessages.push(msg);
        if (recentMessages.length > MAX_RECENT) recentMessages.shift();

        broadcast('chat', msg);
    });

    conn.on('gift', data => {
        const nickname = data.nickname || data.user?.nickname || data.user?.uniqueId || data.uniqueId || 'แฟนคลับ';
        const giftName = data.giftName || data.giftDetails?.giftName || 'ของขวัญ';
        const count = data.repeatCount || 1;
        const avatar = data.profilePictureUrl
            || data.user?.profilePictureUrl
            || (data.userDetails?.profilePictureUrls ? data.userDetails.profilePictureUrls[0] : null)
            || (data.profilePicture?.url ? data.profilePicture.url[0] : null)
            || `https://ui-avatars.com/api/?name=${encodeURIComponent(nickname.slice(0, 3))}&background=FF2E51&color=fff&bold=true`;
        const msg = {
            id: 'gift_' + Date.now(),
            user: nickname,
            text: `ส่งของขวัญ: ${giftName} x ${count} 🎁✨`,
            avatar,
            badge: 'VIP',
            isGift: true,
            timestamp: Date.now()
        };
        console.log(`[GIFT] ${nickname}: ${giftName} x ${count}`);
        recentMessages.push(msg);
        if (recentMessages.length > MAX_RECENT) recentMessages.shift();
        broadcast('gift', msg);
    });

    conn.on('roomUser', data => {
        if (data.viewerCount) {
            currentLiveInfo.viewers = data.viewerCount;
            broadcast('viewer_count', { viewers: data.viewerCount });
        }
    });

    conn.on('streamEnd', () => {
        console.log(`[Bridge] Stream explicitly ended by @${username}`);
        currentLiveInfo.isLive = false;
        currentLiveInfo.streamUrl = null;
        broadcast('stream_end', { username, isLive: false });
    });

    conn.on('disconnected', () => {
        console.log(`[Bridge] Socket disconnected from @${username}. Seamlessly auto-reconnecting in 2s...`);
        // Do NOT broadcast stream_end on transient network drops!
        setTimeout(() => {
            if (currentUsername === username) {
                try {
                    connectRoom(username);
                } catch (e) {}
            }
        }, 2000);
    });
}

// Auto reconnect check every 30 seconds if streamer comes online
setInterval(() => {
    if (!currentLiveInfo.isLive && currentUsername) {
        try {
            connectRoom(currentUsername);
        } catch (e) {}
    }
}, 30000);

// SSE Heartbeat Keepalive ping every 25s (prevents cloud proxies from disconnecting idle clients)
setInterval(() => {
    broadcast('ping', { time: Date.now() });
}, 25000);

// Render Anti-Sleep Self-Ping (Runs every 8 minutes to prevent Render Free Tier spin-down)
const PING_URL = process.env.RENDER_EXTERNAL_URL || 'https://foxy-live-bridge.onrender.com';
setInterval(() => {
    try {
        const client = PING_URL.startsWith('https') ? https : http;
        client.get(`${PING_URL}/health`, (res) => {
            console.log(`[KeepAlive] Self-ping status: ${res.statusCode}`);
        }).on('error', (err) => {
            console.log(`[KeepAlive] Self-ping notice: ${err.message}`);
        });
    } catch (e) {}
}, 8 * 60 * 1000);

// HTTP Server
const server = http.createServer((req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/' || url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'online',
            service: 'TikTok Live Chat & Stream Bridge',
            currentStreamer: currentUsername,
            liveInfo: currentLiveInfo,
            activeClients: clients.size
        }, null, 2));
        return;
    }

    if (url.pathname === '/api/live-status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(currentLiveInfo));
        return;
    }

    if (url.pathname === '/api/live-chat/sse') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        clients.add(res);
        console.log(`[Bridge] SSE Client connected (${clients.size} total)`);

        // Handshake
        res.write(`event: init\ndata: ${JSON.stringify({ username: currentUsername, liveInfo: currentLiveInfo, recent: recentMessages })}\n\n`);

        req.on('close', () => {
            clients.delete(res);
            console.log(`[Bridge] SSE Client disconnected (${clients.size} remaining)`);
        });
        return;
    }

    if (url.pathname === '/api/switch-room') {
        const user = url.searchParams.get('username');
        if (user) {
            connectRoom(user);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, username: user }));
            return;
        }
    }

    if (url.pathname === '/api/live-chat/recent') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ username: currentUsername, messages: recentMessages }));
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Bridge] Server listening on port ${PORT}`);
    try {
        connectRoom(currentUsername);
    } catch (e) {
        console.error('[Bridge] Error in initial connectRoom:', e.message);
    }
});
