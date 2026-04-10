const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    downloadContentFromMessage, 
    fetchLatestBaileysVersion, 
    Browsers,
    normalizeMessageContent 
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
        browser: Browsers.ubuntu('Chrome'), // Fixed browser for 2026 stability
        syncFullHistory: false,
        getMessage: async (key) => { return { conversation: 'syncing' } }
    });

    // 🔑 THE PAIRING CODE SOLICITOR (Improved)
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94723748044"; 
        sock.ev.on('connection.update', async (up) => {
            if (up.qr || up.connection === 'connecting') {
                await delay(10000); 
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n✅ LINK CODE: ${code}\n`);
                } catch (e) { console.log("❌ Retry in 30s..."); }
            }
        });
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => { if (u.connection === 'open') console.log('🚀 SYSTEM ONLINE'); if (u.connection === 'close') startBot(); });

    // 🕵️ THE "LOG-BASED" AUTO-INTERCEPTOR
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        // 1. NORMALIZE & SCAN (Fixes the "Internal Flag" problem from your logs)
        const content = normalizeMessageContent(msg.message);
        const rawJson = JSON.stringify(content);
        
        // Look for the View-Once flag anywhere in the data
        const isViewOnce = rawJson.includes('"viewOnce":true') || rawJson.includes('viewOnceMessage');

        if (isViewOnce) {
            console.log("🎯 TARGET DETECTED: Starting Deep-Sync Loop...");
            
            // 2. THE SYNC LOOP (Fixes the "Missing Key" problem)
            for (let i = 0; i < 5; i++) {
                try {
                    console.log(`📡 Syncing Decryption Keys (Attempt ${i+1}/5)...`);
                    
                    // Find the media object inside the message
                    const target = content.viewOnceMessageV2?.message || 
                                   content.viewOnceMessage?.message || 
                                   content.imageMessage || 
                                   content.videoMessage || 
                                   content.audioMessage;

                    const type = target?.imageMessage ? 'image' : (target?.videoMessage ? 'video' : (target?.audioMessage ? 'audio' : null));

                    if (type) {
                        const mediaData = target[`${type}Message`] || target;
                        
                        // Download as stream (More stable for 2026)
                        const stream = await downloadContentFromMessage(mediaData, type);
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                        if (buffer.length > 100) { 
                            const myJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
                            await sock.sendMessage(myJid, { 
                                [type]: buffer, 
                                caption: `🚀 *Auto-Intercept Success*\n👤 *From:* ${msg.pushName}\n📂 *Type:* ${type.toUpperCase()}` 
                            });
                            console.log(`🏁 SUCCESS: Decrypted and forwarded.`);
                            return; // Stop the loop on success
                        }
                    }
                } catch (e) { /* Wait for next sync attempt */ }
                await delay(2500); // Wait 2.5 seconds between tries for keys to arrive
            }
            console.log("❌ FAILED: The server never sent the second key (Message Secret).");
        }
    });
}

startBot();
