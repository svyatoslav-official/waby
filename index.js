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
const { Boom } = require('@hapi/boom');

async function startBot() {
    // Authentication and Versioning
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        // Practically better: Mimics a stable Linux Firefox desktop environment
        browser: Browsers.ubuntu('Firefox'),
        syncFullHistory: false, // Optimizes performance by not loading old chats
        printQRInTerminal: true
    });

    // Pairing Code logic (if not already logged in)
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        console.log(`🕒 Waiting for handshake...`);
        await delay(6000); 
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\n✅ LINKING CODE: ${code}\n`);
    }

    // Connection Handler
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('🚀 BOT ONLINE: Universal Media Unlocker Ready');
        } else if (connection === 'close') {
            // Smart Reconnect: Only reconnects if it wasn't a manual logout
            const shouldReconnect = (lastDisconnect.error instanceof Boom) 
                ? lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut 
                : true;
            
            console.log('⚠️ Connection lost. Reconnecting:', shouldReconnect);
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Message Handler
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        
        // Matches any single letter command (.a, .B, etc.) or original .vv
        const isAlphabetCmd = /^\.[a-zA-Z]$/.test(body.trim());
        const isDoubleV = body.toLowerCase().trim() === '.vv';

        if (isAlphabetCmd || isDoubleV) {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return;

            // Unwrapping View-Once layers
            const viewOnce = quoted.viewOnceMessageV2 || quoted.viewOnceMessage || quoted.viewOnceMessageV2Extension;
            const target = viewOnce ? viewOnce.message : quoted;

            // Detection logic for all media types
            const mediaType = 
                target.imageMessage ? 'image' : 
                target.videoMessage ? 'video' : 
                target.audioMessage ? 'audio' : 
                target.documentMessage ? 'document' : null;

            if (mediaType) {
                try {
                    const usedCmd = body.trim();
                    console.log(`🔓 Unlocking ${mediaType} via ${usedCmd}...`);
                    
                    const mediaKey = `${mediaType}Message`;
                    const stream = await downloadContentFromMessage(target[mediaKey], mediaType);
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { 
                        buffer = Buffer.concat([buffer, chunk]); 
                    }

                    const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                    const payload = {};

                    // Prepare payload based on media type
                    if (mediaType === 'image') {
                        payload.image = buffer;
                    } else if (mediaType === 'video') {
                        payload.video = buffer;
                    } else if (mediaType === 'audio') {
                        payload.audio = buffer;
                        payload.mimetype = 'audio/mp4';
                        payload.ptt = true; 
                    } else if (mediaType === 'document') {
                        payload.document = buffer;
                        payload.mimetype = target.documentMessage.mimetype;
                        payload.fileName = target.documentMessage.fileName || 'unlocked_file';
                    }

                    payload.caption = `🔓 *Universal Unlock Success*\n📂 *Type:* ${mediaType.toUpperCase()}\n⌨️ *Command:* ${usedCmd}\n👤 *From:* ${msg.pushName}`;

                    // Send to private DM
                    await sock.sendMessage(myJid, payload);
                    console.log(`🏁 Sent to private DM.`);
                } catch (e) { 
                    console.log("❌ Extraction Error:", e.message); 
                }
            }
        }
    });
}

// Start the process
startBot();
