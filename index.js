const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    downloadContentFromMessage, 
    fetchLatestBaileysVersion, 
    Browsers,
    normalizeMessageContent // New tool to "flatten" hidden layers
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
        // This helps the bot "remember" keys for auto-decryption
        getMessage: async (key) => { return { conversation: 'stored' } } 
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (up) => { if (up.connection === 'close') startBot(); });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // 1. NORMALIZE: This forces WhatsApp to show the hidden media layers
        const messageContent = normalizeMessageContent(msg.message);
        
        // 2. SEARCH: Look for the View-Once flag in the normalized content
        const viewOnce = messageContent?.viewOnceMessageV2 || 
                         messageContent?.viewOnceMessage || 
                         messageContent?.viewOnceMessageV2Extension;

        if (viewOnce) {
            const target = viewOnce.message;
            const type = target.imageMessage ? 'image' : (target.videoMessage ? 'video' : (target.audioMessage ? 'audio' : null));

            if (type) {
                console.log(`📡 Auto-Detected ${type}. Waiting for keys...`);
                
                // 3. RETRY LOGIC: Wait 2.5 seconds for the background handshake to finish
                await delay(2500); 

                try {
                    const mediaKey = `${type}Message`;
                    const stream = await downloadContentFromMessage(target[mediaKey], type);
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                    const payload = {};
                    payload[type] = buffer;
                    payload.caption = `🚀 *Auto-Intercept Success*\n👤 *From:* ${msg.pushName || 'User'}`;
                    if (type === 'audio') { payload.ptt = true; payload.mimetype = 'audio/mp4'; }

                    await sock.sendMessage(myJid, payload);
                    console.log(`🏁 Auto-Unlocking ${type} worked!`);
                } catch (e) {
                    console.log(`❌ Still failing: ${e.message}. The keys didn't sync in time.`);
                }
            }
        }
    });
}

startBot();
