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
    // 1. Setup session storage
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();
    
    // 2. Initialize connection
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.macOS('Chrome'),
        syncFullHistory: false
    });

    // 3. Pairing Code Logic (Your Number)
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        console.log("🕒 Waiting for server handshake...");
        await delay(6000); 
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log("\n==============================");
            console.log("👉 YOUR PAIRING CODE:", code);
            console.log("==============================\n");
        } catch (err) {
            console.log("❌ Request failed. Wait 1 hour.");
        }
    }

    // 4. Handle Credential Updates
    sock.ev.on('creds.update', saveCreds);

    // 5. Handle Connection Status
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('✅ BOT ACTIVE: Monitoring DMs & Groups...');
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    // 6. Universal View-Once Bypass Logic
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        // Detection Logic
        const type = Object.keys(m.message)[0];
        const msgContent = m.message[type];
        
        // Comprehensive check for View-Once flags
        const isViewOnce = msgContent?.viewOnce || type === 'viewOnceMessageV2' || type === 'viewOnceMessage';

        if (isViewOnce) {
            console.log("🔓 View-Once Detected! Unlocking media...");
            
            // Extract media content regardless of wrapper type
            const mediaData = m.message.viewOnceMessageV2?.message || m.message.viewOnceMessage?.message || m.message;
            const mediaType = Object.keys(mediaData)[0]; 
            const isVideo = mediaType === 'videoMessage';
            
            try {
                // Download the encrypted buffer
                const stream = await downloadContentFromMessage(
                    mediaData[mediaType], 
                    isVideo ? 'video' : 'image'
                );
                
                let buffer = Buffer.from([]);
                for await (const chunk of stream) { 
                    buffer = Buffer.concat([buffer, chunk]); 
                }

                // Target your own "Message Yourself" chat
                const myID = sock.user.id.split(':')[0] + '@s.whatsapp.net'; 
                const senderName = m.pushName || "Unknown Sender";
                const source = m.key.remoteJid.includes('@g.us') ? "Group Chat" : "Private DM";

                // Send the permanent copy to your personal DM
                await sock.sendMessage(myID, { 
                    [isVideo ? 'video' : 'image']: buffer, 
                    caption: `📂 *VAULT CAPTURE*\n👤 From: ${senderName}\n📍 Source: ${source}`
                });

                console.log(`✅ Forwarded to your DM.`);
            } catch (e) {
                console.log("❌ Unlock Error:", e.message);
            }
        }
    });
}

startBot().catch(err => console.error("Fatal Error:", err));
