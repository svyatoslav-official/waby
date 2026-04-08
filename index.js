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
        console.log("🕒 Handshaking...");
        await delay(6000); 
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log("\n✅ YOUR CODE: " + code + "\n");
        } catch (err) { console.log("❌ Error:", err.message); }
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (up) => {
        if (up.connection === 'open') console.log('🚀 GHOST BOT ACTIVE: Results will be sent to your Private DM');
        if (up.connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (body.toLowerCase().trim() === '.vv') {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return;

            const viewOnce = quoted.viewOnceMessageV2 || quoted.viewOnceMessage || quoted.viewOnceMessageV2Extension;
            const target = viewOnce ? viewOnce.message : quoted;
            const mediaType = target.imageMessage ? 'imageMessage' : (target.videoMessage ? 'videoMessage' : null);

            if (mediaType) {
                try {
                    console.log(`🔓 Unlocking ${mediaType} privately...`);
                    const stream = await downloadContentFromMessage(target[mediaType], mediaType === 'imageMessage' ? 'image' : 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    // --- THE GHOST REDIRECT ---
                    const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                    const content = {};
                    content[mediaType === 'imageMessage' ? 'image' : 'video'] = buffer;
                    content.caption = `🔓 *Ghost Bypass Success*\n👤 *From:* ${msg.pushName || 'User'}\n📍 *Chat:* ${msg.key.remoteJid}`;

                    await sock.sendMessage(myJid, content);
                    console.log("🏁 SUCCESS: Sent to your personal DM.");
                } catch (e) { console.log("❌ Error:", e.message); }
            }
        }
    });
}

startBot();
