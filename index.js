const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    downloadContentFromMessage, 
    fetchLatestBaileysVersion, 
    Browsers 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const os = require('os');

// --- CONFIGURATION & GLOBALS ---
const args = process.argv.slice(2);
let unlockCount = 0;
let isEnabled = true;
const startTime = Date.now();

// Handle CLI Argument: --clean
if (args.includes('--clean')) {
    console.log('[!] Cleaning session data...');
    if (fs.existsSync('auth_session')) {
        fs.rmSync('auth_session', { recursive: true, force: true });
    }
}

const banner = `
 __      __         _              
 \\ \\    / /        | |             
  \\ \\  / /__  _ __ | |__  _   _    
   \\ \\/ / _ \\| '_ \\| '_ \\| | | |   
    \\  / (_) | |_) | |_) | |_| |   
     \\/ \\___/| .__/|_.__/ \\__, |   
             | |           __/ |   
             |_|          |___/    
 > Version: 1.5.0 | OS: Ubuntu-Chrome
 > Status: Waby Engine Initialized
------------------------------------`;

async function startBot() {
    console.clear();
    console.log(banner);

    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        // Fingerprint: Ubuntu Chrome
        browser: Browsers.ubuntu('Chrome') 
    });

    // Pairing Logic
    if (!sock.authState.creds.registered || args.includes('--pair')) {
        const phoneNumber = "94723748044"; 
        console.log(`[*] Target: ${phoneNumber}`);
        console.log(`[*] Requesting Pairing Code...`);
        await delay(6000); 
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\n[!] LINKING CODE: ${code}\n`);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (up) => { 
        const { connection } = up;
        if (connection === 'open') {
            console.log('[+] WABY ONLINE: System ready for triggers.');
        }
        if (connection === 'close') {
            console.log('[!] Connection lost. Re-engaging engine...');
            startBot(); 
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
        const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
        const isMe = msg.key.fromMe;

        // --- LAYER 1: IN-APP COMMANDS (Owner Only) ---
        if (isMe && body.startsWith('.')) {
            const cmd = body.toLowerCase().slice(1);

            switch (cmd) {
                case 'menu':
                    const menu = `📂 *WABY CONTROL CENTER*\n\n` +
                                 `• *.stats* - Extraction count\n` +
                                 `• *.runtime* - Uptime timer\n` +
                                 `• *.voff* - Stop extractor\n` +
                                 `• *.von* - Start extractor\n` +
                                 `• *.device* - HW Status\n` +
                                 `• *.ping* - Latency check\n` +
                                 `• *.cls* - Clear CLI\n` +
                                 `• *.restart* - Reboot system`;
                    await sock.sendMessage(myJid, { text: menu });
                    break;

                case 'stats':
                    await sock.sendMessage(myJid, { text: `📊 *STATS*\nUnlocked: ${unlockCount}\nActive: ${isEnabled}` });
                    break;

                case 'runtime':
                    const sec = Math.floor((Date.now() - startTime) / 1000);
                    const h = Math.floor(sec / 3600);
                    const m = Math.floor((sec % 3600) / 60);
                    const s = sec % 60;
                    await sock.sendMessage(myJid, { text: `⏱️ *RUNTIME*\n${h}h ${m}m ${s}s` });
                    break;

                case 'voff':
                    isEnabled = false;
                    await sock.sendMessage(myJid, { text: '🔴 *WABY PAUSED*' });
                    break;

                case 'von':
                    isEnabled = true;
                    await sock.sendMessage(myJid, { text: '🟢 *WABY RESUMED*' });
                    break;

                case 'device':
                    const info = `💻 *SYSTEM*\nOS: Ubuntu (Emulated)\nRAM: ${Math.round(os.freemem()/1024/1024)}MB Free\nArch: ${os.arch()}`;
                    await sock.sendMessage(myJid, { text: info });
                    break;

                case 'ping':
                    await sock.sendMessage(myJid, { text: '🏓 *Pong!* System active.' });
                    break;

                case 'cls':
                    console.clear();
                    console.log(banner);
                    await sock.sendMessage(myJid, { text: '🧹 *Terminal Logs Cleared.*' });
                    break;

                case 'restart':
                    await sock.sendMessage(myJid, { text: '🔄 *Restarting Engine...*' });
                    process.exit();
                    break;
            }
            return;
        }

        // --- LAYER 2: UNIVERSAL TRIGGER (Any text reply to View-Once) ---
        if (isEnabled && !isMe && body.length > 0 && quoted) {
            // Respect --group-off CLI flag
            const isGroup = msg.key.remoteJid.endsWith('@g.us');
            if (isGroup && args.includes('--group-off')) return;

            const viewOnce = quoted.viewOnceMessageV2 || quoted.viewOnceMessage || quoted.viewOnceMessageV2Extension;
            const target = viewOnce ? viewOnce.message : quoted;

            const mediaType = 
                target.imageMessage ? 'image' : 
                target.videoMessage ? 'video' : 
                target.audioMessage ? 'audio' : 
                target.documentMessage ? 'document' : null;

            if (mediaType) {
                try {
                    if (!args.includes('--silent')) console.log(`[>] Unlocking ${mediaType.toUpperCase()} from ${msg.pushName}...`);
                    if (args.includes('--test')) return console.log('[i] Test Mode: No message sent.');

                    const stream = await downloadContentFromMessage(target[`${mediaType}Message`], mediaType);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    const time = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo' });
                    const payload = {};

                    if (mediaType === 'image') payload.image = buffer;
                    else if (mediaType === 'video') payload.video = buffer;
                    else if (mediaType === 'audio') {
                        payload.audio = buffer;
                        payload.mimetype = 'audio/mp4';
                        payload.ptt = true; 
                    } 
                    else if (mediaType === 'document') {
                        payload.document = buffer;
                        payload.mimetype = target.documentMessage.mimetype;
                        payload.fileName = `Waby_${Date.now()}`;
                    }

                    payload.caption = `📂 *WABY UNLOCK SUCCESS*\n\n` +
                                    `👤 *From:* ${msg.pushName}\n` +
                                    `💬 *Trigger:* "${body}"\n` +
                                    `⏰ *Time:* ${time}\n` +
                                    `⚡ _System: Ubuntu-Chrome_`;

                    await sock.sendMessage(myJid, payload);
                    unlockCount++;
                } catch (e) { 
                    console.log("[!] Extraction Error:", e.message); 
                }
            }
        }
    });
}

startBot();
