const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    downloadContentFromMessage, 
    fetchLatestBaileysVersion, 
    Browsers,
    normalizeMessageContent,
    getContentType
} = require('@whiskeysockets/baileys');
const pino = require('pino');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'), // Best for Pairing Code stability
        syncFullHistory: false,
        // Helps the bot "pull" missing keys from the server during sync
        getMessage: async (key) => { return { conversation: 'syncing' } }
    });

    // --- 🔑 STABILIZED PAIRING CODE SOLICITOR ---
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        console.log("🕒 Initializing... Waiting for server handshake window.");
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;
            if (qr || connection === 'connecting') {
                await delay(10000); // 10s wait is the sweet spot for 2026 servers
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n✅ YOUR LINK CODE: ${code}\n`);
                } catch (e) {
                    console.log("❌ Server busy. Restart the bot and try again.");
                }
            }
        });
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (up) => {
        if (up.connection === 'open') console.log('🚀 SYSTEM ONLINE: Auto-Detecting View-Once...');
        if (up.connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return; // Note: removed fromMe check so you can test it yourself

        const m = msg.message;
        const body = m.conversation || m.extendedTextMessage?.text || "";
        
        // 1. ADVANCED DETECTION (Based on your Study Logs)
        const findVO = (obj) => {
            if (!obj) return null;
            // Check for VO wrappers or internal "viewOnce" flags found in your logs
            const isVO = obj.viewOnceMessageV2 || obj.viewOnceMessage || obj.viewOnceMessageV2Extension;
            const content = isVO ? (isVO.message || isVO) : obj;
            
            const media = content.imageMessage || content.videoMessage || content.audioMessage;
            if (media?.viewOnce || isVO) return content;
            return null;
        };

        const targetContent = findVO(m);

        // 2. TRIGGER: Auto-Intercept OR Manual .vv
        if (targetContent || body.toLowerCase().trim() === '.vv') {
            console.log("🔓 Target Detected. Waiting for Decryption Keys...");
            
            let target = targetContent;
            
            // Fallback for manual .vv command
            if (body.toLowerCase().trim() === '.vv') {
                const quoted = m.extendedTextMessage?.contextInfo?.quotedMessage;
                const normalized = normalizeMessageContent(quoted);
                target = findVO(normalized) || normalized;
            }

            if (!target) return;

            const type = target.imageMessage ? 'image' : (target.videoMessage ? 'video' : (target.audioMessage ? 'audio' : null));
            if (!type) return;

            // 3. THE "KEY-WAIT" RETRY LOOP
            // We try 3 times to ensure the Signal Handshake (APP_STATE_SYNC) finishes
            for (let i = 0; i < 3; i++) {
                try {
                    await delay(3000); // 3s wait per attempt
                    const mediaData = target[`${type}Message`];
                    
                    const stream = await downloadContentFromMessage(mediaData, type);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    if (buffer.length > 50) {
                        const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                        const payload = {
                            [type]: buffer,
                            caption: `🚀 *Auto-Intercept Success*\n👤 *From:* ${msg.pushName || 'User'}\n📂 *Type:* ${type.toUpperCase()}`
                        };
                        
                        if (type === 'audio') { 
                            payload.ptt = true; 
                            payload.mimetype = 'audio/mp4'; 
                        }

                        await sock.sendMessage(myJid, payload);
                        console.log(`🏁 Done: ${type} forwarded to DM.`);
                        return; // Exit on success
                    }
                } catch (e) {
                    console.log(`📡 Syncing keys (Attempt ${i+1})...`);
                }
            }
            console.log("❌ Exhausted: Server refused to send decryption keys.");
        }
    });
}

startBot();
