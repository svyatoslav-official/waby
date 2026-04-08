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
        browser: Browsers.macOS('Chrome'),
        syncFullHistory: false
    });

    // Pairing Logic
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        console.log("🕒 Handshaking...");
        await delay(6000); 
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(`\n✅ YOUR PAIRING CODE: ${code}\n`);
        } catch (err) { console.log("❌ Error:", err.message); }
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (up) => {
        if (up.connection === 'open') console.log('🚀 BOT READY: Reply to a View-Once with .vv');
        if (up.connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        // Get the text from the message (standard or button/template)
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const command = body.toLowerCase().trim();

        // CHECK FOR COMMAND: .vv
        if (command === '.vv') {
            // 1. Check if the user is replying to a message
            const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMsg) return;

            // 2. Find the View-Once media inside the quoted message
            const viewOnce = quotedMsg.viewOnceMessageV2 || quotedMsg.viewOnceMessage || quotedMsg.viewOnceMessageV2Extension;
            const mediaObj = viewOnce ? viewOnce.message : quotedMsg; // Check if already unwrapped
            
            const mediaType = mediaObj.imageMessage ? 'imageMessage' : (mediaObj.videoMessage ? 'videoMessage' : null);
            
            if (mediaType) {
                console.log(`🔓 Command triggered! Unlocking ${mediaType}...`);
                try {
                    const stream = await downloadContentFromMessage(
                        mediaObj[mediaType], 
                        mediaType === 'imageMessage' ? 'image' : 'video'
                    );
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { 
                        buffer = Buffer.concat([buffer, chunk]); 
                    }

                    const content = {};
                    content[mediaType === 'imageMessage' ? 'image' : 'video'] = buffer;
                    content.caption = "🔓 *View-Once Unlocked via Command*";

                    // Send it back to the chat
                    await sock.sendMessage(msg.key.remoteJid, content, { quoted: msg });
                    console.log("✅ Sent.");
                } catch (e) {
                    console.log("❌ Command Error:", e.message);
                }
            } else {
                console.log("ℹ️ No View-Once media found in that reply.");
            }
        }
    });
}

startBot();
