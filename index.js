const { default: makeWASocket, useMultiFileAuthState, delay, downloadContentFromMessage, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
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

    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        await delay(6000); 
        const code = await sock.requestPairingCode(phoneNumber);
        console.log("\n👉 NEW CODE:", code, "\n");
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (up) => {
        if (up.connection === 'open') console.log('🚀 SYSTEM READY: Monitoring every byte...');
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        // --- THE "BLIND SEARCH" LOGIC ---
        // We look for ANY media inside the message object, no matter where it's hidden
        const findMedia = (obj) => {
            if (!obj || typeof obj !== 'object') return null;
            if (obj.imageMessage || obj.videoMessage) {
                // If it's a viewOnce OR we are in a group/DM, we grab it
                if (obj.viewOnce || obj.imageMessage?.viewOnce || obj.videoMessage?.viewOnce) {
                    return obj.imageMessage ? { type: 'image', data: obj.imageMessage } : { type: 'video', data: obj.videoMessage };
                }
            }
            for (let k in obj) {
                let found = findMedia(obj[k]);
                if (found) return found;
            }
            return null;
        };

        const media = findMedia(m.message);

        if (media) {
            console.log(`🔓 FOUND: ${media.type}. Extracting...`);
            try {
                const stream = await downloadContentFromMessage(media.data, media.type);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                const myID = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                await sock.sendMessage(myID, { 
                    [media.type]: buffer, 
                    caption: `🛰️ *ULTRA-SCAN CAPTURE*\n👤 From: ${m.pushName || "User"}` 
                });
                console.log("✅ Sent to personal chat.");
            } catch (e) { console.log("❌ Sync Error:", e.message); }
        }
    });
}
startBot().catch(e => console.error(e));
