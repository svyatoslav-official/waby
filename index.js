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
    // 1. Setup Auth and Versioning
    // IMPORTANT: If you keep getting 'Couldn't link', delete the 'auth_session' folder and restart.
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        // Optimized Browser Identity for Pairing Stability
        browser: ["Ubuntu", "Chrome", "20.0.04"], 
        syncFullHistory: false, // Speeds up the bot significantly
        printQRInTerminal: false 
    });

    // 2. Pairing Code Logic
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        console.log(`🕒 Initializing handshake for ${phoneNumber}...`);
        
        // Reduced delay to 3 seconds to prevent session timeout during linking
        await delay(3000); 
        
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(`\n✅ YOUR LINKING CODE: ${code}\n`);
        } catch (err) {
            console.error("❌ Pairing Code Error: Check if the number is correct or delete auth_session folder.");
        }
    }

    // 3. Connection Update Handler (Smart Reconnect)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('🚀 BOT ONLINE: Universal Media Unlocker Ready');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) 
                ? lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut 
                : true;
            
            console.log('⚠️ Connection lost. Reconnecting:', shouldReconnect);
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // 4. Message Upsert Handler (The "Unlocker" Logic)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        
        // REGEX: Matches any single letter command (.a, .B, .z, etc.) OR the original .vv
        const isAlphabetCmd = /^\.[a-zA-Z]$/.test(body.trim());
        const isDoubleV = body.toLowerCase().trim() === '.vv';

        if (isAlphabetCmd || isDoubleV) {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return;

            // Handle View-Once layers (Standard and Extension types)
            const viewOnce = quoted.viewOnceMessageV2 || quoted.viewOnceMessage || quoted.viewOnceMessageV2Extension;
            const target = viewOnce ? viewOnce.message : quoted;

            // Identify Media Type
            const mediaType = 
                target.imageMessage ? 'image' : 
                target.videoMessage ? 'video' : 
                target.audioMessage ? 'audio' : 
                target.documentMessage ? 'document' : null;

            if (mediaType) {
                try {
                    const usedCmd = body.trim();
                    console.log(`🔓 Unlocking ${mediaType} via [${usedCmd}]...`);
                    
                    const mediaKey = `${mediaType}Message`;
                    const stream = await downloadContentFromMessage(target[mediaKey], mediaType);
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { 
                        buffer = Buffer.concat([buffer, chunk]); 
                    }

                    const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                    const payload = {};

                    // Construct specific payload based on detected media
                    if (mediaType === 'image') {
                        payload.image = buffer;
                    } else if (mediaType === 'video') {
                        payload.video = buffer;
                    } else if (mediaType === 'audio') {
                        payload.audio = buffer;
                        payload.mimetype = 'audio/mp4';
                        payload.ptt = true; // Sends as a voice note
                    } else if (mediaType === 'document') {
                        payload.document = buffer;
                        payload.mimetype = target.documentMessage.mimetype;
                        payload.fileName = target.documentMessage.fileName || 'unlocked_file';
                    }

                    payload.caption = `🔓 *Universal Unlock Success*\n📂 *Type:* ${mediaType.toUpperCase()}\n⌨️ *Command:* ${usedCmd}\n👤 *From:* ${msg.pushName || 'User'}`;

                    // Forward unlocked media to your private DM
                    await sock.sendMessage(myJid, payload);
                    console.log(`🏁 Success! ${mediaType.toUpperCase()} sent to private DM.`);
                } catch (e) { 
                    console.log("❌ Extraction Error:", e.message); 
                }
            } else {
                console.log("ℹ️ Quoted message contains no extractable media.");
            }
        }
    });
}

// Boot the Bot
startBot();
