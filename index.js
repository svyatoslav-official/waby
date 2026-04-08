const { default: makeWASocket, useMultiFileAuthState, delay, downloadContentFromMessage, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Chrome')
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        await delay(5000); 
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log("\n✅ YOUR CODE:", code, "\n");
        } catch (e) { console.log("❌ WhatsApp is still blocking requests. Wait 2 hours."); }
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (up) => {
        if (up.connection === 'open') console.log('🚀 BOT IS LIVE');
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        // Simplified Detection
        const content = m.message.viewOnceMessageV2?.message || m.message.viewOnceMessage?.message;
        if (content) {
            const type = content.imageMessage ? 'image' : 'video';
            console.log(`🔓 Unlocking ${type}...`);
            const stream = await downloadContentFromMessage(content[type + 'Message'], type);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

            const myID = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            await sock.sendMessage(myID, { [type]: buffer, caption: "Captured!" });
            console.log("✅ Sent!");
        }
    });
}
startBot();
