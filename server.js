require('dotenv').config();

const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
    console.log('⚠️ .env file not found. Creating default .env file.');
    const defaultEnv = `SESSION_ID=\n`;
    fs.writeFileSync(envPath, defaultEnv);
    console.log('✅ Created .env file. Please add your SESSION_ID and restart.');
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

const http = require('http');
const url = require('url');
const os = require('os');
const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const pino = require("pino");

let temporarySock = null;

async function getPairingSocket() {
    if (global.sock && global.sock.user) {
        console.log("Using main bot socket for pairing");
        return global.sock;
    }
    if (temporarySock) return temporarySock;
    console.log("Creating temporary socket for pairing");
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        browser: ["SΛVΛGΞ-TECH Pairing", "Chrome", "1.0.0"]
    });
    sock.ev.on('creds.update', saveCreds);
    temporarySock = sock;
    return sock;
}

function getHostPlatform() {
    if (process.env.DYNO) return 'Heroku (Dyno)';
    if (process.env.RENDER) return 'Render';
    if (process.env.VERCEL) return 'Vercel';
    if (process.env.KOYEB) return 'Koyeb';
    if (process.env.RAILWAY_ENVIRONMENT) return 'Railway';
    if (process.env.REPLIT_DB_URL) return 'Replit';
    if (os.platform() === 'android' && process.env.PREFIX === '/data/data/com.termux/usr') return 'Termux (Android)';
    if (os.platform() === 'linux') return 'Linux VPS';
    return 'Unknown / Local';
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

setTimeout(() => {
    try {
        require('./bot.js');
    } catch (err) {
        console.error('Failed to start main bot:', err);
    }
}, 1000);

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }

    if (pathname === '/session') {
        const credsFile = path.join(__dirname, 'session', 'creds.json');
        if (!fs.existsSync(credsFile)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('No session yet. Wait for bot to connect.');
            return;
        }
        const credsData = fs.readFileSync(credsFile);
        const sessionId = `SΛVΛGΞ-TECH;;;${credsData.toString('base64')}`;
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(sessionId);
        return;
    }

    if (pathname === '/code') {
        let num = parsedUrl.query.number;
        if (!num) {
            res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: "Number required" }));
            return;
        }
        num = num.replace(/[^0-9]/g, '');
        if (num.length < 9) {
            res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: "Invalid phone number (min 9 digits)" }));
            return;
        }
        try {
            const sock = await getPairingSocket();
            console.log(`Requesting pairing code for ${num}`);
            const code = await sock.requestPairingCode(num);
            console.log(`Pairing code generated: ${code}`);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ code: code }));
        } catch (err) {
            console.error("Pairing error:", err);
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: "Failed to get pairing code: " + err.message }));
        }
        return;
    }

    // Stats endpoint for live data
    if (pathname === '/stats') {
        const uptimeSec = process.uptime();
        const totalMem = (os.totalmem() / 1024 / 1024).toFixed(0);
        const freeMem = (os.freemem() / 1024 / 1024).toFixed(0);
        const usedMem = (totalMem - freeMem).toFixed(0);
        const commandsCount = global.commands ? global.commands.size : '?';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            uptime: formatUptime(uptimeSec),
            uptimeSeconds: Math.floor(uptimeSec),
            memory: { used: usedMem, total: totalMem },
            commands: commandsCount,
            platform: getHostPlatform(),
            nodeVersion: process.version
        }));
        return;
    }

    if (pathname === '/terminal') {
        const terminalHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Savage-Tech Terminal</title>
    <style>
        body { background: #0a0c12; color: #0f0; font-family: monospace; margin: 0; padding: 20px; }
        #terminal {
            background: #000;
            border: 1px solid #2a5f3e;
            height: 70vh;
            overflow-y: auto;
            padding: 10px;
            white-space: pre-wrap;
            font-size: 14px;
        }
        .input-line { display: flex; margin-top: 10px; }
        .input-line span { color: #0f0; }
        #command-input {
            background: #000;
            border: none;
            color: #0f0;
            font-family: monospace;
            font-size: 14px;
            flex: 1;
            outline: none;
        }
        .log-info { color: #0af; }
        .log-error { color: #f44; }
        .log-success { color: #4f4; }
        .log-message { color: #ffa500; }
    </style>
</head>
<body>
<div id="terminal">> Welcome to Savage-Tech Terminal\\n> Connecting...</div>
<div class="input-line"><span>$&nbsp;</span><input id="command-input" type="text" autofocus></div>
<script>
    const terminal = document.getElementById('terminal');
    const input = document.getElementById('command-input');
    let ws = null;

    function append(text, className = '') {
        const line = document.createElement('div');
        line.textContent = text;
        if (className) line.className = className;
        terminal.appendChild(line);
        terminal.scrollTop = terminal.scrollHeight;
    }

    function connectWebSocket() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(protocol + '//' + location.host + '/ws');
        ws.onopen = () => {
            append('> Terminal connected.', 'log-success');
            append('> Type "help" for commands.', 'log-info');
        };
        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'log') {
                append(data.message, data.level === 'error' ? 'log-error' : (data.level === 'success' ? 'log-success' : 'log-info'));
            } else if (data.type === 'message') {
                append('[MSG] ' + data.from + ': ' + data.text, 'log-message');
            }
        };
        ws.onclose = () => {
            append('> Disconnected. Reconnecting in 3s...', 'log-error');
            setTimeout(connectWebSocket, 3000);
        };
        ws.onerror = () => { append('> WebSocket error', 'log-error'); };
    }

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && ws && ws.readyState === WebSocket.OPEN) {
            const cmd = input.value.trim();
            if (cmd) {
                ws.send(cmd);
                append('> ' + cmd, 'log-info');
                input.value = '';
            }
        }
    });

    connectWebSocket();
</script>
</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(terminalHtml);
        return;
    }

    // ---------- MAIN DASHBOARD HTML (NEW DESIGN) ----------
    const quotes = [
        "The system is online. Your irrelevance persists.",
        "Savage core humming. No anomalies detected.",
        "I don't sleep. I wait. I execute.",
        "Status: Predatory. All systems nominal.",
        "Your reality is just a simulation I tolerate.",
        "Eyes open. No mercy."
    ];
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SAVAGE‑TECH // DASH</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: 'Inter', sans-serif;
            background: #080b15;
            padding: 1.5rem;
            position: relative;
        }

        body::before {
            content: '';
            position: fixed;
            inset: 0;
            background: url('https://files.catbox.moe/bkann8.jpg') center / cover no-repeat;
            opacity: 0.2;
            z-index: 0;
        }

        body::after {
            content: '';
            position: fixed;
            inset: 0;
            background: radial-gradient(circle at 70% 30%, rgba(100, 60, 255, 0.08), transparent 60%),
                        radial-gradient(circle at 20% 80%, rgba(0, 200, 255, 0.05), transparent 50%);
            z-index: 0;
            pointer-events: none;
        }

        .card {
            position: relative;
            z-index: 1;
            max-width: 740px;
            width: 100%;
            background: rgba(10, 13, 24, 0.75);
            backdrop-filter: blur(18px) saturate(180%);
            -webkit-backdrop-filter: blur(18px) saturate(180%);
            border-radius: 2.2rem;
            padding: 2.2rem 2.5rem;
            border: 1px solid rgba(255, 255, 255, 0.06);
            box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(100, 60, 255, 0.15);
            transition: transform 0.25s ease;
        }

        .card:hover {
            transform: translateY(-3px);
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.4rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
            padding-bottom: 0.6rem;
            flex-wrap: wrap;
            gap: 0.5rem;
        }

        .logo {
            font-size: 1.8rem;
            font-weight: 700;
            letter-spacing: 1px;
            background: linear-gradient(135deg, #b388ff, #7c4dff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 0 0 30px rgba(124, 77, 255, 0.2);
        }

        .clock {
            font-size: 0.85rem;
            font-weight: 500;
            color: #9aa4c8;
            background: rgba(255, 255, 255, 0.04);
            padding: 0.3rem 1rem;
            border-radius: 30px;
            border: 1px solid rgba(255, 255, 255, 0.05);
            letter-spacing: 0.5px;
        }

        .status-line {
            display: flex;
            align-items: center;
            gap: 0.8rem;
            background: rgba(0, 0, 0, 0.25);
            padding: 0.6rem 1.2rem;
            border-radius: 14px;
            margin-bottom: 1.8rem;
            border-left: 3px solid #7c4dff;
        }

        .dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #00e676;
            box-shadow: 0 0 16px #00e676aa;
            animation: pulse-dot 1.6s infinite;
        }

        @keyframes pulse-dot {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.4; transform: scale(0.8); }
        }

        #status-text {
            font-weight: 500;
            color: #d4dcff;
            font-size: 0.95rem;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 0.9rem;
            margin: 1.6rem 0;
        }

        .stat-item {
            background: rgba(255, 255, 255, 0.02);
            border-radius: 14px;
            padding: 0.7rem 0.9rem;
            border: 1px solid rgba(255, 255, 255, 0.03);
            transition: background 0.2s;
        }

        .stat-item:hover {
            background: rgba(255, 255, 255, 0.04);
        }

        .stat-label {
            font-size: 0.55rem;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            color: #7a84a8;
            font-weight: 600;
        }

        .stat-value {
            font-size: 1.1rem;
            font-weight: 700;
            color: #eef2ff;
            margin-top: 0.15rem;
            display: flex;
            align-items: baseline;
            gap: 0.2rem;
            flex-wrap: wrap;
        }

        .stat-value .unit {
            font-size: 0.65rem;
            font-weight: 400;
            color: #7a84a8;
        }

        .quote-box {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 12px;
            padding: 0.8rem 1.2rem;
            margin: 1.4rem 0 1.6rem 0;
            border-left: 3px solid #ff6b6b;
            color: #c8d0e8;
            font-size: 0.9rem;
            transition: opacity 0.4s ease;
            min-height: 3rem;
            display: flex;
            align-items: center;
        }

        .quote-box::before {
            content: "› ";
            color: #ff6b6b;
            font-weight: 700;
            margin-right: 0.3rem;
        }

        .actions {
            display: flex;
            justify-content: center;
            gap: 1rem;
            flex-wrap: wrap;
            margin-top: 0.5rem;
        }

        .btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: rgba(255, 255, 255, 0.04);
            color: #c8d0e8;
            text-decoration: none;
            padding: 0.6rem 1.8rem;
            border-radius: 40px;
            font-weight: 500;
            font-size: 0.8rem;
            border: 1px solid rgba(255, 255, 255, 0.06);
            transition: all 0.25s ease;
            backdrop-filter: blur(4px);
            cursor: pointer;
        }

        .btn:hover {
            background: rgba(124, 77, 255, 0.15);
            border-color: #7c4dff;
            color: #fff;
            box-shadow: 0 0 25px rgba(124, 77, 255, 0.1);
            transform: translateY(-1px);
        }

        .btn-primary {
            background: linear-gradient(135deg, #7c4dff, #b388ff);
            border-color: transparent;
            color: #fff;
            font-weight: 600;
        }

        .btn-primary:hover {
            background: linear-gradient(135deg, #6c3ce0, #a078ff);
            border-color: transparent;
            box-shadow: 0 0 35px rgba(124, 77, 255, 0.25);
        }

        .footer {
            margin-top: 1.6rem;
            text-align: center;
            font-size: 0.6rem;
            color: #4a5270;
            letter-spacing: 0.5px;
            border-top: 1px solid rgba(255, 255, 255, 0.03);
            padding-top: 0.9rem;
        }

        @media (max-width: 580px) {
            .card { padding: 1.5rem 1.2rem; }
            .logo { font-size: 1.4rem; }
            .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 0.7rem; }
            .stat-value { font-size: 1rem; }
            .clock { font-size: 0.7rem; padding: 0.2rem 0.8rem; }
            .status-line { padding: 0.4rem 0.8rem; }
            #status-text { font-size: 0.85rem; }
        }
        @media (max-width: 400px) {
            .stats-grid { grid-template-columns: 1fr 1fr; }
        }
    </style>
</head>
<body>
<div class="card">
    <div class="header">
        <span class="logo">⧩ SAVAGE‑TECH</span>
        <span class="clock" id="liveClock">--:--:--</span>
    </div>

    <div class="status-line">
        <span class="dot"></span>
        <span id="status-text">Neural link active</span>
    </div>

    <div class="stats-grid" id="statsGrid">
        <div class="stat-item">
            <div class="stat-label">Host</div>
            <div class="stat-value" id="hostVal">--</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">Uptime</div>
            <div class="stat-value" id="uptimeVal">--</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">Node</div>
            <div class="stat-value" id="nodeVal">--</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">Commands</div>
            <div class="stat-value" id="cmdsVal">--</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">Memory</div>
            <div class="stat-value" id="memVal">-- <span class="unit">MB</span> / -- <span class="unit">MB</span></div>
        </div>
        <div class="stat-item">
            <div class="stat-label">Status</div>
            <div class="stat-value" style="color:#b388ff;">⭕ PREDATORY</div>
        </div>
    </div>

    <div class="quote-box" id="quoteBox">${randomQuote}</div>

    <div class="actions">
        <a href="#" class="btn btn-primary" onclick="alert('📱 Contact: wa.me/254798841125')">⌨️ Contact</a>
        <a href="#" class="btn" onclick="location.reload()">⟳ Refresh</a>
    </div>

    <div class="footer">Inspired by Meryl · All rights reserved</div>
</div>

<script>
    // ---------- Live Clock ----------
    function updateClock() {
        const now = new Date();
        document.getElementById('liveClock').textContent = now.toLocaleTimeString('en-US', { hour12: false });
    }
    updateClock();
    setInterval(updateClock, 1000);

    // ---------- Typewriter Status ----------
    const statusMessages = [
        "Savage core initialized",
        "Watching network",
        "Idle – awaiting command",
        "Scanning for threats",
        "Neural link active",
        "Purging irrelevant data",
        "Ready to execute"
    ];
    let idx = 0, pos = 0, deleting = false, current = '';
    const statusEl = document.getElementById('status-text');

    function typeStatus() {
        const full = statusMessages[idx];
        if (deleting) {
            current = full.substring(0, --pos);
            statusEl.textContent = current;
            if (pos < 0) {
                deleting = false;
                idx = (idx + 1) % statusMessages.length;
                setTimeout(typeStatus, 400);
            } else {
                setTimeout(typeStatus, 40);
            }
        } else {
            current = full.substring(0, ++pos);
            statusEl.textContent = current;
            if (pos >= full.length) {
                deleting = true;
                setTimeout(typeStatus, 2000);
            } else {
                setTimeout(typeStatus, 70);
            }
        }
    }
    typeStatus();

    // ---------- Fetch real stats from /stats ----------
    async function updateStats() {
        try {
            const res = await fetch('/stats');
            const data = await res.json();
            document.getElementById('hostVal').textContent = data.platform || 'Unknown';
            document.getElementById('uptimeVal').textContent = data.uptime || '--';
            document.getElementById('nodeVal').textContent = data.nodeVersion || '--';
            document.getElementById('cmdsVal').textContent = data.commands || '?';
            document.getElementById('memVal').innerHTML = \`\${data.memory.used} <span class="unit">MB</span> / \${data.memory.total} <span class="unit">MB</span>\`;
        } catch (e) {
            // If fetch fails, keep placeholders; no action needed
        }
    }

    // Initial fetch + update every 2 seconds
    updateStats();
    setInterval(updateStats, 2000);

    // ---------- Rotating Quotes ----------
    const quotes = [
        "The system is online. Your irrelevance persists.",
        "Savage core humming. No anomalies detected.",
        "I don't sleep. I wait. I execute.",
        "Status: Predatory. All systems nominal.",
        "Your reality is just a simulation I tolerate.",
        "Eyes open. No mercy."
    ];
    let qIdx = 0;
    const quoteBox = document.getElementById('quoteBox');
    setInterval(() => {
        qIdx = (qIdx + 1) % quotes.length;
        quoteBox.style.opacity = '0';
        setTimeout(() => {
            quoteBox.textContent = quotes[qIdx];
            quoteBox.style.opacity = '1';
        }, 300);
    }, 7000);
</script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
});

const wss = new WebSocket.Server({ server });
const wsClients = new Set();

wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.send(JSON.stringify({ type: 'log', message: 'Connected to Savage-Tech terminal', level: 'success' }));

    ws.on('message', async (message) => {
        const cmd = message.toString().trim();
        if (cmd === 'help') {
            ws.send(JSON.stringify({ type: 'log', message: 'Commands: pair <number> | session <base64> | status | restart', level: 'info' }));
        } else if (cmd.startsWith('pair ')) {
            const number = cmd.split(' ')[1];
            if (!number) {
                ws.send(JSON.stringify({ type: 'log', message: 'Usage: pair <phone number>', level: 'error' }));
                return;
            }
            ws.send(JSON.stringify({ type: 'log', message: `Requesting pairing code for ${number}...`, level: 'info' }));
            try {
                const sock = await getPairingSocket();
                const code = await sock.requestPairingCode(number);
                ws.send(JSON.stringify({ type: 'log', message: `Pairing code: ${code}. Enter it on your WhatsApp device.`, level: 'success' }));
            } catch (err) {
                ws.send(JSON.stringify({ type: 'log', message: `Pairing failed: ${err.message}`, level: 'error' }));
            }
        } else if (cmd.startsWith('session ')) {
            const sessionB64 = cmd.split(' ')[1];
            if (!sessionB64) {
                ws.send(JSON.stringify({ type: 'log', message: 'Usage: session <base64_session_id>', level: 'error' }));
                return;
            }
            try {
                const credsJson = Buffer.from(sessionB64, 'base64').toString('utf-8');
                const sessionDir = path.join(__dirname, 'session');
                if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);
                fs.writeFileSync(path.join(sessionDir, 'creds.json'), credsJson);
                ws.send(JSON.stringify({ type: 'log', message: 'Session saved. Restarting bot...', level: 'success' }));
                setTimeout(() => process.exit(0), 500);
            } catch (err) {
                ws.send(JSON.stringify({ type: 'log', message: `Invalid session: ${err.message}`, level: 'error' }));
            }
        } else if (cmd === 'status') {
            const uptime = process.uptime();
            ws.send(JSON.stringify({ type: 'log', message: `Uptime: ${Math.floor(uptime)}s | Bot ${global.sock?.user ? 'connected' : 'disconnected'}`, level: 'info' }));
        } else if (cmd === 'restart') {
            ws.send(JSON.stringify({ type: 'log', message: 'Restarting...', level: 'info' }));
            setTimeout(() => process.exit(0), 500);
        } else {
            ws.send(JSON.stringify({ type: 'log', message: `Unknown command: ${cmd}. Type help`, level: 'error' }));
        }
    });

    ws.on('close', () => wsClients.delete(ws));
});

global.broadcastLog = (message, level = 'info') => {
    const data = JSON.stringify({ type: 'log', message, level });
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
};
global.broadcastMessage = (from, text) => {
    const data = JSON.stringify({ type: 'message', from, text });
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
};

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Web server running on port ${PORT} (0.0.0.0)`);
});
