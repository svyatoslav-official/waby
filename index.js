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
            console.log("\n✅ YOUR CODE: " + code + "\n");
        } catch (err) {
            console.log("❌ Pairing Failed:", err.message);
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') console.log('🚀 BOT ACTIVE: Monitoring View-Once...');
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const m = msg.message;

        // --- THE "CHATGPT + EXTENSION" FIX ---
        // We check every possible layer where WhatsApp hides the View-Once message
        const viewOnceCheck = 
            m?.viewOnceMessageV2 || 
            m?.viewOnceMessage || 
            m?.viewOnceMessageV2Extension ||
            m?.ephemeralMessage?.message?.viewOnceMessageV2 || 
            m?.ephemeralMessage?.message?.viewOnceMessage ||
            m?.ephemeralMessage?.message?.viewOnceMessageV2Extension;

        // LOGGING: This helps us see if the logic above "caught" it
        const rootType = Object.keys(m)[0];
        console.log(`📩 Received Packet: ${rootType}`);

        if (viewOnceCheck) {
            console.log("🔓 VIEW-ONCE DETECTED! Processing...");

            // The media object is always inside the .message property of the wrapper
            const mediaObj = viewOnceCheck.message;
            if (!mediaObj) return;

            const mediaType = Object.keys(mediaObj)[0]; // imageMessage or videoMessage

            if (mediaType === 'imageMessage' || mediaType === 'videoMessage') {
                try {
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
                    payload[mediaType === 'imageMessage' ? 'image' : 'video'] = buffer;
                    payload.caption = `🔓 *Anti-ViewOnce Success*\n👤 *From:* ${msg.pushName || 'User'}`;

                    await sock.sendMessage(myJid, payload);
                    console.log("🏁 SUCCESS: Forwarded to your DM.");
                } catch (e) {
                    console.log("❌ EXTRACTION ERROR:", e.message);
                }
            }
        }
    });
}

startBot().catch(err => console.error("Fatal Error:", err));
