const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    downloadContentFromMessage, 
    fetchLatestBaileysVersion, 
    Browsers,
    extractMessageContent 
} = require('@whiskeysockets/baileys');
const pino = require('pino');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // Disables QR to prioritize Pairing Code
        browser: Browsers.ubuntu('Chrome'), // Stable browser string for pairing
        syncFullHistory: false
    });

    // --- 1. STABILIZED PAIRING CODE LOGIC ---
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        console.log("🕒 Initializing connection to WhatsApp...");

        sock.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;
            if (qr || connection === 'connecting') {
                console.log("📡 Server ready. Requesting pairing code...");
                await delay(7000); // Essential delay for server handshake
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log("\n" + "=".repeat(30));
                    console.log("✅ YOUR LINK CODE:", code);
                    console.log("=".repeat(30) + "\n");
                } catch (err) {
                    console.log("❌ Failed to get code. Wait 10 mins and restart.");
                }
            }
        });
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('🚀 BOT ONLINE: Auto-Detector & .vv Backup Active');
        }
        if (connection === 'close') {
            console.log('🔄 Reconnecting...');
            startBot();
        }
    });

    // --- 2. THE DUAL-MODE DETECTOR (AUTO + MANUAL) ---
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        // --- PART A: AUTO-INTERCEPTOR ---
        const fullContent = extractMessageContent(msg.message);
        const viewOnce = fullContent?.viewOnceMessageV2 || fullContent?.viewOnceMessageV2Extension || fullContent?.viewOnceMessage;

        if (viewOnce) {
            console.log("🕵️ Auto-Detected View-Once. Syncing...");
            await delay(3000); // Wait for media keys to populate
            await processMedia(viewOnce.message || viewOnce, msg.pushName);
        }

        // --- PART B: MANUAL .VV BACKUP ---
        if (body.toLowerCase().trim() === '.vv') {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted) {
                console.log("🔓 Manual Unlock triggered...");
                const qContent = extractMessageContent(quoted);
                const target = qContent?.viewOnceMessageV2?.message || qContent?.viewOnceMessage?.message || qContent;
                await processMedia(target, msg.pushName);
            }
        }

        // --- PART C: PROCESSING FUNCTION ---
        async function processMedia(target, senderName) {
            const type = target.imageMessage ? 'image' : (target.videoMessage ? 'video' : (target.audioMessage ? 'audio' : null));
            if (!type) return;

            try {
                const mediaKey = `${type}Message`;
                const stream = await downloadContentFromMessage(target[mediaKey], type);
                
                let buffer = Buffer.from([]);
                for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                const payload = {};
                payload[type] = buffer;
                payload.caption = `🔓 *Unlocked Success*\n👤 *From:* ${senderName || 'User'}\n📂 *Type:* ${type.toUpperCase()}`;
                
                if (type === 'audio') { 
                    payload.ptt = true; 
                    payload.mimetype = 'audio/mp4'; 
                }

                await sock.sendMessage(myJid, payload);
                console.log(`🏁 Done! Media forwarded to your DM.`);
            } catch (e) {
                console.log("❌ Sync Error: Keys not yet available.");
            }
        }
    });
}

// Start the bot
startBot().catch(err => console.log("Fatal Error:", err));
