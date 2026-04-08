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

    // 1. Pairing Handshake
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        console.log("🕒 Waiting 6s for handshake...");
        await delay(6000); 
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(`\n✅ YOUR LINKING CODE: ${code}\n`);
        } catch (err) {
            console.log("❌ Pairing Failed:", err.message);
        }
    }

    sock.ev.on('creds.update', saveCreds);

    // 2. Connection Status
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') console.log('🚀 BOT LIVE: Monitoring all messages...');
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    // 3. The Recursive Listener & Extractor
sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // 1. DETECT VIEW ONCE (The Modern Way)
        // We look for the 'viewOnce' property regardless of where it is hidden
        const m = msg.message;
        const viewOnceType = m.viewOnceMessageV2 || m.viewOnceMessage || m.viewOnceMessageV2Extension || m.ephemeralMessage?.message?.viewOnceMessageV2 || m.ephemeralMessage?.message?.viewOnceMessage;

        // 2. LOG EVERY TYPE FOR DIAGNOSTICS
        const rootType = Object.keys(m)[0];
        console.log(`📩 Raw Packet Type: ${rootType}`);

        if (viewOnceType) {
            console.log("🔓 ALERT: View-Once detected inside the packet!");

            const mediaObj = viewOnceType.message;
            if (!mediaObj) return;

            const mediaType = Object.keys(mediaObj)[0];
            console.log(`📂 Content Type: ${mediaType}`);

            if (mediaType === 'imageMessage' || mediaType === 'videoMessage') {
                try {
                    console.log("⏳ Downloading media content...");
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
                    
                    const response = {};
                    if (mediaType === 'imageMessage') response.image = buffer;
                    else response.video = buffer;

                    response.caption = `🔓 *Anti-ViewOnce Captured*\n👤 *Sender:* ${msg.pushName || 'Unknown'}\n📍 *Chat:* ${isGroup ? 'Group' : 'Private'}`;

                    await sock.sendMessage(myJid, response);
                    console.log("🏁 SUCCESS: Forwarded to your DM.");
                } catch (e) {
                    console.log("❌ EXTRACTION ERROR:", e.message);
                }
            }
        } else {
            // This tells us if it's a normal message that we are ignoring
            console.log("ℹ️ Normal message detected (Skipping)...");
        }
    });

startBot().catch(err => console.error("Fatal Error:", err));
