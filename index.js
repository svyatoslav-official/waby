const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    downloadContentFromMessage, 
    fetchLatestBaileysVersion, 
    Browsers,
    DisconnectReason,
    getDevice
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
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        await delay(6000); 
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log("\n👉 PAIRING CODE:", code, "\n");
        } catch (err) { console.log("Wait 1 hour."); }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') console.log('🛡️  GOD-MODE ACTIVE: Listening for View-Once...');
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // 'notify' or 'append' - we listen to both just in case
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        // --- THE DEEP SCANNER ---
        const getMedia = (msg) => {
            // Check all known View-Once wrappers
            let content = msg.viewOnceMessageV2?.message || 
                          msg.viewOnceMessage?.message || 
                          msg.viewOnceMessageV3?.message ||
                          msg.ephemeralMessage?.message ||
                          msg.documentWithCaptionMessage?.message ||
                          msg;

            // Look for the media inside the content
            if (content.imageMessage) return { type: 'image', data: content.imageMessage };
            if (content.videoMessage) return { type: 'video', data: content.videoMessage };
            
            // Recursive check for nested folders (like quoted messages)
            for (let key of Object.keys(content)) {
                if (typeof content[key] === 'object' && content[key] !== null) {
                    let result = getMedia(content[key]);
                    if (result) return result;
                }
            }
            return null;
        };

        const media = getMedia(m.message);

        // Explicitly check if the media is actually a View-Once
        if (media && (media.data.viewOnce || m.message.viewOnceMessage || m.message.viewOnceMessageV2)) {
            console.log(`🔓 [DETECTED] Unlocking ${media.type}...`);
            
            try {
                const stream = await downloadContentFromMessage(media.data, media.type);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) { 
                    buffer = Buffer.concat([buffer, chunk]); 
                }

                // Send to YOURSELF
                const userNumber = sock.user.id.split(':')[0];
                const myID = `${userNumber}@s.whatsapp.net`;
                
                const sender = m.pushName || "Unknown";
                const source = m.key.remoteJid.includes('@g.us') ? "Group Chat" : "Private DM";

                await sock.sendMessage(myID, { 
                    [media.type]: buffer, 
                    caption: `🛰️ *GOD-MODE CAPTURE*\n👤 From: ${sender}\n📍 Source: ${source}\n🛡️ Protocol: Deep Scan`
                });

                console.log("✅ Successfully sent to Vault.");
            } catch (e) {
                console.log("❌ Decryption failed. Error:", e.message);
            }
        }
    });
}

startBot().catch(err => console.error(err));
