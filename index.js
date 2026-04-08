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
        browser: Browsers.macOS('Chrome'), // Identification
        syncFullHistory: false
    });

    // 3. Pairing Code Logic
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        console.log("🕒 Waiting 6 seconds for server handshake...");
        await delay(6000); 
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log("\n==============================");
            console.log("👉 YOUR WHATSAPP CODE:", code);
            console.log("==============================\n");
        } catch (err) {
            console.log("❌ Request failed. Check your internet or wait 1 hour.");
        }
    }

    // 4. Handle Credential Updates
    sock.ev.on('creds.update', saveCreds);

    // 5. Handle Connection Status
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('✅ SUCCESS: Bot is linked and monitoring!');
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 Connection lost. Reconnecting...', shouldReconnect);
            if (shouldReconnect) startBot();
        }
    });

    // 6. The "View-Once" Bypass Logic
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const type = Object.keys(msg.message)[0];
        
        if (type === 'viewOnceMessageV2' || type === 'viewOnceMessage') {
            console.log("🔓 View-Once detected! Unlocking...");
            
            const viewOnce = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message;
            const mediaType = Object.keys(viewOnce)[0]; 
            
            try {
                const stream = await downloadContentFromMessage(
                    viewOnce[mediaType], 
                    mediaType === 'imageMessage' ? 'image' : 'video'
                );
                
                let buffer = Buffer.from([]);
                for await (const chunk of stream) { 
                    buffer = Buffer.concat([buffer, chunk]); 
                }

                const content = {};
                if (mediaType === 'imageMessage') {
                    content.image = buffer;
                } else {
                    content.video = buffer;
                }
                content.caption = "🔓 *Anti-ViewOnce Success*";

                // Sends the media back to you in the same chat
                await sock.sendMessage(msg.key.remoteJid, content, { quoted: msg });
                console.log("✅ Decrypted and sent.");
            } catch (e) {
                console.log("❌ Unlock Error:", e.message);
            }
        }
    });
}

startBot().catch(err => console.error("Fatal Error:", err));
