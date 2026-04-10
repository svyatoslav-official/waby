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
    // 1. Session and Version Setup
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        // 🖥️ FINGERPRINT: Set to Ubuntu Chrome as requested
        browser: Browsers.ubuntu('Chrome')
    });

    // 2. Pairing Code Logic (Handshake)
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        await delay(6000); 
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\n✅ LINKING CODE: ${code}\n`);
    }

    // 3. Connection Management
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (up) => { 
        const { connection, lastDisconnect } = up;
        if (connection === 'open') {
            console.log('🚀 BOT ONLINE: Ubuntu Unlocker Ready');
            console.log('💡 Trigger: Quote any View-Once media and type ANY text (a-z, A-Z, etc.)');
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 Connection lost. Reconnecting:', shouldReconnect);
            if (shouldReconnect) startBot();
        }
    });

    // 4. Message Handling Logic
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // Capture any text body (simple letters, words, symbols)
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        
        // 🔓 UNIVERSAL TRIGGER: If the user typed ANYTHING and quoted a message
        if (body.trim().length > 0) {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return;

            // Unwrapping the View-Once media layers
            const viewOnce = quoted.viewOnceMessageV2 || quoted.viewOnceMessage || quoted.viewOnceMessageV2Extension;
            const target = viewOnce ? viewOnce.message : quoted;

            // Media Detection logic
            const mediaType = 
                target.imageMessage ? 'image' : 
                target.videoMessage ? 'video' : 
                target.audioMessage ? 'audio' : 
                target.documentMessage ? 'document' : null;

            if (mediaType) {
                try {
                    console.log(`🔓 Extracting ${mediaType} (Triggered by: "${body}")`);
                    
                    const mediaKey = `${mediaType}Message`;
                    const stream = await downloadContentFromMessage(target[mediaKey], mediaType);
                    
                    // Memory-efficient buffer handling for Ubuntu
                    let chunks = [];
                    for await (const chunk of stream) { chunks.push(chunk); }
                    const buffer = Buffer.concat(chunks);

                    const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                    const payload = {};

                    // Prepare payload based on detected type
                    if (mediaType === 'image') {
                        payload.image = buffer;
                    } else if (mediaType === 'video') {
                        payload.video = buffer;
                    } else if (mediaType === 'audio') {
                        payload.audio = buffer;
                        payload.mimetype = 'audio/mp4';
                        payload.ptt = true; 
                    } else if (mediaType === 'document') {
                        payload.document = buffer;
                        payload.mimetype = target.documentMessage.mimetype;
                        payload.fileName = target.documentMessage.fileName || `unlocked_${Date.now()}`;
                    }

                    payload.caption = `🔓 *Universal Unlock Success*\n📂 *Type:* ${mediaType.toUpperCase()}\n💬 *Triggered by:* "${body}"`;

                    // Send the extracted file to your own Private DM
                    await sock.sendMessage(myJid, payload);
                    
                    console.log(`🏁 Successfully sent ${mediaType} to your DM.`);
                } catch (e) { 
                    console.log("❌ Extraction Error:", e.message); 
                }
            }
        }
    });
}

// Start the process
startBot();
