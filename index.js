const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    downloadContentFromMessage, 
    fetchLatestBaileysVersion, 
    Browsers,
    DisconnectReason 
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
        browser: Browsers.macOS('Chrome'), 
        syncFullHistory: false
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        console.log("🕒 Waiting 6s for handshake...");
        await delay(6000); 
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log("\n" + "=".repeat(35));
            console.log("✅ YOUR LINKING CODE:", code);
            console.log("=".repeat(35) + "\n");
        } catch (err) {
            console.log("❌ Pairing Failed:", err.message);
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('🚀 BOT ONLINE: Monitoring all incoming packets...');
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const m = msg.message;
        
        // --- DEEP SCAN LOGIC ---
        // This checks top-level AND inside ephemeral wrappers
        const viewOnceCheck = 
            m.viewOnceMessageV2 || 
            m.viewOnceMessage || 
            m.viewOnceMessageV2Extension || 
            m.ephemeralMessage?.message?.viewOnceMessageV2 || 
            m.ephemeralMessage?.message?.viewOnceMessage ||
            m.ephemeralMessage?.message?.viewOnceMessageV2Extension;

        // Log the packet type for debugging
        const rootType = Object.keys(m)[0];
        console.log(`📩 Raw Packet: ${rootType} | From: ${msg.pushName || 'User'}`);

        if (viewOnceCheck) {
            console.log("🔓 VIEW-ONCE DETECTED! Unwrapping...");

            // Get the actual media (image or video)
            const mediaObj = viewOnceCheck.message;
            if (!mediaObj) return;

            const mediaType = Object.keys(mediaObj)[0]; 

            if (mediaType === 'imageMessage' || mediaType === 'videoMessage') {
                try {
                    console.log(`⏳ Downloading ${mediaType}...`);
                    
                    const stream = await downloadContentFromMessage(
                        mediaObj[mediaType], 
                        mediaType === 'imageMessage' ? 'image' : 'video'
                    );
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { 
                        buffer = Buffer.concat([buffer, chunk]); 
                    }

                    const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                    const isGroup = msg.key.remoteJid.endsWith('@g.us');
                    
                    const payload = {};
                    if (mediaType === 'imageMessage') payload.image = buffer;
                    else payload.video = buffer;

                    payload.caption = `🔓 *Anti-ViewOnce Captured*\n\n` +
                                     `👤 *Sender:* ${msg.pushName || 'Unknown'}\n` +
                                     `📍 *Chat:* ${isGroup ? 'Group' : 'Private'}\n` +
                                     `🆔 *Sender ID:* ${msg.key.participant || msg.key.remoteJid}`;

                    await sock.sendMessage(myJid, payload);
                    console.log("🏁 SUCCESS: Permanent copy sent to your DM.");
                } catch (e) {
                    console.log("❌ EXTRACTION ERROR:", e.message);
                }
            }
        }
    });
}

startBot().catch(err => console.error("Fatal Error:", err));
