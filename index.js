const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    downloadContentFromMessage, 
    fetchLatestBaileysVersion, 
    Browsers 
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
        browser: Browsers.macOS('Chrome')
    });

    // Pairing Logic
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        console.log("🕒 Handshaking...");
        await delay(6000); 
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log("\n👉 PAIRING CODE:", code, "\n");
        } catch (err) { console.log("Error: Try again in 1 hour."); }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (up) => {
        if (up.connection === 'open') console.log('✅ BOT ACTIVE: Monitoring DMs & Groups...');
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        // Ignore messages sent by you to avoid infinite loops
        if (!m.message || m.key.fromMe) return;

        const type = Object.keys(m.message)[0];
        const isViewOnce = type === 'viewOnceMessageV2' || type === 'viewOnceMessage';

        if (isViewOnce) {
            console.log("🔓 View-Once detected! Forwarding to your DM...");

            // Get YOUR unique WhatsApp ID
            const myID = sock.user.id.split(':')[0] + '@s.whatsapp.net'; 

            const content = m.message[type].message;
            const mediaType = Object.keys(content)[0]; 
            const isVideo = mediaType === 'videoMessage';

            try {
                // Download the media buffer
                const stream = await downloadContentFromMessage(
                    content[mediaType], 
                    isVideo ? 'video' : 'image'
                );
                
                let buffer = Buffer.from([]);
                for await (const chunk of stream) { 
                    buffer = Buffer.concat([buffer, chunk]); 
                }

                const senderName = m.pushName || "Unknown";
                const location = m.key.remoteJid.includes('@g.us') ? "Group Chat" : "Private DM";

                // Send to YOURSELF (Message Yourself chat)
                await sock.sendMessage(myID, { 
                    [isVideo ? 'video' : 'image']: buffer, 
                    caption: `📂 *VIEW-ONCE CAPTURED*\n👤 From: ${senderName}\n📍 Source: ${location}`
                });

                console.log(`✅ Success! Check your WhatsApp chat.`);
            } catch (e) {
                console.log("❌ Decryption failed:", e.message);
            }
        }
    });
}

startBot();
