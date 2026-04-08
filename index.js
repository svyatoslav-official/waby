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

    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        await delay(6000); 
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\n✅ CODE: ${code}\n`);
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (up) => { if (up.connection === 'close') startBot(); });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        
        if (body.toLowerCase().trim() === '.vv') {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return;

            // 1. Unwrapping multiple layers (View-Once or Ephemeral)
            const viewOnce = quoted.viewOnceMessageV2 || quoted.viewOnceMessage || quoted.viewOnceMessageV2Extension;
            const target = viewOnce ? viewOnce.message : quoted;

            // 2. DETECT ALL MEDIA TYPES
            const mediaType = 
                target.imageMessage ? 'image' : 
                target.videoMessage ? 'video' : 
                target.audioMessage ? 'audio' : 
                target.documentMessage ? 'document' : null;

            if (mediaType) {
                try {
                    console.log(`🔓 Unlocking View-Once ${mediaType}...`);
                    
                    // Get the specific message object (e.g., target.audioMessage)
                    const mediaKey = `${mediaType}Message`;
                    const stream = await downloadContentFromMessage(target[mediaKey], mediaType);
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                    const payload = {};

                    // 3. CONSTRUCT PAYLOAD BASED ON TYPE
                    if (mediaType === 'image') payload.image = buffer;
                    else if (mediaType === 'video') payload.video = buffer;
                    else if (mediaType === 'audio') {
                        payload.audio = buffer;
                        payload.mimetype = 'audio/mp4'; // Standard WhatsApp audio mime
                        payload.ptt = true; // Makes it look like a blue voice note
                    } 
                    else if (mediaType === 'document') {
                        payload.document = buffer;
                        payload.mimetype = target.documentMessage.mimetype;
                        payload.fileName = target.documentMessage.fileName || 'unlocked_file';
                    }

                    payload.caption = `🔓 *Universal Unlock Success*\n📂 *Type:* ${mediaType.toUpperCase()}\n👤 *From:* ${msg.pushName}`;

                    // Send to Private DM
                    await sock.sendMessage(myJid, payload);
                    
                    // Cleanup: Delete your command so the chat stays clean
                    await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });

                    console.log(`🏁 ${mediaType.toUpperCase()} sent to private DM.`);
                } catch (e) { 
                    console.log("❌ Extraction Error:", e.message); 
                }
            } else {
                console.log("ℹ️ No compatible media found in reply.");
            }
        }
    });
}

startBot();
