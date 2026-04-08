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

        // Log the message type for debugging
        const msgType = Object.keys(msg.message)[0];
        console.log(`📩 Received: ${msgType} from ${msg.pushName || 'User'}`);

        // Deep Search for View-Once Content
        const viewOnceCheck = msg.message.viewOnceMessageV2 || 
                             msg.message.viewOnceMessage || 
                             msg.message.viewOnceMessageV2Extension;

        if (viewOnceCheck) {
            console.log("🔓 VIEW-ONCE DETECTED! Processing...");

            // Extract the actual media object inside the wrapper
            const mediaObj = viewOnceCheck.message;
            const mediaType = Object.keys(mediaObj)[0]; // 'imageMessage' or 'videoMessage'

            if (mediaType === 'imageMessage' || mediaType === 'videoMessage') {
                try {
                    // Start Extraction
                    const stream = await downloadContentFromMessage(
                        mediaObj[mediaType], 
                        mediaType === 'imageMessage' ? 'image' : 'video'
                    );
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { 
                        buffer = Buffer.concat([buffer, chunk]); 
                    }

                    // Prepare Delivery to your DM
                    const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                    const isGroup = msg.key.remoteJid.endsWith('@g.us');
                    
                    const response = {};
                    if (mediaType === 'imageMessage') response.image = buffer;
                    else response.video = buffer;

                    response.caption = `✅ *View-Once Unlocked*\n\n` +
                                     `👤 *Sender:* ${msg.pushName || 'Unknown'}\n` +
                                     `📍 *Source:* ${isGroup ? 'Group Chat' : 'Private DM'}`;

                    await sock.sendMessage(myJid, response);
                    console.log("🏁 SUCCESS: Permanent copy sent to your DM.");
                } catch (e) {
                    console.log("❌ EXTRACTION ERROR:", e.message);
                }
            }
        }
    });
}

startBot().catch(err => console.error("Fatal Error:", err));
