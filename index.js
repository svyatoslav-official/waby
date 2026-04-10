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
        if (up.connection === 'open') console.log('🚀 BOT ONLINE: Universal Media Unlocker Ready');
        if (up.connection === 'close') startBot(); 
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        // Extract body - check if there is any text sent
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;

        // TRIGGER LOGIC: If there is a body (any letter/word) AND a quoted message exists
        if (body.length > 0 && quoted) {
            
            // Unwrapping View-Once layers
            const viewOnce = quoted.viewOnceMessageV2 || quoted.viewOnceMessage || quoted.viewOnceMessageV2Extension;
            const target = viewOnce ? viewOnce.message : quoted;

            // Detection logic
            const mediaType = 
                target.imageMessage ? 'image' : 
                target.videoMessage ? 'video' : 
                target.audioMessage ? 'audio' : 
                target.documentMessage ? 'document' : null;

            // Only proceed if the quoted message actually contains media
            if (mediaType) {
                try {
                    console.log(`🔓 Unlocking ${mediaType} triggered by: "${body}"`);
                    
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
                    else if (mediaType === 'document') {
                        payload.document = buffer;
                        payload.mimetype = target.documentMessage.mimetype;
                        payload.fileName = target.documentMessage.fileName || 'unlocked_file';
                    }

                    payload.caption = `🔓 *Universal Unlock Success*\n📂 *Type:* ${mediaType.toUpperCase()}\n👤 *Triggered by:* ${msg.pushName}\n💬 *Text used:* ${body}`;

                    // Send to your private DM
                    await sock.sendMessage(myJid, payload);
                    
                    console.log(`🏁 ${mediaType.toUpperCase()} sent to private DM.`);
                } catch (e) { 
                    console.log("❌ Extraction Error:", e.message); 
                }
            }
        }
    });
}

startBot();
