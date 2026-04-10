const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    downloadContentFromMessage, 
    fetchLatestBaileysVersion, 
    Browsers,
    extractMessageContent,
    getContentType
} = require('@whiskeysockets/baileys');
const pino = require('pino');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        // Pro Tip: Adding a store-like getter helps Baileys resolve media keys
        getMessage: async (key) => { return { conversation: 'syncing' } }
    });

    // --- 🔑 STABLE PAIRING CODE GENERATOR ---
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        console.log("🕒 Waiting for server to stabilize...");
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;
            if (qr || connection === 'connecting') {
                await delay(10000); // 10s wait is the "sweet spot" for 2026 servers
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n✅ YOUR PAIRING CODE: ${code}\n`);
                } catch (e) { console.log("❌ Pairing limit hit. Try again in 20 mins."); }
            }
        });
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (up) => { 
        if (up.connection === 'open') console.log('🚀 DEEP-SCAN ONLINE');
        if (up.connection === 'close') startBot(); 
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // --- 🕵️ THE "DEEP SCAN" LOGIC ---
        // Instead of guessing where the View-Once is, we scan the whole object
        const findViewOnce = (obj) => {
            if (!obj) return null;
            // Check for any known View-Once wrappers
            if (obj.viewOnceMessageV2 || obj.viewOnceMessage || obj.viewOnceMessageV2Extension) {
                return obj.viewOnceMessageV2?.message || obj.viewOnceMessage?.message || obj.viewOnceMessageV2Extension?.message;
            }
            // If it's an object, look deeper into every key (Recursion)
            if (typeof obj === 'object') {
                for (let key in obj) {
                    let result = findViewOnce(obj[key]);
                    if (result) return result;
                }
            }
            return null;
        };

        const viewOnceContent = findViewOnce(msg.message);

        // --- 🔓 TRIGGER: AUTO OR MANUAL ---
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        
        if (viewOnceContent || body.toLowerCase().trim() === '.vv') {
            let target;
            
            // If manual (.vv), find the quoted media
            if (body.toLowerCase().trim() === '.vv') {
                const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                target = findViewOnce(quoted) || extractMessageContent(quoted);
            } else {
                // If auto, use the detected viewOnceContent
                target = viewOnceContent;
            }

            if (target) {
                // Identify media type dynamically
                const type = getContentType(target);
                const mediaType = type?.replace('Message', '');
                
                if (['image', 'video', 'audio'].includes(mediaType)) {
                    try {
                        console.log(`📡 Extracting ${mediaType} from ${msg.pushName}...`);
                        
                        // Wait for sync (The most important step)
                        await delay(2000); 

                        const stream = await downloadContentFromMessage(target[type], mediaType);
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                        const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                        const payload = {};
                        payload[mediaType] = buffer;
                        payload.caption = `🚀 *Deep-Scan Success*\n👤 *From:* ${msg.pushName}\n📂 *Type:* ${mediaType.toUpperCase()}`;
                        
                        if (mediaType === 'audio') { 
                            payload.ptt = true; 
                            payload.mimetype = 'audio/mp4'; 
                        }

                        await sock.sendMessage(myJid, payload);
                        console.log(`🏁 Forwarded to DM.`);
                    } catch (e) {
                        console.log(`❌ Extraction Failed: ${e.message}`);
                    }
                }
            }
        }
    });
}

startBot();
