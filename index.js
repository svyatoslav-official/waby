const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    downloadContentFromMessage, 
    fetchLatestBaileysVersion, 
    Browsers,
    extractMessageContent // Deep-unwrapper
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

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => { if (u.connection === 'close') startBot(); });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // 1. DEEP UNWRAP: Use the library's official extractor to find hidden View-Onces
        const fullContent = extractMessageContent(msg.message);
        
        // 2. CHECK: Look for the View-Once flag in all possible 2026 locations
        const isViewOnce = 
            fullContent?.viewOnceMessageV2 || 
            fullContent?.viewOnceMessageV2Extension || 
            fullContent?.viewOnceMessage ||
            msg.message?.viewOnceMessageV2; // Backup check

        if (isViewOnce) {
            console.log("🕵️ View-Once Detected. Syncing keys...");
            
            // 3. THE MAGIC WAIT: Give the server 3 seconds to push the decryption keys
            await delay(3000); 

            // Re-extract content after the wait to ensure keys are populated
            const target = isViewOnce.message || isViewOnce;
            const type = target.imageMessage ? 'image' : (target.videoMessage ? 'video' : (target.audioMessage ? 'audio' : null));

            if (type) {
                try {
                    const mediaKey = `${type}Message`;
                    const stream = await downloadContentFromMessage(target[mediaKey], type);
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                    const payload = {};
                    payload[type] = buffer;
                    payload.caption = `🚀 *Auto-Intercept Success*\n👤 *From:* ${msg.pushName || 'User'}`;
                    
                    if (type === 'audio') { 
                        payload.ptt = true; 
                        payload.mimetype = 'audio/mp4'; 
                    }

                    await sock.sendMessage(myJid, payload);
                    console.log(`✅ Auto-forwarded ${type} to your DM.`);
                } catch (e) {
                    console.log(`⚠️ Auto-sync failed: ${e.message}. The keys are still locked.`);
                    console.log("💡 Tip: If Auto fails, the '.vv' command is your backup!");
                }
            }
        }

        // KEEP YOUR WORKING .VV COMMAND AS A BACKUP
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (body.toLowerCase().trim() === '.vv') {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return;
            const qContent = extractMessageContent(quoted);
            const qTarget = qContent?.viewOnceMessageV2?.message || qContent?.viewOnceMessage?.message || qContent;
            // ... (rest of your existing .vv logic)
        }
    });
}

startBot();
