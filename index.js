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
    // 1. Session & Versioning
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // Using Pairing Code instead
        browser: Browsers.macOS('Chrome'), 
        syncFullHistory: false
    });

    // 2. The Pairing Code Handshake
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        console.log("🕒 Waiting for server to stabilize (6s)...");
        await delay(6000); 
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log("\n" + "=".repeat(30));
            console.log("✅ YOUR LINKING CODE:", code);
            console.log("=".repeat(30) + "\n");
        } catch (err) {
            console.log("❌ Pairing Request Failed:", err.message);
        }
    }

    // 3. Credential Management
    sock.ev.on('creds.update', saveCreds);

    // 4. Connection Logic
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('🚀 GLOBAL MONITORING ACTIVE: Viewing all chats...');
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            console.log(`🔄 Connection lost. Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) startBot();
        }
    });

    // 5. The Interceptor & Extraction Logic
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        // Don't process our own messages or empty messages
        if (!msg.message || msg.key.fromMe) return;

        const type = Object.keys(msg.message)[0];
        
        // Listen for all View-Once variations (V1 and V2)
        if (type === 'viewOnceMessageV2' || type === 'viewOnceMessage') {
            const viewOnce = msg.message[type].message;
            const mediaType = Object.keys(viewOnce)[0]; // imageMessage or videoMessage
            
            // Only process if it's actually media
            if (!['imageMessage', 'videoMessage'].includes(mediaType)) return;

            const isGroup = msg.key.remoteJid.endsWith('@g.us');
            const chatName = isGroup ? "Group Chat" : "Private DM";

            console.log(`🔓 Detected View-Once ${mediaType === 'imageMessage' ? 'Photo' : 'Video'}!`);

            try {
                // Decrypt and stream the content
                const stream = await downloadContentFromMessage(
                    viewOnce[mediaType], 
                    mediaType === 'imageMessage' ? 'image' : 'video'
                );
                
                let buffer = Buffer.from([]);
                for await (const chunk of stream) { 
                    buffer = Buffer.concat([buffer, chunk]); 
                }

                // Prepare the payload for your DM
                const content = {};
                content[mediaType === 'imageMessage' ? 'image' : 'video'] = buffer;
                content.caption = `🔓 *Anti-ViewOnce Captured*\n\n` +
                                 `👤 *From:* ${msg.pushName || 'Unknown'}\n` +
                                 `📱 *Type:* ${chatName}\n` +
                                 `🆔 *Sender ID:* ${msg.key.participant || msg.key.remoteJid}`;

                // Send the "unlocked" media to your own WhatsApp (Message Yourself)
                const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                await sock.sendMessage(myJid, content);
                
                console.log("✅ Decrypted media forwarded to your DM.");
            } catch (e) {
                console.log("❌ Extraction Error:", e.message);
            }
        }
    });
}

// Global error handler to keep the process alive
startBot().catch(err => console.error("Fatal Process Error:", err));
