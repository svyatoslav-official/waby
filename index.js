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
        browser: Browsers.macOS('Chrome')
    });

    // Pairing / Handshake
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        await delay(6000); 
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\n✅ LINKING CODE: ${code}\n`);
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (up) => { 
        if (up.connection === 'open') console.log('🚀 AUTO-DETECT ACTIVE: Monitoring View-Once media...');
        if (up.connection === 'close') startBot(); 
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        // Ignore own messages and system messages
        if (!msg.message || msg.key.fromMe) return;

        // --- RECURSIVE AUTO-DETECTION LOGIC ---
        const findViewOnce = (obj) => {
            if (!obj || typeof obj !== 'object') return null;
            
            // Look for any of the common View-Once wrapper keys
            const vo = obj.viewOnceMessageV2 || obj.viewOnceMessage || obj.viewOnceMessageV2Extension;
            if (vo) return vo.message;

            // Deep scan for ephemeral wrappers
            for (const key in obj) {
                const found = findViewOnce(obj[key]);
                if (found) return found;
            }
            return null;
        };

        const target = findViewOnce(msg.message);

        if (target) {
            // Determine media type
            const mediaType = 
                target.imageMessage ? 'image' : 
                target.videoMessage ? 'video' : 
                target.audioMessage ? 'audio' : null;

            if (mediaType) {
                try {
                    console.log(`🔓 Auto-Detected ${mediaType}! Extracting...`);
                    
                    const mediaKey = `${mediaType}Message`;
                    const stream = await downloadContentFromMessage(target[mediaKey], mediaType);
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                    const payload = {};

                    if (mediaType === 'image') payload.image = buffer;
                    else if (mediaType === 'video') payload.video = buffer;
                    else if (mediaType === 'audio') {
                        payload.audio = buffer;
                        payload.mimetype = 'audio/mp4';
                        payload.ptt = true; 
                    }

                    const chatType = msg.key.remoteJid.endsWith('@g.us') ? 'Group' : 'Private';
                    payload.caption = `🚀 *Auto-Intercept Success*\n📂 *Type:* ${mediaType.toUpperCase()}\n👤 *From:* ${msg.pushName}\n📍 *Chat:* ${chatType}`;

                    // Silent Redirect to your DM
                    await sock.sendMessage(myJid, payload);
                    console.log(`🏁 Auto-forwarded ${mediaType} to your DM.`);
                } catch (e) { 
                    console.log("❌ Auto-Extraction Error:", e.message); 
                }
            }
        }
    });
}

startBot();
