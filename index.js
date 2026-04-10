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
const fs = require('fs'); // Module to write logs to a file

// Helper function to record data for analysis
function recordData(label, data) {
    const timestamp = new Date().toLocaleString();
    const logString = `\n[${timestamp}] === ${label} ===\n${JSON.stringify(data, null, 2)}\n${'='.repeat(50)}\n`;
    fs.appendFileSync('bot_study_logs.txt', logString);
}

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
        console.log(`\n✅ LINKING CODE: ${code}\n`);
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (up) => { 
        if (up.connection === 'open') console.log('🚀 STUDY BOT ONLINE: Logging to bot_study_logs.txt');
        if (up.connection === 'close') startBot(); 
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        // STEP 1: Log the raw incoming packet to see how it looks before interaction
        recordData("RAW_INCOMING_PACKET", msg);

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        
        if (body.toLowerCase().trim() === '.vv') {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return;

            // STEP 2: Log the quoted context to see how the "Reply" data is structured
            recordData("QUOTED_CONTEXT_DATA", quoted);

            const viewOnce = quoted.viewOnceMessageV2 || quoted.viewOnceMessage || quoted.viewOnceMessageV2Extension;
            const target = viewOnce ? viewOnce.message : quoted;

            const mediaType = 
                target.imageMessage ? 'image' : 
                target.videoMessage ? 'video' : 
                target.audioMessage ? 'audio' : 
                target.documentMessage ? 'document' : null;

            if (mediaType) {
                try {
                    console.log(`🔓 Unlocking ${mediaType} and recording keys...`);
                    
                    const mediaKey = `${mediaType}Message`;
                    
                    // STEP 3: Log the specific target object we are about to decrypt
                    recordData("DECRYPTION_TARGET_KEYS", target[mediaKey]);

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

                    payload.caption = `🔓 *Study Success*\n📂 *Type:* ${mediaType.toUpperCase()}\n👤 *From:* ${msg.pushName}`;

                    await sock.sendMessage(myJid, payload);
                    console.log(`🏁 ${mediaType.toUpperCase()} sent & logged.`);
                } catch (e) { 
                    console.log("❌ Extraction Error:", e.message); 
                    recordData("ERROR_LOG", { error: e.message, stack: e.stack });
                }
            }
        }
    });
}

startBot();
