const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const readline = require('readline');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config/config');
const AIHandler = require('../handlers/aihandler');
const StickerMaker = require('../handlers/stickermaker');
const QuoteGenerator = require('../handlers/quote');
const NewAIHandler = require('../handlers/newaihandler');
const axios = require('axios');
const sharp = require('sharp');

class WhatsAppClient {
    constructor() {
        this.sock = null;
        this.userStates = new Map();

        // =================== TAMBAHAN UNTUK TRACKING DOWNLOAD FILES ===================
        this.downloadStats = {
            totalFiles: 0,
            totalSize: 0, // dalam bytes
            filesByType: {
                video: 0,
                audio: 0,
                image: 0,
                sticker: 0
            },
            platformStats: {
                tiktok: { count: 0, size: 0 },
                instagram: { count: 0, size: 0 },
                facebook: { count: 0, size: 0 },
                youtube: { count: 0, size: 0 },
                sticker: { count: 0, size: 0 }
            }
        };

        this.pinterestStates = new Map();
    
        // Cleanup Pinterest states every 30 minutes
        setInterval(() => {
            this.cleanupPinterestStates();
        }, 30 * 60 * 1000);
        
        this.newAIHandler = new NewAIHandler();
        this.stickerMaker = new StickerMaker();
        this.quoteGenerator = new QuoteGenerator();

        // ANTI-SPAM SYSTEM
        this.messageQueue = new Map();
        this.userLastMessage = new Map();
        this.userWelcomeCount = new Map();
        this.processingUsers = new Set();

        // ADD THIS: Track when bot starts/connects
        this.botStartTime = Date.now();
        this.isFirstConnection = true;

         // ADD THIS: Bot control system
        this.botStatus = true; // Bot aktif secara default
        this.adminNumbers = process.env.ADMIN_NUMBERS ? process.env.ADMIN_NUMBERS.split(',') : [];

        // =================== TAMBAHAN UNTUK STATS BOT ===================
        this.botStats = {
            startTime: Date.now(), // Waktu bot pertama kali dijalankan
            totalMessages: 0,
            commandsProcessed: 0,
            apiSuccess: 0,
            apiErrors: 0,
            mediaProcessed: 0,
            stickersCreated: 0,
            videoDownloads: 0,
            audioDownloads: 0,
            aiQueries: 0,
            errors: 0,
            lastReset: Date.now(),
            commandStats: {
                tiktok: 0,
                instagram: 0,
                facebook: 0,
                youtube: 0,
                sticker: 0,
                ai: 0,
                quote: 0,
                pantun: 0,
                motivasi: 0,
                brat: 0,
                help: 0,
                info: 0,
                ibot: 0
            }
        };

        this.setupCleanupInterval();
    }


    getRandomDelay() {
        return Math.floor(Math.random() * 1000) + 1000;
    }

    isAdmin(sender) {
    // Ekstrak nomor dari sender (format: 6281234567890@s.whatsapp.net)
    const phoneNumber = sender.replace('@s.whatsapp.net', '').replace('@g.us', '');
    return this.adminNumbers.includes(phoneNumber);
}

isBotActive() {
    return this.botStatus;
}

setBotStatus(status) {
    this.botStatus = status;
    console.log(`🤖 Bot status changed to: ${status ? 'ACTIVE' : 'INACTIVE'}`);
}

    async getPhoneNumber() {
        // Coba ambil dari environment variable terlebih dahulu
        let phoneNumber = process.env.PHONE_NUMBER || process.env.WHATSAPP_NUMBER;

        if (phoneNumber) {
            // Validasi dan format nomor dari env
            phoneNumber = phoneNumber.trim();

            // Hapus karakter non-digit
            phoneNumber = phoneNumber.replace(/\D/g, '');

            // Pastikan dimulai dengan 62
            if (!phoneNumber.startsWith('62')) {
                if (phoneNumber.startsWith('0')) {
                    phoneNumber = '62' + phoneNumber.substring(1);
                } else {
                    phoneNumber = '62' + phoneNumber;
                }
            }

            console.log(`📱 Menggunakan nomor dari environment: ${phoneNumber}`);
            return phoneNumber;
        }

        // Fallback ke input manual jika tidak ada di env
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('📱 Masukkan nomor WhatsApp (format: 62812345678): ', (answer) => {
                rl.close();
                // Validasi dan format nomor
                let phoneNumber = answer.trim();

                // Hapus karakter non-digit
                phoneNumber = phoneNumber.replace(/\D/g, '');

                // Pastikan dimulai dengan 62
                if (!phoneNumber.startsWith('62')) {
                    if (phoneNumber.startsWith('0')) {
                        phoneNumber = '62' + phoneNumber.substring(1);
                    } else {
                        phoneNumber = '62' + phoneNumber;
                    }
                }

                resolve(phoneNumber);
            });
        });
    }

    updateDownloadStats(platform, fileType, fileSize = 0) {
        this.downloadStats.totalFiles++;
        this.downloadStats.totalSize += fileSize;

        // Update stats berdasarkan tipe file
        if (this.downloadStats.filesByType[fileType]) {
            this.downloadStats.filesByType[fileType]++;
        }

        // Update stats berdasarkan platform
        if (this.downloadStats.platformStats[platform]) {
            this.downloadStats.platformStats[platform].count++;
            this.downloadStats.platformStats[platform].size += fileSize;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ANTI-SPAM: Cek apakah pesan duplicate
    isDuplicateMessage(sender, messageKey, text) {
        const userMessages = this.userLastMessage.get(sender) || [];
        const currentTime = Date.now();

        const recentMessages = userMessages.filter(msg => currentTime - msg.timestamp < 10000);

        const isDuplicate = recentMessages.some(msg =>
            msg.key === messageKey ||
            (msg.text === text && currentTime - msg.timestamp < 3000)
        );

        if (!isDuplicate) {
            recentMessages.push({
                key: messageKey,
                text: text,
                timestamp: currentTime
            });

            this.userLastMessage.set(sender, recentMessages.slice(-5));
        }

        return isDuplicate;
    }

    isUserBeingProcessed(sender) {
        return this.processingUsers.has(sender);
    }

    setUserProcessing(sender, processing = true) {
        if (processing) {
            this.processingUsers.add(sender);
        } else {
            this.processingUsers.delete(sender);
        }
    }

    async initialize() {
    try {
        await fs.ensureDir(config.folders.sessions);
        const { state, saveCreds } = await useMultiFileAuthState(config.folders.sessions);
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

        this.sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            defaultQueryTimeoutMs: 0,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
        });

        this.setupReactionMethod();
        this.setupEventHandlers(saveCreds);
        return this.sock;
    } catch (error) {
        console.error('Error initializing WhatsApp client:', error);
        throw error;
    }
}

setupReactionMethod() {
    if (this.sock) {
        this.sock.react = async (message, emote) => {
            const reactionMessage = {
                react: {
                    text: emote,
                    key: message.key
                }
            };
            return await this.sock.sendMessage(message.key.remoteJid, reactionMessage);
        };
    }
}

// Enhanced method untuk handling complete command processing flow
async processCommand(message, command, commandHandler) {
    const sender = message.key.remoteJid;
    let processingMessage = null;

    try {
        // Step 1: React dengan emoji processing
        await this.sock.react(message, '⏳');

        // Step 2: Reply dengan pesan processing
        processingMessage = await this.replyWithProcessing(message, command);

        // Step 3: Jalankan command handler
        const result = await commandHandler();

        // Step 4: Cek apakah result adalah error message
        const isErrorResult = typeof result === 'string' && result.startsWith('❌');

        if (isErrorResult) {
            // Jika result adalah error message, edit dengan error dan ubah reaction ke error
            if (processingMessage) {
                await this.editMessage(sender, processingMessage.key, result);
            }
            await this.sock.react(message, '❌');
        } else {
            // Jika sukses, ubah reaction ke success dan edit dengan success message
            await this.sock.react(message, '✅');
            
            if (processingMessage) {
                const successMessage = this.getSuccessMessage(command, result);
                await this.editMessage(sender, processingMessage.key, successMessage);
            }

            // Step 6: Untuk command yang tidak perlu pesan tambahan (sudah ditangani di handler)
            const skipAdditionalMessage = [
                'tiktok', '!t', '!fb', 'sticker', '!sticker', '!s', '!ig'
            ];
            
            const shouldSkipMessage = skipAdditionalMessage.some(cmd => 
                command.includes(cmd) || command.startsWith(cmd)
            );

            if (!shouldSkipMessage && result && typeof result === 'string') {
                await this.sock.sendMessage(sender, { text: result });
            }
        }

        return result;

    } catch (error) {
        console.error('Error processing command:', error);
        
        // Jika ada error, edit pesan dengan error message
        if (processingMessage) {
            const errorMessage = `❌ ${error.message || 'Terjadi kesalahan saat memproses perintah'}`;
            await this.editMessage(sender, processingMessage.key, errorMessage);
        }
        
        // Ubah reaction ke error
        await this.sock.react(message, '❌');
        
        // Untuk sticker, tidak perlu throw ulang karena sudah ditangani
        if (command === 'sticker') {
            return;
        }
        
        throw error;
    }
}
// Method baru untuk mengirim hasil TikTok sebagai pesan terpisah
getSuccessMessage(command, result) {
    const successMessages = {
        '!tiktok': '✅ Video TikTok berhasil diunduh!',
        '!t': '✅ Video TikTok berhasil diunduh!',
        'sticker': '✅ Sticker berhasil dibuat!',
        '!sticker': '✅ Sticker berhasil dibuat!',
        '!s': '✅ Sticker berhasil dibuat!',
        '!fb': '✅ Video Facebook berhasil diunduh!',
        'default': '✅ Perintah berhasil diproses!'
    };
    
    const commandKey = command.toLowerCase();
    return successMessages[commandKey] || successMessages['default'];
}


// Method untuk reply dengan pesan processing
async replyWithProcessing(message, command) {
    const processingMessages = {
        '!tiktok': '📱 Sedang mengunduh video TikTok...',
        '!t': '📱 Sedang mengunduh video TikTok...',
        'sticker': '🎨 Sedang membuat sticker...',
        '!sticker': '🎨 Sedang membuat sticker...',
        '!s': '🎨 Sedang membuat sticker...',
        '!fb': '📘 Sedang mengunduh video Facebook...',
        'default': `⏰ Sedang memproses perintah ${command}...`
    };
    
    const commandKey = command.toLowerCase();
    const processingText = processingMessages[commandKey] || processingMessages['default'];
    
    const sentMessage = await this.sock.sendMessage(message.key.remoteJid, {
        text: processingText
    }, {
        quoted: message // Reply ke pesan asli
    });

    return sentMessage;
}

async sendProcessingMessage(sender, command) {
    const processingText = `⏰ Sedang memproses perintah ${command}...`;
    const sentMessage = await this.sock.sendMessage(sender, {
        text: processingText
    });
    return sentMessage;
}

// Enhanced edit message method
async editMessage(sender, messageKey, newText) {
    try {
        await this.sock.sendMessage(sender, {
            text: newText,
            edit: messageKey
        });
        console.log('✅ Message edited successfully');
    } catch (error) {
        console.log('⚠️ Edit message tidak didukung, kirim pesan baru');
        await this.sock.sendMessage(sender, {
            text: newText
        });
    }
}

// Method untuk reply dengan processing message
async replyWithProcessing(message, command) {
    const processingMessages = {
        'sticker': '🎨 Sedang membuat sticker...',
        'tiktok': '📱 Sedang mengunduh video TikTok...',
        'facebook': '📘 Sedang mengunduh video Facebook...',
        'default': `⏰ Sedang memproses perintah ${command}...`
    };
    
    const commandKey = command.toLowerCase().replace('!', '');
    const processingText = processingMessages[commandKey] || processingMessages['default'];
    
    const sentMessage = await this.sock.sendMessage(message.key.remoteJid, {
        text: processingText
    }, {
        quoted: message // Reply ke pesan asli
    });

    return sentMessage;
}

// Method untuk quick processing dengan auto reaction management
async quickProcess(message, command, resultText) {
    const sender = message.key.remoteJid;
    
    try {
        // React processing
        await this.sock.react(message, '⏳');
        
        // Reply dengan hasil langsung
        await this.sock.sendMessage(sender, {
            text: resultText
        }, {
            quoted: message
        });
        
        // React success
        await this.sock.react(message, '✅');
        
    } catch (error) {
        console.error('Error in quick process:', error);
        await this.sock.react(message, '❌');
    }
}
async batchProcess(messages, commandName, batchHandler) {
    const results = [];
    
    for (const message of messages) {
        await this.processCommand(message, commandName, async () => {
            const result = await batchHandler(message);
            results.push(result);
            return result;
        });
    }
    
    return results;
}

    setupEventHandlers(saveCreds) {
        if (!this.sock) {
            console.error('Socket belum diinisialisasi!');
            return;
        }

        this.sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                // Jika masih ada QR code, request pairing code
                console.log('\n🔄 Meminta pairing code...');
                try {
                    const phoneNumber = await this.getPhoneNumber();
                    console.log(`📱 Mengirim pairing code ke: ${phoneNumber}`);

                    const code = await this.sock.requestPairingCode(phoneNumber);
                    console.log(`\n🔑 PAIRING CODE: ${code}`);
                    console.log('📲 Masukkan code ini di WhatsApp > Linked Devices > Link a Device > Link with phone number');
                    console.log('⏰ Code akan expired dalam beberapa menit\n');
                } catch (error) {
                    console.error('❌ Error requesting pairing code:', error);
                    console.log('🔄 Mencoba lagi...');
                }
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);

                if (shouldReconnect) {
                    this.initialize();
                }
            } else if (connection === 'open') {
                console.log('✅ WhatsApp Bot terhubung dengan pairing code!');
                console.log('🤖 Bot siap menerima pesan dengan command system...\n');
                // UPDATE: Set bot connection time
                this.botStartTime = Date.now();
            }
            if (this.isFirstConnection) {
                    console.log('🔄 Bot connected for first time, will ignore old messages');
                    this.isFirstConnection = false;
                }
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('messages.upsert', async (m) => {
            try {
                await this.handleMessage(m);
            } catch (error) {
                console.error('Error handling message:', error);
            }
        });
    }

     isOldMessage(messageTimestamp) {
        // Convert timestamp to milliseconds if needed
        const msgTime = typeof messageTimestamp === 'number' ? 
            (messageTimestamp.toString().length === 10 ? messageTimestamp * 1000 : messageTimestamp) : 
            messageTimestamp;
            
        // Ignore messages older than bot start time (with 30 second buffer)
        const bufferTime = 30 * 1000; // 30 seconds
        return msgTime < (this.botStartTime - bufferTime);
    }
    

    async handleMessage(m) {
        const messages = m.messages;

        if (!messages || messages.length === 0) return;

        for (const message of messages) {
            if (message.key.fromMe) continue;
            const messageTimestamp = message.messageTimestamp;
            
            if (this.isOldMessage(messageTimestamp)) {
                console.log(`🕒 Ignoring old message from ${message.key.remoteJid} (timestamp: ${new Date(messageTimestamp * 1000).toLocaleString()})`);
                continue;
            }

            // FILTER REACTION - TAMBAHKAN INI DI AWAL
            if (message.message?.reactionMessage) {
                console.log(`🚫 Reaction message diabaikan: ${message.key.remoteJid}`);
                continue;
            }

            // UPDATE STATS - TAMBAHKAN INI
            this.updateBotStats('message');

            const sender = message.key.remoteJid;
            const messageKey = message.key.id;
            const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';

            // Ambil caption dari gambar/video jika ada
            const imageCaption = message.message?.imageMessage?.caption || '';
            const videoCaption = message.message?.videoMessage?.caption || '';
            const caption = imageCaption || videoCaption || '';

            // PENTING: Cek bot status sebelum validasi lainnya (kecuali untuk admin)
            if (!this.isBotActive() && !this.isAdmin(sender)) {
                console.log(`🔴 Bot inactive, ignoring message from ${sender}`);
                continue; // Bot tidak merespons jika tidak aktif dan bukan dari admin
            }

            // =================== VALIDASI GRUP/CHAT PRIBADI ===================

            // Deteksi apakah pesan dari grup atau chat pribadi
            const isGroupChat = sender.endsWith('@g.us');
            const isPrivateChat = sender.endsWith('@s.whatsapp.net');

            // =================== FILTER PRIVATE CHAT ===================
            if (isPrivateChat) {
                // Ekstrak nomor dari sender (format: 62812345678@s.whatsapp.net)
                const phoneNumber = sender.split('@')[0];

                // Filter 1: Hanya terima nomor Indonesia (+62)
                if (!phoneNumber.startsWith('62')) {
                    console.log(`🚫 Private chat dari luar Indonesia diabaikan: ${sender}`);
                    continue;
                }

                // Filter 2: Abaikan chat resmi WhatsApp (biasanya nomor pendek atau pola tertentu)
                const isOfficialWhatsApp =
                    phoneNumber === '0' ||                    // WhatsApp System
                    phoneNumber.startsWith('62000') ||        // Customer Service
                    phoneNumber.startsWith('62911') ||        // WhatsApp Business
                    phoneNumber.length < 10 ||                // Nomor terlalu pendek
                    phoneNumber.match(/^620{2,}/) ||          // Banyak angka 0 setelah 62
                    phoneNumber.match(/^62(1{3,}|2{3,}|3{3,}|4{3,}|5{3,}|6{3,}|7{3,}|8{3,}|9{3,})/); // Angka berulang

                if (isOfficialWhatsApp) {
                    console.log(`🚫 Chat resmi WhatsApp diabaikan: ${sender}`);
                    continue;
                }

                console.log(`✅ Private chat valid dari Indonesia: ${sender}`);
            }

            // Cek apakah pesan adalah command (dimulai dengan !)
            const isCommand = (text && text.trim().startsWith('!')) ||
                (caption && caption.trim().startsWith('!'));

            console.log(`📨 ${isGroupChat ? '👥 GROUP' : '👤 PRIVATE'} - ${sender}: ${text || caption} ${message.message?.imageMessage || message.message?.videoMessage ? '[Media]' : ''}`);

            // VALIDASI: Jika dari grup dan bukan command, skip
            if (isGroupChat && !isCommand) {
                console.log(`🚫 Pesan dari grup tanpa command, diabaikan: ${sender}`);
                continue;
            }

            // HANDLE NON-COMMAND DARI PRIVATE CHAT DI SINI LANGSUNG
            if (isPrivateChat && !isCommand) {
                console.log(`💬 Non-command dari private chat: ${sender}`);
                await this.sendMessage(sender,
                    "🤖 *Igimonsan Bot*\n\n" +
                    "Halo! Silahkan respon dengan perintah\n" +
                    "Ketik *!help*\n\n" +
                    "Contoh penggunaan : `!hitamkan (kirim gambar)`"
                );
                continue; // Skip ke pesan berikutnya, jangan panggil processMessage
            }

            // ANTI-SPAM: Cek duplicate message
            if (this.isDuplicateMessage(sender, messageKey, text || caption)) {
                console.log(`🚫 Duplicate message from ${sender}, skipping...`);
                continue;
            }

            // ANTI-SPAM: Cek apakah user sedang diproses
            if (this.isUserBeingProcessed(sender)) {
                console.log(`⏳ User ${sender} sedang diproses, skipping...`);
                continue;
            }

            // PRIORITAS PERTAMA: Cek gambar dengan caption command
            if (message.message?.imageMessage || message.message?.videoMessage) {
                const lowerCaption = caption.toLowerCase().trim();

                if (message.message?.imageMessage || message.message?.videoMessage) {
                    this.updateBotStats('media');
                }

                // Command: !tohitam
                if (lowerCaption.includes('!tohitam') || lowerCaption.includes('!hitamkan')) {
                    const tohitamCommand = require('../handlers/tohitam');
                    await tohitamCommand(this.sock, message);
                    continue;
                }

                // Command: !sticker dengan caption
                if (lowerCaption === '!sticker' || lowerCaption.startsWith('!s')) {
                    console.log(`🎨 Processing sticker from image with caption: ${caption}`);
                    // Tandai user sedang diproses
                    this.setUserProcessing(sender, true);

                    try {
                        // Gunakan processCommand untuk handling yang konsisten
                        await this.processCommand(message, 'sticker', async () => {
                            return await this.handleStickerCommand(sender, message);
                        });
                    } catch (error) {
                        console.error('Error processing sticker from caption:', error);
                        await this.sock.react(message, '❌');
                    } finally {
                        this.setUserProcessing(sender, false);
                    }
                    continue;
                }

            }

            // HANYA PROSES COMMAND DI processMessage
            if (isCommand) {
                const hasMedia = message.message?.imageMessage ||
                    message.message?.videoMessage ||
                    message.message?.stickerMessage ||
                    message.message?.documentMessage;

                // Tandai user sedang diproses
                this.setUserProcessing(sender, true);

                try {
                    await this.processMessage(sender, text, message, isGroupChat);
                } catch (error) {
                    console.error('Error processing message:', error);
                } finally {
                    this.setUserProcessing(sender, false);
                }
            }
        }
    }

    async handleBotControlCommand(sender, command) {
    // Cek apakah sender adalah admin
    if (!this.isAdmin(sender)) {
        await this.sendMessage(sender, "❌ Anda tidak memiliki akses untuk mengontrol bot!");
        console.log(`🚫 Unauthorized bot control attempt from: ${sender}`);
        return;
    }

    const parts = command.split(' ');
    if (parts.length !== 2) {
        await this.sendMessage(sender, 
            "❌ Format salah!\n\n" +
            "Cara penggunaan:\n" +
            "• `!bot on` - Mengaktifkan bot\n" +
            "• `!bot off` - Menonaktifkan bot\n" +
            "• `!bot status` - Cek status bot"
        );
        return;
    }

    const action = parts[1].toLowerCase();

    switch (action) {
        case 'on':
            if (this.isBotActive()) {
                await this.sendMessage(sender, "ℹ️ Bot sudah dalam keadaan aktif!");
            } else {
                this.setBotStatus(true);
                await this.sendMessage(sender, "✅ Bot berhasil diaktifkan!\n🤖 Bot sekarang akan merespons semua pesan.");
            }
            break;

        case 'off':
            if (!this.isBotActive()) {
                await this.sendMessage(sender, "ℹ️ Bot sudah dalam keadaan nonaktif!");
            } else {
                this.setBotStatus(false);
                await this.sendMessage(sender, "🔴 Bot berhasil dinonaktifkan!\n⚠️ Bot tidak akan merespons pesan kecuali dari admin.");
            }
            break;

        case 'status':
            const status = this.isBotActive() ? "🟢 AKTIF" : "🔴 NONAKTIF";
            const adminList = this.adminNumbers.length > 0 ? this.adminNumbers.join(', ') : 'Tidak ada admin terdaftar';
            
            await this.sendMessage(sender, 
                `🤖 *Status Bot*\n\n` +
                `Status: ${status}\n` +
                `Admin: ${adminList}\n` +
                `Waktu: ${new Date().toLocaleString('id-ID')}`
            );
            break;

        default:
            await this.sendMessage(sender, 
                "❌ Perintah tidak dikenali!\n\n" +
                "Perintah yang tersedia:\n" +
                "• `!bot on` - Aktifkan bot\n" +
                "• `!bot off` - Nonaktifkan bot\n" +
                "• `!bot status` - Cek status bot"
            );
            break;
    }
}

    async handleIBotCommand(sender) {
        try {
            const uptime = this.getUptime();
            const memoryUsage = process.memoryUsage();
            const activeUsers = this.processingUsers.size;
            const totalUsers = this.userStates.size;

            // Format uptime
            const uptimeString = `${uptime.days}d ${uptime.hours}h ${uptime.minutes}m ${uptime.seconds}s`;

            // Format memory usage
            const formatBytes = (bytes) => {
                return (bytes / 1024 / 1024).toFixed(2) + ' MB';
            };

            // Success rate
            const totalApi = this.botStats.apiSuccess + this.botStats.apiErrors;
            const successRate = totalApi > 0 ? ((this.botStats.apiSuccess / totalApi) * 100).toFixed(1) : '0.0';

            // Most used commands
            const sortedCommands = Object.entries(this.botStats.commandStats)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5);

            const commandsText = sortedCommands.map(([cmd, count]) => `• ${cmd}: ${count}`).join('\n');

            // Download statistics
            const downloadText = Object.entries(this.downloadStats.platformStats)
                .filter(([platform, stats]) => stats.count > 0)
                .map(([platform, stats]) => `• ${platform}: ${stats.count} files (${this.formatFileSize(stats.size)})`)
                .join('\n');

            // File type statistics
            const fileTypeText = Object.entries(this.downloadStats.filesByType)
                .filter(([type, count]) => count > 0)
                .map(([type, count]) => `• ${type}: ${count}`)
                .join('\n');

            const statsMessage =
                `📁 IGIMONSAN BOT - STATUS REALTIME\n│\n` +
                `├─ ⏰ Runtime\n` +
                `│  └─ Uptime: ${uptimeString}\n` +
                `│  └─ Started: ${new Date(this.botStats.startTime).toLocaleString('id-ID')}\n` +
                `│  └─ Last Reset: ${new Date(this.botStats.lastReset).toLocaleString('id-ID')}\n` +
                `│  └─ Version: 2.1.0\n│\n` +
                `├─ 📊 Message Statistics\n` +
                `│  ├─ Total Messages: ${this.botStats.totalMessages}\n` +
                `│  ├─ Commands Processed: ${this.botStats.commandsProcessed}\n` +
                `│  └─ Media Processed: ${this.botStats.mediaProcessed}\n│\n` +
                `├─ 🔌 API Performance\n` +
                `│  ├─ Successful: ${this.botStats.apiSuccess}\n` +
                `│  ├─ Failed: ${this.botStats.apiErrors}\n` +
                `│  └─ Success Rate: ${successRate}%\n│\n` +
                `├─ 📥 Download Statistics\n` +
                `│  ├─ Total Files: ${this.downloadStats.totalFiles}\n` +
                `│  ├─ Total Size: ${this.formatFileSize(this.downloadStats.totalSize)}\n` +
                `│  ├─ Platforms:\n` +
                `│  │  ${(downloadText || 'No downloads yet').split('\n').join('\n│  │  ')}\n` +
                `│  └─ File Types:\n` +
                `│     ${(fileTypeText || 'No files yet').split('\n').join('\n│     ')}\n│\n` +
                `├─ 🎯 Activity Summary\n` +
                `│  ├─ Stickers Created: ${this.botStats.stickersCreated}\n` +
                `│  ├─ Video Downloads: ${this.botStats.videoDownloads}\n` +
                `│  ├─ Audio Downloads: ${this.botStats.audioDownloads}\n` +
                `│  └─ AI Queries: ${this.botStats.aiQueries}\n│\n` +
                `├─ 👥 User Analytics\n` +
                `│  ├─ Total Users: ${totalUsers}\n` +
                `│  └─ Currently Active: ${activeUsers}\n│\n` +
                `├─ 🖥️ System Resources\n` +
                `│  ├─ Memory Used: ${formatBytes(memoryUsage.heapUsed)}\n` +
                `│  ├─ Memory Total: ${formatBytes(memoryUsage.heapTotal)}\n` +
                `│  └─ System Errors: ${this.botStats.errors}\n│\n` +
                `├─ 🏆 Top Commands\n` +
                `│  ${commandsText.split('\n').join('\n│  ')}\n│\n` +
                `└─ ✅ Status: Online & Healthy`

            await this.sendMessage(sender, statsMessage);
            this.updateCommandStats('ibot');

        } catch (error) {
            console.error('Error handling ibot command:', error);
            this.updateBotStats('error');
            await this.sendMessage(sender, '❌ Terjadi kesalahan saat mengambil info bot');
        }
    }

    async processMessage(sender, text, message, isGroupChat = false) {
        const lowerText = text.toLowerCase().trim();

        try {
            // =================== COMMAND SYSTEM ===================

            // UPDATE STATS UNTUK COMMAND - TAMBAHKAN INI
            if (lowerText.startsWith('!')) {
                this.updateBotStats('command');
            }

            if (lowerText.startsWith('!bot ')) {
            await this.handleBotControlCommand(sender, lowerText);
            return;
        }

        // =================== TAMBAHKAN COMMAND !ibot ===================
        if (lowerText === '!ibot') {
            await this.handleIBotCommand(sender);
            return;
        }

        if (lowerText.startsWith('!test')) {
            await this.processCommand(message, '!test', async () => {
                return await this.handleTestCommand(sender);
            });
            return;
        }

        // Command: !help atau !menu
        if (lowerText === '!help' || lowerText === '!menu') {
            await this.quickProcess(message, '!info', config.messages.menu);
            return;
        }
        if (lowerText.startsWith('!tiktok ') || lowerText.startsWith('!t ')) {
            const command = lowerText.startsWith('!tiktok ') ? '!tiktok ' : '!t ';
            const url = text.substring(command.length).trim();

            await this.processCommand(message, command.trim(), async () => {
                return await this.processTikTokDownload(sender, url);
            });
            return;
        }

        if (lowerText.startsWith('!pin ')) {
            const query = text.substring(5).trim();
            
            if (!query) {
                await this.quickProcess(message, '!pin', 
                    "❌ Format salah!\n\n" +
                    "Cara penggunaan: !pin [kata kunci]\n" +
                    "Contoh: !pin cats\n" +
                    "Contoh: !pin anime girl"
                );
                return;
            }

            await this.processCommand(message, '!pin', async () => {
                return await this.handlePinterestCommand(sender, query);
            });
            return;
        }

        // Command: !next (untuk Pinterest mode)
        if (lowerText === '!next') {
            await this.processCommand(message, '!next', async () => {
                return await this.handlePinterestNextCommand(sender);
            });
            return;
        }


        // Command: Quote
        if (lowerText === '!quote') {
            await this.processCommand(message, '!quote', async () => {
                return await this.handleQuoteCommand(sender, 'quote');
            });
            return;
        }

        // Command: Pantun
        if (lowerText === '!pantun') {
            await this.processCommand(message, '!pantun', async () => {
                return await this.handleQuoteCommand(sender, 'pantun');
            });
            return;
        }

        // Command: Motivasi
        if (lowerText === '!motivasi') {
            await this.processCommand(message, '!motivasi', async () => {
                return await this.handleQuoteCommand(sender, 'motivasi');
            });
            return;
        }

            //!brat
            if (lowerText.startsWith('!brats')) {
            const stickerText = text.substring(7).trim();
            
            if (!stickerText) {
                await this.quickProcess(message, '!brats', 
                    "❌ Format salah!\n\n" +
                    "Cara penggunaan : !brats [text]\n" +
                    "Contoh : !brats hello world"
                );
                return;
            }

            await this.processCommand(message, '!brats', async () => {
                return await this.handleBratsticker(sender, stickerText);
            });
            return;
        }

        // Command: Instagram Download
        if (lowerText.startsWith('!ig ')) {
            const url = text.substring(4).trim();
            
            if (!url) {
                await this.quickProcess(message, '!ig', 
                    "❌ Format salah!\n\n" +
                    "Cara penggunaan: `!ig [link]`\n" +
                    "Contoh: `!ig https://www.instagram.com/reel/...`"
                );
                return;
            }

            const instagramRegex = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+/;
            if (!instagramRegex.test(url)) {
                await this.quickProcess(message, '!ig', 
                    "❌ Link Instagram tidak valid!\n\nPastikan link adalah post, reel, atau IGTV Instagram"
                );
                return;
            }

            await this.processCommand(message, '!ig', async () => {
                return await this.handleInstagramCommand(sender, url);
            });
            return;
        }

            // Command: !facebook [link]
             if (lowerText.startsWith('!fb')) {
            const url = text.substring(4).trim();
            
            await this.processCommand(message, '!fb', async () => {
                return await this.handleFacebookCommand(sender, url, message);
            });
            return;
        }

        // Command: !ytmp4 [link]
        if (lowerText.startsWith('!ytmp4 ')) {
            const url = text.substring(7).trim();
            
            await this.processCommand(message, '!ytmp4', async () => {
                return await this.handleYTMP4Command(sender, url, message);
            });
            return;
        }

        // Command: !ytmp3 [link]
        if (lowerText.startsWith('!ytmp3 ')) {
            const url = text.substring(7).trim();
            
            await this.processCommand(message, '!ytmp3', async () => {
                return await this.handleYTMP3Command(sender, url, message);
            });
            return;
        }

            // Command: !ai [pertanyaan]
           if (lowerText.startsWith('!ai ')) {
            const question = text.substring(4).trim();
            
            await this.processCommand(message, '!ai', async () => {
                return await this.handleAICommand(sender, question);
            });
            return;
        }

        // Command: !aireset
        if (lowerText === '!aireset') {
            await this.handleAIResetCommand(sender);
            return;
        }

        // Command: !aitest
        if (lowerText === '!aitest') {
            await this.processCommand(message, '!aitest', async () => {
                const testResult = await this.newAIHandler.testConnection();
                
                if (testResult.success) {
                    return '✅ AI connection is working properly!';
                } else {
                    throw new Error(`AI connection failed: ${testResult.error}`);
                }
            });
            return;
        }

        // Command: !aiinfo
        if (lowerText === '!aiinfo') {
            await this.processCommand(message, '!aiinfo', async () => {
                return await this.handleAIInfoCommand(sender);
            });
            return;
        }

        if (lowerText === '!info') {
            await this.quickProcess(message, '!info', config.messages.info);
            return;
        }


            // =================== PESAN TIDAK DIKENALI ===================

            // HAPUS BAGIAN INI KARENA SUDAH DIHANDLE DI handleMessage
            // Jika pesan tidak dimulai dengan command, langsung anggap sebagai command tidak dikenali
            if (!lowerText.startsWith('!')) {
                // Jangan kirim pesan apapun, karena sudah difilter di handleMessage
                return;
            }

            // Jika command tidak dikenali
            await this.sendMessage(sender,
                "❌ Perintah tidak dikenali!\n│\n" +
                "Ketik *!help* untuk melihat daftar command yang tersedia."
            );

        } catch (error) {
            console.error('Error processing message:', error);
            await this.sendMessage(sender, "❌ Terjadi kesalahan dalam memproses pesan.");
        }
    }

    async getPinterestImages(query, limit = 20) {
        try {
            const axios = require('axios');
            const response = await axios.get(`http://apipinterest-production-2895.up.railway.app/api/search`, {
                params: {
                    q: query,
                    limit: limit
                }
            });
            
            if (response.data.success) {
                return response.data.data;
            } else {
                throw new Error(response.data.error);
            }
        } catch (error) {
            console.error('Error fetching Pinterest images:', error.message);
            return [];
        }
    }

    async handlePinterestCommand(sender, query) {
        try {
            // Show loading message
            await this.sendMessage(sender, `🔍 Mencari gambar "${query}" di Pinterest...`);
            
            // Fetch images from Pinterest API
            const images = await this.getPinterestImages(query, 20);
            
            if (images.length === 0) {
                return `❌ Tidak ditemukan gambar untuk "${query}".\n\nCoba kata kunci lain atau periksa koneksi API Pinterest.`;
            }

            // Initialize Pinterest state for this user
            if (!this.pinterestStates) {
                this.pinterestStates = new Map();
            }

            this.pinterestStates.set(sender, {
                query: query,
                images: images,
                currentIndex: 0,
                timestamp: Date.now()
            });

            // Send first image
            const firstImage = images[0];
            const caption = `🎨 *Pinterest Search: "${query}"*\n\n` +
                           `📷 Gambar 1 dari ${images.length}\n` +
                           `📌 Judul: ${firstImage.title || 'No title'}\n\n` +
                           `💡 Gunakan *!next* untuk gambar selanjutnya\n` +
                           `🔄 Anda masih bisa menggunakan command lain`;

            await this.sendImageFromUrl(sender, firstImage.url, caption);

            return null; // Image already sent
        } catch (error) {
            console.error('Error in Pinterest command:', error);
            return `❌ Terjadi kesalahan saat mengambil gambar Pinterest.\n\nError: ${error.message}`;
        }
    }

    async handlePinterestNextCommand(sender) {
        try {
            if (!this.pinterestStates || !this.pinterestStates.has(sender)) {
                return `❌ Anda tidak sedang dalam mode Pinterest!\n\n` +
                       `Gunakan *!pin [kata kunci]* terlebih dahulu untuk memulai pencarian.`;
            }

            const state = this.pinterestStates.get(sender);
            
            // Check if session is still valid (30 minutes timeout)
            const sessionTimeout = 30 * 60 * 1000; // 30 minutes
            if (Date.now() - state.timestamp > sessionTimeout) {
                this.pinterestStates.delete(sender);
                return `⏰ Sesi Pinterest Anda telah berakhir!\n\n` +
                       `Gunakan *!pin [kata kunci]* untuk memulai pencarian baru.`;
            }

            // Check if there are more images
            if (state.currentIndex >= state.images.length - 1) {
                return `📍 Anda sudah melihat semua gambar untuk "${state.query}"!\n\n` +
                       `🔄 Gunakan *!pin [kata kunci]* untuk pencarian baru.`;
            }

            // Move to next image
            state.currentIndex++;
            state.timestamp = Date.now(); // Update timestamp

            const currentImage = state.images[state.currentIndex];
            await this.sendImageFromUrl(sender, currentImage.url,
                `🎨 *Pinterest Search: "${state.query}"*\n\n` +
                `📷 Gambar ${state.currentIndex + 1} dari ${state.images.length}\n` +
                `📌 Judul: ${currentImage.title || 'No title'}\n\n` +
                `💡 Gunakan *!next* untuk gambar selanjutnya\n` +
                `🔄 Anda masih bisa menggunakan command lain`
            );

            return null; // Image already sent
        } catch (error) {
            console.error('Error in Pinterest next command:', error);
            return `❌ Terjadi kesalahan saat mengambil gambar selanjutnya.\n\nError: ${error.message}`;
        }
    }

    async sendImageFromUrl(sender, imageUrl, caption = '') {
        try {
            // Validate URL first
            if (!this.isValidImageUrl(imageUrl)) {
                throw new Error('Invalid image URL format');
            }

            const axios = require('axios');
            
            // Method 1: Try direct URL first (faster)
            try {
                await this.sendImageAlternative(sender, imageUrl, caption);
                return; // Success with direct URL
            } catch (directError) {
                console.log('Direct URL failed, trying download method...');
            }
            
            // Method 2: Download and send as buffer
            let response;
            let attempts = 0;
            const maxAttempts = 3;
            
            while (attempts < maxAttempts) {
                try {
                    response = await axios.get(imageUrl, {
                        responseType: 'arraybuffer',
                        timeout: 30000,
                        maxContentLength: 50 * 1024 * 1024, // 50MB max
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache',
                            'Sec-Fetch-Dest': 'image',
                            'Sec-Fetch-Mode': 'no-cors',
                            'Sec-Fetch-Site': 'cross-site',
                            'Referer': 'https://www.pinterest.com/'
                        }
                    });
                    break; // Success, exit retry loop
                } catch (retryError) {
                    attempts++;
                    if (attempts >= maxAttempts) {
                        throw retryError;
                    }
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                }
            }
            
            // Get content type from response
            const contentType = response.headers['content-type'] || 'image/jpeg';
            const buffer = Buffer.from(response.data);
            
            // Validate buffer
            if (buffer.length === 0) {
                throw new Error('Empty image buffer');
            }
            
            if (buffer.length > 16 * 1024 * 1024) { // 16MB WhatsApp limit
                throw new Error('Image too large (>16MB)');
            }
            
            // Send image with Baileys format
            await this.sock.sendMessage(sender, {
                image: buffer,
                caption: caption,
                mimetype: contentType
            });
            
        } catch (error) {
            console.error('Error sending image:', error.message);
            
            // Fallback: send link instead of image
            await this.sendMessage(sender, 
                `❌ Gagal mengirim gambar (${error.message})\n\n` +
                `🔗 Link gambar: ${imageUrl}\n\n` +
                (caption ? caption.replace('📷', '🖼️') : '') +
                `\n\n💡 Coba !next untuk gambar selanjutnya`
            );
        }
    }

    // Cleanup Pinterest states periodically (call this in your bot initialization)
    cleanupPinterestStates() {
        if (!this.pinterestStates) return;
        
        const now = Date.now();
        const timeout = 30 * 60 * 1000; // 30 minutes
        
        for (const [sender, state] of this.pinterestStates.entries()) {
            if (now - state.timestamp > timeout) {
                this.pinterestStates.delete(sender);
            }
        }
    }

    // Helper method to validate image URL
    isValidImageUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
        const lowercaseUrl = url.toLowerCase();
        
        // Check if URL has image extension or contains image indicators
        return imageExtensions.some(ext => lowercaseUrl.includes(ext)) || 
               lowercaseUrl.includes('image') || 
               lowercaseUrl.includes('img') ||
               lowercaseUrl.includes('photo') ||
               url.includes('pinimg.com'); // Pinterest specific
    }

    // Alternative method to send image using different approach
    async sendImageAlternative(sender, imageData, caption = '') {
        try {
            // Method 1: Direct URL
            if (typeof imageData === 'string' && imageData.startsWith('http')) {
                await this.sock.sendMessage(sender, {
                    image: { url: imageData },
                    caption: caption
                });
                return;
            }
            
            // Method 2: Buffer
            if (Buffer.isBuffer(imageData)) {
                await this.sock.sendMessage(sender, {
                    image: imageData,
                    caption: caption
                });
                return;
            }
            
            throw new Error('Invalid image data format');
            
        } catch (error) {
            console.error('Alternative image send failed:', error);
            throw error;
        }
    }

    async handleTestCommand(sender) {
        try {
            await this.sendMessage(sender, '🔄 Memulai test semua API...\nMohon tunggu beberapa saat...');

            const testResults = await this.performAPITests();
            const report = this.generateTestReport(testResults);

            await this.sendMessage(sender, report);

        } catch (error) {
            console.error('Error in test command:', error);
            await this.sendMessage(sender, '❌ Terjadi kesalahan saat melakukan test API');
        }
    }
    async performAPITests() {
        const testUrls = {
            tiktok: 'https://vt.tiktok.com/ZSBTYYFPH/',
            facebook: 'https://www.facebook.com/share/r/1639GUwBEd/',
            youtube: 'https://youtu.be/_c2f-2hBGBk?si=Sq8Ex623zBDShYvr',
            instagram: 'https://www.instagram.com/reel/DKf-w72TgL9/?igsh=MWdodGFvNDh4cm51YQ==',
            imageTest: 'https://raw.githubusercontent.com/Igimonsan/Image/refs/heads/main/istockphoto-452813985-612x612.jpg'
        };

        const results = {};

        // Test TikTok API
        console.log('Testing TikTok API...');
        results.tiktok = await this.testTikTokAPI(testUrls.tiktok);

        // Test Facebook API
        console.log('Testing Facebook API...');
        results.facebook = await this.testFacebookAPI(testUrls.facebook);

        // Test YouTube MP4 API
        console.log('Testing YouTube MP4 API...');
        results.ytmp4 = await this.testYTMP4API(testUrls.youtube);

        // Test YouTube MP3 API
        console.log('Testing YouTube MP3 API...');
        results.ytmp3 = await this.testYTMP3API(testUrls.youtube);

        // Test Instagram API
        console.log('Testing Instagram API...');
        results.instagram = await this.testInstagramAPI(testUrls.instagram);

        // Test Brat Sticker API
        console.log('Testing Brat Sticker API...');
        results.bratsticker = await this.testBratStickerAPI('test');

        // Test Tohitam API
        console.log('Testing Tohitam API...');
        results.tohitam = await this.testTohitamAPI(testUrls.imageTest);

        return results;
    }

    async testTikTokAPI(url) {
        try {
            const TikTokDownloader = require('../tiktok/tiktokDownloader');
            const downloader = new TikTokDownloader();

            const result = await downloader.downloadVideo(url);

            return {
                status: result.success ? 'success' : 'failed',
                message: result.success ? 'API TikTok berfungsi normal' : result.error || 'Gagal mendapatkan video',
                responseTime: Date.now(),
                details: result.success ? {
                    title: result.title,
                    author: result.author,
                    hasVideoUrl: !!result.videoUrl
                } : null
            };
        } catch (error) {
            return {
                status: 'error',
                message: `Error: ${error.message}`,
                responseTime: Date.now()
            };
        }
    }

    async testFacebookAPI(url) {
        try {
            const startTime = Date.now();
            const { data } = await axios.get(`${config.ferdev.apiUrl}/downloader/facebook`, {
                params: {
                    link: url,
                    apikey: config.ferdev.apiKey,
                },
                timeout: 15000
            });

            const responseTime = Date.now() - startTime;

            if (data && data.success) {
                return {
                    status: 'success',
                    message: 'API Facebook berfungsi normal',
                    responseTime: responseTime,
                    details: {
                        title: data.data?.title || 'No title',
                        hasVideoUrl: !!data.data?.hd
                    }
                };
            } else {
                return {
                    status: 'failed',
                    message: 'API Facebook tidak mengembalikan data valid',
                    responseTime: responseTime
                };
            }
        } catch (error) {
            return {
                status: 'error',
                message: `Error: ${error.message}`,
                responseTime: Date.now()
            };
        }
    }

    async testYTMP4API(url) {
        try {
            const startTime = Date.now();
            const { data } = await axios.get(`${config.ferdev.apiUrl}/downloader/ytmp4`, {
                params: {
                    link: url,
                    apikey: config.ferdev.apiKey,
                },
                timeout: 15000
            });

            const responseTime = Date.now() - startTime;

            if (data && data.success) {
                const videoUrl = data.data?.dlink || data.data?.video || data.data?.url || data.data?.download_url;
                return {
                    status: 'success',
                    message: 'API YouTube MP4 berfungsi normal',
                    responseTime: responseTime,
                    details: {
                        title: data.data?.title || 'No title',
                        hasVideoUrl: !!videoUrl
                    }
                };
            } else {
                return {
                    status: 'failed',
                    message: 'API YouTube MP4 tidak mengembalikan data valid',
                    responseTime: responseTime
                };
            }
        } catch (error) {
            return {
                status: 'error',
                message: `Error: ${error.message}`,
                responseTime: Date.now()
            };
        }
    }

    async testYTMP3API(url) {
        try {
            const startTime = Date.now();
            const { data } = await axios.get(`${config.ferdev.apiUrl}/downloader/ytmp3`, {
                params: {
                    link: url,
                    apikey: config.ferdev.apiKey,
                },
                timeout: 15000
            });

            const responseTime = Date.now() - startTime;

            if (data && data.success) {
                const audioUrl = data.data?.dlink || data.data?.audio || data.data?.url || data.data?.download_url;
                return {
                    status: 'success',
                    message: 'API YouTube MP3 berfungsi normal',
                    responseTime: responseTime,
                    details: {
                        title: data.data?.title || 'No title',
                        hasAudioUrl: !!audioUrl
                    }
                };
            } else {
                return {
                    status: 'failed',
                    message: 'API YouTube MP3 tidak mengembalikan data valid',
                    responseTime: responseTime
                };
            }
        } catch (error) {
            return {
                status: 'error',
                message: `Error: ${error.message}`,
                responseTime: Date.now()
            };
        }
    }

    async testInstagramAPI(url) {
        try {
            const startTime = Date.now();
            const { data } = await axios.get(`${config.ferdev.apiUrl}/downloader/instagram`, {
                params: {
                    link: url,
                    apikey: config.ferdev.apiKey,
                },
                timeout: 15000
            });

            const responseTime = Date.now() - startTime;

            if (data && data.success && data.data && data.data.success) {
                return {
                    status: 'success',
                    message: 'API Instagram berfungsi normal',
                    responseTime: responseTime,
                    details: {
                        type: data.data.type || 'Unknown type',
                        hasMediaUrl: !!(data.data.video_url || data.data.image_url || data.data.media)
                    }
                };
            } else {
                return {
                    status: 'failed',
                    message: 'API Instagram tidak mengembalikan data valid',
                    responseTime: responseTime
                };
            }
        } catch (error) {
            return {
                status: 'error',
                message: `Error: ${error.message}`,
                responseTime: Date.now()
            };
        }
    }

    async testBratStickerAPI(text) {
        try {
            const startTime = Date.now();
            const url = `${config.ferdev.apiUrl}/maker/brat?text=${encodeURIComponent(text)}&apikey=${config.ferdev.apiKey}`;

            const response = await axios.head(url, {
                timeout: 10000
            });

            const responseTime = Date.now() - startTime;

            if (response.status === 200) {
                return {
                    status: 'success',
                    message: 'API Brat Sticker berfungsi normal',
                    responseTime: responseTime,
                    details: {
                        contentType: response.headers['content-type'] || 'Unknown',
                        contentLength: response.headers['content-length'] || 'Unknown'
                    }
                };
            } else {
                return {
                    status: 'failed',
                    message: `API Brat Sticker mengembalikan status ${response.status}`,
                    responseTime: responseTime
                };
            }
        } catch (error) {
            return {
                status: 'error',
                message: `Error: ${error.message}`,
                responseTime: Date.now()
            };
        }
    }

    async testTohitamAPI(imageUrl) {
        try {
            const startTime = Date.now();
            const apiUrl = `${config.ferdev.apiUrl}/maker/tohitam?link=${encodeURIComponent(imageUrl)}&apikey=${config.ferdev.apiKey}`;

            const response = await axios.head(apiUrl, {
                timeout: 15000
            });

            const responseTime = Date.now() - startTime;

            if (response.status === 200) {
                return {
                    status: 'success',
                    message: 'API Tohitam berfungsi normal',
                    responseTime: responseTime,
                    details: {
                        contentType: response.headers['content-type'] || 'Unknown',
                        contentLength: response.headers['content-length'] || 'Unknown'
                    }
                };
            } else {
                return {
                    status: 'failed',
                    message: `API Tohitam mengembalikan status ${response.status}`,
                    responseTime: responseTime
                };
            }
        } catch (error) {
            return {
                status: 'error',
                message: `Error: ${error.message}`,
                responseTime: Date.now()
            };
        }
    }

    generateTestReport(results) {
        const timestamp = new Date().toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        let report = `🔍 *LAPORAN TEST API*\n`;
        report += `📅 Waktu: ${timestamp} WIB\n\n`;

        let successCount = 0;
        let totalCount = 0;

        const apiNames = {
            tiktok: 'TikTok Downloader',
            facebook: 'Facebook Downloader',
            ytmp4: 'YouTube MP4',
            ytmp3: 'YouTube MP3',
            instagram: 'Instagram Downloader',
            bratsticker: 'Brat Sticker Maker',
            tohitam: 'Tohitam Filter'
        };

        // Hitung statistik
        Object.values(results).forEach(result => {
            totalCount++;
            if (result.status === 'success') successCount++;
        });

        report += `📊 *RINGKASAN:*\n`;
        report += `✅ Berhasil: ${successCount}/${totalCount}\n`;
        report += `❌ Gagal: ${totalCount - successCount}/${totalCount}\n`;
        report += `📈 Success Rate: ${((successCount / totalCount) * 100).toFixed(1)}%\n\n`;

        report += `📋 *DETAIL HASIL:*\n\n`;

        // Detail setiap API
        Object.entries(results).forEach(([apiKey, result]) => {
            const apiName = apiNames[apiKey] || apiKey;

            if (result.status === 'success') {
                report += `✅ *${apiName}*\n`;
                report += `   Status: Berhasil\n`;
                report += `   Response: ${result.responseTime}ms\n`;
                if (result.details) {
                    if (result.details.title) report += `   Title: ${result.details.title}\n`;
                    if (result.details.author) report += `   Author: ${result.details.author}\n`;
                    if (result.details.type) report += `   Type: ${result.details.type}\n`;
                }
            } else if (result.status === 'failed') {
                report += `⚠️ *${apiName}*\n`;
                report += `   Status: Gagal\n`;
                report += `   Error: ${result.message}\n`;
                report += `   Response: ${result.responseTime}ms\n`;
            } else {
                report += `❌ *${apiName}*\n`;
                report += `   Status: Error\n`;
                report += `   Error: ${result.message}\n`;
            }
            report += `\n`;
        });

        // Rekomendasi
        const failedApis = Object.entries(results)
            .filter(([_, result]) => result.status !== 'success')
            .map(([apiKey, _]) => apiNames[apiKey] || apiKey);

        if (failedApis.length > 0) {
            report += `⚡ *PERHATIAN:*\n`;
            report += `API berikut memerlukan perhatian:\n`;
            failedApis.forEach(apiName => {
                report += `• ${apiName}\n`;
            });
            report += `\nSilahkan cek konfigurasi API key atau status server.\n\n`;
        } else {
            report += `🎉 *SEMUA API BERFUNGSI NORMAL!*\n\n`;
        }

        report += `─────────────────────\n`;
        report += `🤖 Bot API Status Checker`;

        return report;
    }
    async handleAIResetCommand(sender) {
        try {
            // Cek apakah user punya session AI aktif
            const hasActiveSession = this.newAIHandler.hasActiveSession(sender);

            if (!hasActiveSession) {
                await this.sendMessage(sender,
                    "ℹ️ *AI Reset*\n\n" +
                    "Anda belum memiliki session AI aktif.\n" +
                    "Ketik `!ai [pertanyaan]` untuk memulai chat dengan AI."
                );
                return;
            }

            // Reset AI session untuk user ini
            const resetResult = await this.newAIHandler.resetUserSession(sender);

            if (resetResult) {
                await this.sendMessage(sender,
                    "✅ *AI Session Reset*\n\n" +
                    "Riwayat percakapan AI Anda telah dihapus!\n" +
                    "Sekarang Anda bisa memulai percakapan baru dengan AI.\n\n" +
                    "Ketik `!ai [pertanyaan]` untuk memulai."
                );
                console.log(`🗑️ AI session reset for user: ${sender}`);
            } else {
                await this.sendMessage(sender,
                    "❌ Gagal mereset session AI.\n" +
                    "Silakan coba lagi dalam beberapa saat."
                );
            }

        } catch (error) {
            console.error('Error handling AI reset command:', error);
            await this.sendMessage(sender,
                "❌ Terjadi kesalahan saat mereset session AI.\n" +
                "Silakan coba lagi nanti."
            );
        }
    }

    async handleStickerCommand(sender, message) {
    const hasMedia = message.message?.imageMessage ||
        message.message?.videoMessage ||
        message.message?.stickerMessage ||
        message.message?.documentMessage;

    if (!hasMedia) {
        throw new Error(
            "Tidak ada media ditemukan!\n\n" +
            "Cara penggunaan:\n" +
            "1. Kirim gambar/video dengan caption `!sticker`\n" +
            "2. Atau kirim media dulu, lalu balas dengan `!sticker`"
        );
    }

    // Cek apakah media adalah sticker (untuk convert sticker to image)
    if (message.message?.stickerMessage) {
        throw new Error(
            "Media yang dikirim adalah sticker.\n" +
            "Untuk membuat sticker, kirim gambar atau video dengan caption `!sticker`"
        );
    }

    // Proses pembuatan sticker dan return hasil
    return await this.processStickerCreation(sender, message);
}

   async processTikTokDownload(sender, url) {
    try {
        const TikTokDownloader = require('../tiktok/tiktokDownloader');
        const downloader = new TikTokDownloader();

        const result = await downloader.processDownload(url, 'tiktok');

        if (result.success) {
            this.updateBotStats('api_success');
            this.updateCommandStats('tiktok');

            // Handle Carousel Content
            if (result.type === 'carousel') {
                this.updateBotStats('carousel');
                this.updateDownloadStats('tiktok', 'carousel', 0);
                
                // Send carousel media
                await this.sendTikTokCarousel(sender, result);
                return `✅ Carousel TikTok berhasil didownload!`;
                
            } else {
                // Handle video content
                this.updateDownloadStats('tiktok', 'video', 0);
                
                // Send video media
                await this.sendTikTokVideo(sender, result);
                return `✅ Video TikTok berhasil didownload!`;
            }
        } else {
            throw new Error(result.error || 'Download gagal');
        }
    } catch (error) {
        console.error('❌ Error in processTikTokDownload:', error);
        throw error;
    }
}


    async sendTikTokCarousel(sender, result) {
    try {
        console.log(`📸 Attempting to send ${result.files.images.length} images...`);

        // Send all images first (tanpa caption)
        for (const image of result.files.images) {
            try {
                console.log(`📤 Sending image ${image.index}: ${image.path}`);
                
                // Cek apakah file exists
                if (!(await fs.pathExists(image.path))) {
                    console.error(`❌ Image file not found: ${image.path}`);
                    continue;
                }

                const sent = await this.sendImage(sender, image.path);
                if (sent) {
                    console.log(`✅ Image ${image.index} sent successfully`);
                } else {
                    console.log(`❌ Failed to send image ${image.index}`);
                }
                
                // Small delay between images to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`❌ Error sending image ${image.index}:`, error);
            }
        }

        // Kirim caption setelah semua gambar terkirim
        const carouselInfo = `📸 ${result.info.title}\n👤 ${result.info.author.nickname} (@${result.info.author.username})\n🖼️ ${result.files.images.length} gambar\n🎵 ${result.info.music.title} - ${result.info.music.author}`;
        
        await this.sock.sendMessage(sender, {
            text: carouselInfo
        });
    } catch (error) {
        console.error('❌ Error sending TikTok carousel:', error);
        throw error;
    }
}

// Method untuk mengirim video TikTok
async sendTikTokVideo(sender, result) {
    try {
        // Send video with caption using sendVideo method
        if (result.files && result.files.video) {
            console.log(`📤 Sending video: ${result.files.video.path}`);
            
            const title = result.info.title;
            const author = `${result.info.author.nickname} (@${result.info.author.username})`;
            
            const sent = await this.sendVideo(sender, result.files.video.path, title, author);
            if (sent) {
                console.log(`✅ Video sent successfully`);
            } else {
                console.log(`❌ Failed to send video`);
            }
            
            // Optional: Send music info as additional message if needed
            if (result.info.music && result.info.music.title) {
                const musicInfo = `🎵 ${result.info.music.title} - ${result.info.music.author}`;
                await this.sock.sendMessage(sender, {
                    text: musicInfo
                });
            }
        }
    } catch (error) {
        console.error('❌ Error sending TikTok video:', error);
        throw error;
    }
}
// Helper methods - diperbaiki untuk Baileys

formatNumber(num) {
    if (!num || num === 0) return '0';
    if (num >= 1000000000) {
        return (num / 1000000000).toFixed(1) + 'B';
    } else if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

formatDuration(seconds) {
    if (!seconds) return '0s';
    
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    
    if (mins > 0) {
        return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
}

// Method untuk mengirim gambar - DIPERBAIKI UNTUK BAILEYS
async sendImage(sender, imagePath, caption = '') {
    try {
        // Cek apakah file exists
        if (!await fs.pathExists(imagePath)) {
            console.error(`Image file not found: ${imagePath}`);
            return false;
        }

        // Untuk Baileys
        if (this.sock && typeof this.sock.sendMessage === 'function') {
            const imageBuffer = await fs.readFile(imagePath);
            await this.sock.sendMessage(sender, {
                image: imageBuffer,
                caption: caption
            });
            return true;
        }
        
        // Fallback jika menggunakan property client yang berbeda
        if (this.client && typeof this.client.sendMessage === 'function') {
            const imageBuffer = await fs.readFile(imagePath);
            await this.client.sendMessage(sender, {
                image: imageBuffer,
                caption: caption
            });
            return true;
        }
        
        console.error('No valid Baileys client found');
        return false;
        
    } catch (error) {
        console.error(`Error sending image ${imagePath}:`, error);
        return false;
    }
}

// Method untuk mengirim audio - DIPERBAIKI UNTUK BAILEYS
async sendAudio(sender, audioPath, caption = '') {
    try {
        // Cek apakah file exists
        if (!await fs.pathExists(audioPath)) {
            console.error(`Audio file not found: ${audioPath}`);
            return false;
        }

        // Untuk Baileys
        if (this.sock && typeof this.sock.sendMessage === 'function') {
            const audioBuffer = await fs.readFile(audioPath);
            await this.sock.sendMessage(sender, {
                audio: audioBuffer,
                mimetype: 'audio/mp4', // atau 'audio/mpeg' tergantung format
                fileName: `${caption}.mp3`
            });
            return true;
        }
        
        // Fallback jika menggunakan property client yang berbeda
        if (this.client && typeof this.client.sendMessage === 'function') {
            const audioBuffer = await fs.readFile(audioPath);
            await this.client.sendMessage(sender, {
                audio: audioBuffer,
                mimetype: 'audio/mp4',
                fileName: `${caption}.mp3`
            });
            return true;
        }
        
        console.error('No valid Baileys client found');
        return false;
        
    } catch (error) {
        console.error(`Error sending audio ${audioPath}:`, error);
        return false;
    }
}

// Method untuk mengirim video - DIPERBAIKI UNTUK BAILEYS
async sendVideo(jid, filePath, title, author) {
    try {
        const delay = this.getRandomDelay();
        await this.sleep(delay);

        // Check if file exists
        if (!(await fs.pathExists(filePath))) {
            console.error(`❌ Video file not found: ${filePath}`);
            throw new Error(`Video file not found: ${filePath}`);
        }

        const videoBuffer = await fs.readFile(filePath);
        const caption = `🎬 *${title}*\n👤 By: ${author}\n\n✅ Video berhasil didownload tanpa watermark!`;

        // Send video with caption directly
        await this.sock.sendMessage(jid, {
            video: videoBuffer,
            caption: caption,
            mimetype: 'video/mp4'
        });

        console.log(`✅ Video berhasil dikirim ke ${jid}`);
        return true; // Return success indicator

    } catch (error) {
        console.error('Error sending video:', error);
        throw error;
    }
}
// Method untuk mengirim dokumen - DIPERBAIKI UNTUK BAILEYS
async sendDocument(sender, documentPath, filename) {
    try {
        // Cek apakah file exists
        if (!await fs.pathExists(documentPath)) {
            console.error(`Document file not found: ${documentPath}`);
            return false;
        }

        // Untuk Baileys
        if (this.sock && typeof this.sock.sendMessage === 'function') {
            const documentBuffer = await fs.readFile(documentPath);
            await this.sock.sendMessage(sender, {
                document: documentBuffer,
                fileName: filename,
                mimetype: 'application/json'
            });
            return true;
        }
        
        // Fallback jika menggunakan property client yang berbeda
        if (this.client && typeof this.client.sendMessage === 'function') {
            const documentBuffer = await fs.readFile(documentPath);
            await this.client.sendMessage(sender, {
                document: documentBuffer,
                fileName: filename,
                mimetype: 'application/json'
            });
            return true;
        }
        
        console.error('No valid Baileys client found');
        return false;
        
    } catch (error) {
        console.error(`Error sending document ${documentPath}:`, error);
        return false;
    }
}

// Method debugging untuk cek file structure
async debugFileStructure(folderPath) {
    try {
        if (!(await fs.pathExists(folderPath))) {
            console.log(`❌ Folder tidak ditemukan: ${folderPath}`);
            return;
        }

        console.log(`📁 Debug folder structure: ${folderPath}`);
        const files = await fs.readdir(folderPath);
        
        for (const file of files) {
            const filePath = path.join(folderPath, file);
            const stats = await fs.stat(filePath);
            console.log(`   📄 ${file} (${this.formatFileSize(stats.size)})`);
        }
    } catch (error) {
        console.error('Error debugging file structure:', error);
    }
}

// Method untuk format ukuran file
formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

    // 5. UPDATE METHOD processStickerCreation (tambahkan tracking)
    async processStickerCreation(sender, message) {
    try {
        const mediaData = await this.downloadMedia(message);

        if (!mediaData) {
            this.updateBotStats('api_error');
            throw new Error('Gagal mengunduh media');
        }

        console.log(`📁 Media downloaded: ${mediaData.mimetype}, size: ${mediaData.buffer.length} bytes`);

        const validation = await this.stickerMaker.validateMedia(mediaData.buffer, mediaData.mimetype);

        if (!validation.isValid) {
            const errorMessage = validation.errors.join('\n');
            throw new Error(errorMessage);
        }

        const result = await this.stickerMaker.createSticker(mediaData.buffer, mediaData.mimetype);

        if (result.success) {
            this.updateBotStats('api_success');
            this.updateBotStats('sticker');
            this.updateCommandStats('sticker');

            // TAMBAHKAN TRACKING DOWNLOAD
            const fileStats = await fs.stat(result.filePath);
            this.updateDownloadStats('sticker', 'sticker', fileStats.size);

            // Kirim sticker
            await this.sendSticker(sender, result.filePath);

            // Hapus file setelah 60 detik
            setTimeout(async () => {
                try {
                    await fs.remove(result.filePath);
                    console.log(`🗑️ File sticker ${result.fileName} telah dihapus`);
                } catch (err) {
                    console.error('Error deleting sticker file:', err);
                }
            }, 60000);

            console.log(`✅ Sticker created successfully for ${sender}`);
            
            // Return success message untuk edit
            return "🎨 Sticker berhasil dibuat!";

        } else {
            this.updateBotStats('api_error');
            throw new Error(result.error || 'Gagal membuat sticker');
        }

    } catch (error) {
        console.error('Error processing sticker creation:', error);
        this.updateBotStats('api_error');
        this.updateBotStats('error');
        throw error; // Re-throw untuk ditangani oleh processCommand
    }
}



    async handleBratsticker(sender, text) {
    try {
        const url = config.ferdev.apiUrl + '/maker/brat?text=' + text + '&apikey=' + config.ferdev.apiKey;
        const buffer = await this.getbuffer(url);

        const result = await this.stickerMaker.createSticker(buffer, "image/jpeg");

        if (result.success) {
            this.updateBotStats('api_success');
            this.updateBotStats('sticker');
            
            // Send sticker directly (file operations still need direct sending)
            await this.sendSticker(sender, result.filePath);

            // Cleanup file after delay
            setTimeout(async () => {
                try {
                    await fs.remove(result.filePath);
                    console.log(`🗑️ File sticker ${result.fileName} telah dihapus`);
                } catch (err) {
                    console.error('Error deleting sticker file:', err);
                }
            }, 60000);

            console.log(`✅ Sticker created successfully for ${sender}`);
            return `✅ Sticker berhasil dibuat dengan teks: "${text}"`;

        } else {
            console.error('Sticker creation failed:', result.error);
            return result.error || '❌ Gagal membuat sticker';
        }
    } catch (error) {
        console.error('Error processing bratsticker:', error);
        this.updateBotStats('api_error');
        return '❌ Terjadi kesalahan saat membuat sticker\nUlangi perintah atau hubungi admin wa.me//6289519705542';
    }
}

    async getbuffer(url, options) {
        try {
            options ? options : {}
            const res = await axios({
                method: "get",
                url,
                headers: {
                    'DNT': 1,
                    'Upgrade-Insecure-Request': 1,
                    ...options,
                },
                ...options,
                responseType: 'arraybuffer'
            })
            return res.data
        } catch (err) {
            return false
        }
    }

    async handleInstagramCommand(sender, url) {
    return await this.processInstagramDownload(sender, url);
}


    async handleFacebookCommand(sender, url) {
    if (!url) {
        const errorMsg = "❌ Format salah!\n\n" +
            "Cara penggunaan: `!facebook [link]`\n" +
            "Contoh: `!facebook https://www.facebook.com/...`";
        await this.sendMessage(sender, errorMsg);
        return errorMsg; // ✅ Return error message
    }

    if (!config.facebookRegex.test(url)) {
        const errorMsg = "❌ Link Facebook tidak valid!";
        await this.sendMessage(sender, errorMsg);
        return errorMsg; // ✅ Return error message
    }

    // ✅ Return result dari processFacebookDownload
    return await this.processFacebookDownload(sender, url);
}

async handleYTMP4Command(sender, url, message) {
    if (!url) {
        throw new Error(
            "Format salah!\n\n" +
            "Cara penggunaan: `!ytmp4 [link]`\n" +
            "Contoh: `!ytmp4 https://youtube.com/watch?v=...`"
        );
    }

    const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    if (!ytRegex.test(url)) {
        throw new Error("Link YouTube tidak valid!");
    }

    await this.processYTMP4Download(sender, url);
    return "✅ Video YouTube berhasil didownload!";
}

async processYTMP4Download(sender, url) {
    const { data } = await axios.get(`${config.ferdev.apiUrl}/downloader/ytmp4`, {
        params: {
            link: url,
            apikey: config.ferdev.apiKey,
        }
    });

    if (!data || !data.success) {
        this.updateBotStats('api_error');
        throw new Error('Gagal mendownload video YouTube\nUlangi perintah atau hubungi admin wa.me//6289519705542');
    }

    const videoUrl = data.data?.dlink || data.data?.video || data.data?.url || data.data?.download_url;

    if (!videoUrl) {
        this.updateBotStats('api_error');
        throw new Error('Link video tidak ditemukan');
    }

    this.updateBotStats('api_success');
    this.updateBotStats('video');
    this.updateCommandStats('youtube');

    // TAMBAHKAN TRACKING DOWNLOAD
    const estimatedSize = 15 * 1024 * 1024; // 15MB estimasi untuk video YouTube
    this.updateDownloadStats('youtube', 'video', estimatedSize);

    await this.sock.sendMessage(sender, {
        video: { url: videoUrl },
        caption: data?.data.title || 'Video YouTube',
        mimetype: 'video/mp4'
    });
}

async handleYTMP3Command(sender, url, message) {
    if (!url) {
        throw new Error(
            "Format salah!\n\n" +
            "Cara penggunaan: `!ytmp3 [link]`\n" +
            "Contoh: `!ytmp3 https://youtube.com/watch?v=...`"
        );
    }

    const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    if (!ytRegex.test(url)) {
        throw new Error("Link YouTube tidak valid!");
    }

    await this.processYTMP3Download(sender, url);
    return "✅ Audio YouTube berhasil didownload!";
}

async processYTMP3Download(sender, url) {
    const { data } = await axios.get(`${config.ferdev.apiUrl}/downloader/ytmp3`, {
        params: {
            link: url,
            apikey: config.ferdev.apiKey,
        }
    });

    if (!data || !data.success) {
        this.updateBotStats('api_error');
        throw new Error('Gagal mendownload audio YouTube\nUlangi perintah atau hubungi admin wa.me//6289519705542');
    }

    const audioUrl = data.data?.dlink || data.data?.audio || data.data?.url || data.data?.download_url;

    if (!audioUrl) {
        this.updateBotStats('api_error');
        throw new Error('Link audio tidak ditemukan');
    }

    this.updateBotStats('api_success');
    this.updateBotStats('audio');
    this.updateCommandStats('youtube');

    // TAMBAHKAN TRACKING DOWNLOAD
    const estimatedSize = 5 * 1024 * 1024; // 5MB estimasi untuk audio YouTube
    this.updateDownloadStats('youtube', 'audio', estimatedSize);

    const title = data.data?.title || 'Audio YouTube';

    await this.sock.sendMessage(sender, {
        audio: { url: audioUrl },
        caption: title,
        mimetype: 'audio/mp4',
        ptt: false
    });
}
    async processDirectAIQuestion(sender, question) {
        try {
            const axios = require('axios');

            // Gunakan model default ChatGPT
            const apiEndpoint = `${config.AI.apiUrl}${config.AI.models.default}`;

            const requestData = {
                prompt: question,
                logic: 'Kamu adalah Igimonsan Bot, setiap prompt menggunakan bahasa indonesia tanpa pengecualianpun!',
                apikey: config.AI.apikey
            };

            console.log(`🤖 Direct AI Request: ${question.substring(0, 50)}...`);

            // Call API dengan timeout
            const response = await axios.get(apiEndpoint, {
                params: requestData,
                timeout: 30000
            });

            console.log('🔍 API Response:', response.data);

            // Validasi response
            if (!response.data) {
                throw new Error('No response data from API');
            }

            if (response.data.success === false) {
                throw new Error(response.data.message || 'API returned error');
            }

            // Extract AI response dengan fallback
            let aiResponse = '';

            if (response.data.message) {
                aiResponse = response.data.message;
            } else if (response.data.data) {
                aiResponse = response.data.data;
            } else if (response.data.result) {
                aiResponse = response.data.result;
            } else if (response.data.response) {
                aiResponse = response.data.response;
            } else if (response.data.answer) {
                aiResponse = response.data.answer;
            } else if (typeof response.data === 'string') {
                aiResponse = response.data;
            } else {
                throw new Error('No valid response found in API data');
            }

            // Validasi response tidak kosong
            if (aiResponse && aiResponse.trim() !== '') {
                this.updateBotStats('api_success'); // TAMBAHKAN INI
                this.updateBotStats('ai'); // TAMBAHKAN INI

                return {
                    success: true,
                    message: `🤖 *ChatGPT Response*\n\n${aiResponse}`
                };
            } else {
                this.updateBotStats('api_error'); // TAMBAHKAN INI
                throw new Error('Empty response from AI');
            }

        } catch (error) {
            console.error('Error processing direct AI question:', error);
            this.updateBotStats('api_error'); // TAMBAHKAN INI
            this.updateBotStats('error'); // TAMBAHKAN INI
            console.error('Error details:', {
                message: error.message,
                response: error.response?.data,
                status: error.response?.status
            });

            // Handle specific error types
            let errorMessage = "❌ Terjadi kesalahan saat memproses AI";

            if (error.code === 'ENOTFOUND') {
                errorMessage = '❌ Tidak dapat terhubung ke server AI. Periksa koneksi internet.';
            } else if (error.response?.status === 429) {
                errorMessage = '❌ Server AI sedang sibuk. Coba lagi dalam beberapa menit.';
            } else if (error.response?.status === 401) {
                errorMessage = '❌ API Key tidak valid. Hubungi administrator.';
            } else if (error.response?.status === 400) {
                const apiMessage = error.response?.data?.message || error.message;
                errorMessage = `❌ Request Error: ${apiMessage}`;
            } else if (error.message.includes('Empty response')) {
                errorMessage = '❌ AI tidak memberikan respons. Coba dengan pertanyaan yang berbeda.';
            } else if (error.message.includes('timeout')) {
                errorMessage = '❌ Request timeout. Server AI terlalu lambat merespons.';
            }

            return {
                success: false,
                message: errorMessage
            };
        }
    }

    async handleAIInfoCommand(sender) {
        try {
            const stats = this.newAIHandler.getStats();
            const testConnection = await this.newAIHandler.testConnection();

            const infoMessage =
                `📂 IgimonAI Information\n│\n` +
                `├─ 📊 Session Statistics\n` +
                `│  ├─ Total Sessions: ${stats.totalSessions}\n` +
                `│  ├─ Active Sessions: ${stats.activeSessions}\n` +
                `│  └─ Total Requests: ${stats.totalRequests}\n│\n` +
                `├─ 🔌 Connection Status\n` +
                `│  └─ Current Status: ${testConnection.success ? '✅ Connected' : '❌ Disconnected'}\n│\n` +
                `├─ 💡 Usage Guidelines\n` +
                `│  ├─ Command: !ai [pertanyaan]\n` +
                `│  ├─ History: Riwayat tersimpan per user\n` +
                `│  └─ Session: Auto cleanup setelah 1 jam\n│\n` +
                `└─ ⚡ Features\n` +
                `   ├─ Natural conversation flow\n` +
                `   ├─ Contextual understanding\n` +
                `   └─ Real-time response`

            await this.sendMessage(sender, infoMessage);
        } catch (error) {
            console.error('Error getting AI info:', error);
            await this.sendMessage(sender, '❌ Gagal mendapatkan informasi AI');
        }
    }

    async handleAICommand(sender, question) {
    if (!question || question.trim() === '') {
        throw new Error(
            "Format salah!\n\n" +
            "Cara penggunaan: `!ai [pertanyaan]`\n" +
            "Contoh: `!ai Siapa presiden Indonesia?`\n" +
            "Contoh: `!ai Jelaskan tentang AI`"
        );
    }

    try {
        // Proses pertanyaan menggunakan AI handler baru
        const result = await this.newAIHandler.processQuestion(sender, question);

        if (result.success) {
            // Format respons yang lebih menarik
            const formattedResponse = `🤖 *IgimonAI Response*\n${result.response}`;

            // Send the AI response as a separate message (not edited)
            await this.sendMessage(sender, formattedResponse);

            console.log(`✅ AI response sent successfully to ${sender}`);
            return "✅ Pertanyaan AI berhasil diproses!";
        } else {
            throw new Error(result.error || "Gagal memproses pertanyaan AI\nUlangi perintah atau hubungi admin wa.me//6289519705542");
        }

    } catch (error) {
        console.error('Error in handleAICommand:', error);
        throw new Error("Terjadi kesalahan sistem saat memproses AI");
    }
}


    async handleQuoteCommand(sender, type) {
    try {
        const result = this.quoteGenerator.getRandomContent(type);

        if (result.success) {
            return result.formatted;
        } else {
            return result.error || '❌ Gagal mengambil konten';
        }

    } catch (error) {
        console.error(`Error processing ${type} command:`, error);
        return '❌ Terjadi kesalahan saat mengambil konten';
    }
}


    // =================== PROCESSING METHODS ===================

    updateBotStats(action, success = true) {
        switch (action) {
            case 'message':
                this.botStats.totalMessages++;
                break;
            case 'command':
                this.botStats.commandsProcessed++;
                break;
            case 'api_success':
                this.botStats.apiSuccess++;
                break;
            case 'api_error':
                this.botStats.apiErrors++;
                break;
            case 'media':
                this.botStats.mediaProcessed++;
                break;
            case 'sticker':
                this.botStats.stickersCreated++;
                break;
            case 'video':
                this.botStats.videoDownloads++;
                break;
            case 'audio':
                this.botStats.audioDownloads++;
                break;
            case 'ai':
                this.botStats.aiQueries++;
                break;
            case 'error':
                this.botStats.errors++;
                break;
        }
    }

    updateCommandStats(command) {
        if (this.botStats.commandStats.hasOwnProperty(command)) {
            this.botStats.commandStats[command]++;
        }
    }

    getUptime() {
        const uptime = Date.now() - this.botStats.startTime;
        const days = Math.floor(uptime / (24 * 60 * 60 * 1000));
        const hours = Math.floor((uptime % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const minutes = Math.floor((uptime % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((uptime % (60 * 1000)) / 1000);

        return { days, hours, minutes, seconds, totalMs: uptime };
    }


    async processQuoteGeneration(sender, type) {
        try {
            await this.sendMessage(sender, '⏳ Sedang mengambil konten...');

            const result = this.quoteGenerator.getRandomContent(type);

            if (result.success) {
                await this.sendMessage(sender, result.formatted);
            } else {
                await this.sendMessage(sender, result.error || '❌ Gagal mengambil konten');
            }

        } catch (error) {
            console.error('Error processing quote generation:', error);
            await this.sendMessage(sender, '❌ Terjadi kesalahan saat mengambil konten');
        }
    }


    async processStickerCreation(sender, message) {
        try {

            const mediaData = await this.downloadMedia(message);

            if (!mediaData) {
                this.updateBotStats('api_error');
                await this.sendMessage(sender, '❌ Gagal mengunduh media');
                return;
            }

            console.log(`📁 Media downloaded: ${mediaData.mimetype}, size: ${mediaData.buffer.length} bytes`);

            const validation = await this.stickerMaker.validateMedia(mediaData.buffer, mediaData.mimetype);

            if (!validation.isValid) {
                const errorMessage = validation.errors.join('\n');
                await this.sendMessage(sender, `❌ ${errorMessage}`);
                return;
            }

            const result = await this.stickerMaker.createSticker(mediaData.buffer, mediaData.mimetype);

            if (result.success) {
                this.updateBotStats('api_success');
                this.updateBotStats('sticker');
                this.updateCommandStats('sticker');

                // TAMBAHKAN TRACKING DOWNLOAD
                const fileStats = await fs.stat(result.filePath);
                this.updateDownloadStats('sticker', 'sticker', fileStats.size);

                await this.sendSticker(sender, result.filePath);

                setTimeout(async () => {
                    try {
                        await fs.remove(result.filePath);
                        console.log(`🗑️ File sticker ${result.fileName} telah dihapus`);
                    } catch (err) {
                        console.error('Error deleting sticker file:', err);
                    }
                }, 60000);

                console.log(`✅ Sticker created successfully for ${sender}`);

            } else {
                this.updateBotStats('api_error');
                await this.sendMessage(sender, result.error || '❌ Gagal membuat sticker');
                console.error('Sticker creation failed:', result.error);
            }

        } catch (error) {
            console.error('Error processing sticker creation:', error);
            this.updateBotStats('api_error');
            this.updateBotStats('error');
            await this.sendMessage(sender, '❌ Terjadi kesalahan saat membuat sticker');
        }
    }

    async processInstagramDownload(sender, url) {
    try {
        const { data } = await axios.get(`${config.ferdev.apiUrl}/downloader/instagram`, {
            params: {
                link: url,
                apikey: config.ferdev.apiKey,
            },
            timeout: 30000
        });

        if (!data || !data.success) {
            this.updateBotStats('api_error');
            return '❌ Gagal mendownload konten Instagram\nUlangi perintah atau hubungi admin wa.me//6289519705542';
        }

        const responseData = data.data;

        if (!responseData || !responseData.success) {
            this.updateBotStats('api_error');
            return '❌ Gagal memproses konten Instagram\nUlangi perintah atau hubungi admin wa.me//6289519705542';
        }

        this.updateBotStats('api_success');
        this.updateBotStats('video');
        this.updateCommandStats('instagram');

        // TAMBAHKAN TRACKING DOWNLOAD (estimasi ukuran file)
        const estimatedSize = 5 * 1024 * 1024; // 5MB estimasi untuk video Instagram
        this.updateDownloadStats('instagram', 'video', estimatedSize);

        // LOGIKA BARU: Deteksi berdasarkan konten aktual, bukan hanya field 'type'
        let isActuallyImage = false;
        let isActuallyVideo = false;

        // Cek apakah ini benar-benar gambar berdasarkan konten di videoUrls
        if (responseData.videoUrls && responseData.videoUrls.length > 0) {
            const mediaItem = responseData.videoUrls[0];
            const mediaType = mediaItem.type || mediaItem.ext || '';
            
            // Jika extension/type adalah format gambar, maka ini gambar
            if (mediaType.toLowerCase().includes('heic') || 
                mediaType.toLowerCase().includes('jpg') || 
                mediaType.toLowerCase().includes('jpeg') || 
                mediaType.toLowerCase().includes('png') || 
                mediaType.toLowerCase().includes('webp') ||
                mediaType.toLowerCase().includes('image')) {
                isActuallyImage = true;
            } else if (mediaType.toLowerCase().includes('mp4') || 
                      mediaType.toLowerCase().includes('video')) {
                isActuallyVideo = true;
            }
        }

        // Cek juga apakah ada thumbnailUrl (biasanya untuk gambar)
        if (responseData.thumbnailUrl && !isActuallyVideo) {
            isActuallyImage = true;
        }

        // Handle berdasarkan deteksi aktual konten
        if (isActuallyVideo || (responseData.type === 'video' && !isActuallyImage)) {
            await this.handleInstagramVideo(sender, responseData);
            return `✅ Video Instagram berhasil didownload!`;
        } else if (isActuallyImage || responseData.type === 'image' || responseData.thumbnailUrl) {
            await this.handleInstagramImage(sender, responseData);
            return `✅ Gambar Instagram berhasil didownload!`;
        } else if (responseData.type === 'slide') {
            const result = await this.handleInstagramCarousel(sender, responseData);
            return result || `✅ Carousel Instagram berhasil didownload!`;
        } else {
            // Fallback: jika masih tidak jelas, coba handle sebagai gambar jika ada thumbnailUrl
            if (responseData.thumbnailUrl) {
                await this.handleInstagramImage(sender, responseData);
                return `✅ Gambar Instagram berhasil didownload!`;
            } else {
                return '❌ Tipe konten Instagram tidak didukung';
            }
        }

    } catch (error) {
        console.error('Error processing Instagram download:', error);
        this.updateBotStats('api_error');
        this.updateBotStats('error');

        if (error.code === 'ECONNABORTED') {
            return '❌ Timeout: Server terlalu lambat merespons';
        } else if (error.response?.status === 429) {
            return '❌ Terlalu banyak request. Coba lagi dalam beberapa menit';
        } else {
            return '❌ Terjadi kesalahan saat mendownload';
        }
    }
}

// Helper function untuk konversi gambar ke JPG
async convertImageToJpg(imageBuffer, originalUrl = '') {
    try {
        // Deteksi format berdasarkan buffer atau URL
        const urlLower = originalUrl.toLowerCase();
        const needsConversion = urlLower.includes('.heic') || 
                               urlLower.includes('.webp') || 
                               urlLower.includes('.png') ||
                               urlLower.includes('.gif');

        // Jika sudah JPG/JPEG, return buffer asli
        if (!needsConversion && (urlLower.includes('.jpg') || urlLower.includes('.jpeg'))) {
            return imageBuffer;
        }

        // Konversi ke JPG dengan kualitas tinggi
        const convertedBuffer = await sharp(imageBuffer)
            .jpeg({ 
                quality: 85, 
                progressive: true,
                mozjpeg: true 
            })
            .toBuffer();

        console.log(`✅ Image converted to JPG (${imageBuffer.length} -> ${convertedBuffer.length} bytes)`);
        return convertedBuffer;
        
    } catch (error) {
        console.error('Error converting image to JPG:', error);
        // Jika konversi gagal, return buffer asli
        return imageBuffer;
    }
}

async handleInstagramVideo(sender, responseData) {
    try {
        // Cek apakah ada video URLs
        if (!responseData.videoUrls || responseData.videoUrls.length === 0) {
            await this.sendMessage(sender, '❌ Video tidak ditemukan');
            return;
        }

        // Ambil video berkualitas terbaik (biasanya index 0)
        const videoData = responseData.videoUrls[0];
        const ext = videoData.ext;
        const videoUrl = videoData.url;

        if (!videoUrl) {
            await this.sendMessage(sender, '❌ Link video tidak valid');
            return;
        }

        await this.sendMessage(sender, '⬇️ Sedang mengunduh video...');

        // Download video dari direct URL
        const videoResponse = await axios.get(videoUrl, {
            responseType: 'arraybuffer',
            timeout: 60000, // 60 detik timeout untuk download
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (ext == "mp4") {
            // Kirim video langsung tanpa caption
            await this.sock.sendMessage(sender, {
                video: Buffer.from(videoResponse.data),
                mimetype: 'video/mp4'
            });
        } else if (ext == "webp") {
            await this.sendMessage(sender, '🔄 Mengonversi gambar ke JPG...');
            
            // Konversi WebP ke JPG
            const originalBuffer = Buffer.from(videoResponse.data);
            const convertedBuffer = await this.convertImageToJpg(originalBuffer, videoUrl);
            
            await this.sock.sendMessage(sender, {
                image: convertedBuffer,
                mimetype: 'image/jpeg'
            });
        }

        console.log(`✅ Instagram video sent successfully to ${sender}`);

    } catch (error) {
        console.error('Error handling Instagram video:', error);

        if (error.code === 'ECONNABORTED') {
            await this.sendMessage(sender, '❌ Timeout: Video terlalu besar atau koneksi lambat');
        } else if (error.response?.status === 403) {
            await this.sendMessage(sender, '❌ Akses ke video ditolak. Coba link lain');
        } else if (error.response?.status === 404) {
            await this.sendMessage(sender, '❌ Video tidak ditemukan atau sudah dihapus');
        } else {
            await this.sendMessage(sender, '❌ Gagal mengunduh video Instagram');
        }
    }
}

async handleInstagramImage(sender, responseData) {
    try {
        // Cek berbagai kemungkinan struktur image URL
        let imageUrl;

        // Cari URL gambar dari berbagai kemungkinan field
        if (responseData.thumbnailUrl) {
            // Prioritas utama: gunakan thumbnailUrl untuk gambar
            imageUrl = responseData.thumbnailUrl;
        } else if (responseData.videoUrls && responseData.videoUrls.length > 0) {
            // Untuk kasus dimana gambar (HEIC/image) ada di videoUrls
            const mediaItem = responseData.videoUrls[0];
            if (mediaItem && (mediaItem.type === 'heic' || mediaItem.ext === 'heic' || 
                             mediaItem.type === 'image' || mediaItem.ext === 'jpg' || 
                             mediaItem.ext === 'jpeg' || mediaItem.ext === 'png')) {
                imageUrl = mediaItem.url;
            }
        } else if (responseData.imageUrls && responseData.imageUrls.length > 0) {
            imageUrl = responseData.imageUrls[0].url || responseData.imageUrls[0];
        } else if (responseData.mediaUrls && responseData.mediaUrls.length > 0) {
            imageUrl = responseData.mediaUrls[0].url || responseData.mediaUrls[0];
        } else if (responseData.url) {
            // Fallback ke direct URL jika ada
            imageUrl = responseData.url;
        }

        if (!imageUrl) {
            await this.sendMessage(sender, '❌ Gambar tidak ditemukan');
            return;
        }

        await this.sendMessage(sender, '⬇️ Sedang mengunduh gambar...');

        // Download image dari direct URL
        const imageResponse = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 30000, // 30 detik timeout untuk download
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        });

        // Deteksi format yang perlu konversi
        const contentType = imageResponse.headers['content-type'] || '';
        const urlLower = imageUrl.toLowerCase();
        const originalBuffer = Buffer.from(imageResponse.data);
        
        // Cek apakah sudah format JPG/JPEG
        const isAlreadyJpg = (contentType.includes('jpeg') || contentType.includes('jpg')) ||
                            (urlLower.includes('.jpg') || urlLower.includes('.jpeg'));
        
        // Cek apakah perlu konversi
        const needsConversion = !isAlreadyJpg || 
                               contentType.includes('heic') || 
                               contentType.includes('webp') ||
                               contentType.includes('png') ||
                               contentType.includes('gif') ||
                               urlLower.includes('.heic') || 
                               urlLower.includes('.webp') ||
                               urlLower.includes('.png') ||
                               urlLower.includes('.gif');

        if (needsConversion) {
            await this.sendMessage(sender, '🔄 Mengonversi gambar ke JPG...');
            
            // Gunakan converter yang sudah ada
            const convertedBuffer = await this.convertImageToJpg(originalBuffer, imageUrl);
            
            await this.sock.sendMessage(sender, {
                image: convertedBuffer,
                mimetype: 'image/jpeg'
            });
            
            console.log(`✅ Instagram image converted and sent to ${sender} (${contentType || 'unknown'} -> JPEG)`);
        } else {
            // Kirim gambar tanpa konversi jika sudah JPG/JPEG
            await this.sock.sendMessage(sender, {
                image: originalBuffer,
                mimetype: 'image/jpeg'
            });
            
            console.log(`✅ Instagram image sent to ${sender} (already JPEG)`);
        }

    } catch (error) {
        console.error('Error handling Instagram image:', error);

        if (error.code === 'ECONNABORTED') {
            await this.sendMessage(sender, '❌ Timeout: Gambar terlalu besar atau koneksi lambat');
        } else if (error.response?.status === 403) {
            await this.sendMessage(sender, '❌ Akses ke gambar ditolak. Coba link lain');
        } else if (error.response?.status === 404) {
            await this.sendMessage(sender, '❌ Gambar tidak ditemukan atau sudah dihapus');
        } else {
            await this.sendMessage(sender, '❌ Gagal mengunduh gambar Instagram');
        }
    }
}

async handleInstagramCarousel(sender, responseData) {
    try {
        // Cek apakah ada slides
        if (!responseData.slides || responseData.slides.length === 0) {
            await this.sendMessage(sender, '❌ Konten carousel tidak ditemukan');
            return;
        }

        // Kirim notifikasi awal tanpa menunggu
        await this.sendMessage(sender, `⬇️ Sedang mengunduh ${responseData.slides.length} media dari carousel...`);

        let successCount = 0;
        let failCount = 0;

        // Download dan kirim setiap media dalam carousel TANPA CAPTION
        for (let i = 0; i < responseData.slides.length; i++) {
            const slide = responseData.slides[i];

            try {
                // Ambil URL media dari slide
                let mediaUrl;
                if (slide.mediaUrls && slide.mediaUrls.length > 0) {
                    mediaUrl = slide.mediaUrls[0].url;
                } else if (slide.url) {
                    mediaUrl = slide.url;
                }

                if (!mediaUrl) {
                    console.log(`❌ Media URL tidak ditemukan untuk slide ${i + 1}`);
                    failCount++;
                    continue;
                }

                // Download media
                const mediaResponse = await axios.get(mediaUrl, {
                    responseType: 'arraybuffer',
                    timeout: 45000, // 45 detik timeout untuk setiap media
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'image/*,video/*,*/*;q=0.8'
                    }
                });

                // Deteksi tipe media yang lebih akurat
                const contentType = mediaResponse.headers['content-type'] || '';
                const mediaBuffer = Buffer.from(mediaResponse.data);
                const slideType = slide.mediaUrls?.[0]?.type || '';
                const urlExt = mediaUrl.toLowerCase();

                // Kirim berdasarkan deteksi yang lebih akurat - TANPA CAPTION
                if (contentType.includes('video') ||
                    slideType === 'mp4' ||
                    urlExt.includes('.mp4') ||
                    urlExt.includes('video')) {

                    await this.sock.sendMessage(sender, {
                        video: mediaBuffer,
                        mimetype: 'video/mp4'
                        // Tidak ada caption di sini
                    });

                } else {
                    // Handle image dengan konversi ke JPG jika perlu
                    const needsConversion = contentType.includes('heic') || 
                                           contentType.includes('webp') ||
                                           urlExt.includes('.heic') || 
                                           urlExt.includes('.webp') ||
                                           urlExt.includes('.png') ||
                                           slideType === 'heic';

                    let finalBuffer = mediaBuffer;
                    let finalMimetype = 'image/jpeg';

                    if (needsConversion) {
                        // Konversi ke JPG untuk kompatibilitas WhatsApp
                        finalBuffer = await this.convertImageToJpg(mediaBuffer, mediaUrl);
                        finalMimetype = 'image/jpeg';
                        console.log(`🔄 Carousel media ${i + 1} converted to JPG`);
                    } else {
                        // Tentukan mimetype untuk gambar yang tidak perlu konversi
                        if (contentType.includes('png') || urlExt.includes('.png')) {
                            finalMimetype = 'image/png';
                        } else if (contentType.includes('gif') || urlExt.includes('.gif')) {
                            finalMimetype = 'image/gif';
                        }
                    }

                    await this.sock.sendMessage(sender, {
                        image: finalBuffer,
                        mimetype: finalMimetype
                        // Tidak ada caption di sini
                    });
                }

                successCount++;
                console.log(`✅ Carousel media ${i + 1} sent successfully (${contentType || 'unknown type'})`);

                // Delay kecil antara pengiriman untuk menghindari spam
                if (i < responseData.slides.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }

            } catch (mediaError) {
                console.error(`Error downloading carousel media ${i + 1}:`, mediaError);
                failCount++;

                // Jika error pada media tertentu, lanjutkan ke media berikutnya
                continue;
            }
        }

        // KIRIM CAPTION/SUMMARY SETELAH SEMUA MEDIA BERHASIL DIKIRIM
        if (successCount > 0) {
            const summaryMessage = failCount > 0
                ? `✅ Berhasil mengunduh ${successCount} media, ${failCount} gagal`
                : `✅ Semua ${successCount} media berhasil diunduh`;

            // Delay sebentar sebelum kirim summary
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.sendMessage(sender, summaryMessage);
        } else {
            await this.sendMessage(sender, '❌ Gagal mengunduh semua media dari carousel');
        }

        console.log(`✅ Instagram carousel processed: ${successCount} success, ${failCount} failed`);

    } catch (error) {
        console.error('Error handling Instagram carousel:', error);
        await this.sendMessage(sender, '❌ Gagal memproses carousel Instagram');
    }
}

   async processFacebookDownload(sender, url) {
    try {
        const { data } = await axios.get(`${config.ferdev.apiUrl}/downloader/facebook`, {
            params: {
                link: url,
                apikey: config.ferdev.apiKey,
            }
        });

        if (!data || !data.success) {
            const errorMsg = '❌ Gagal mendownload video Facebook';
            await this.sendMessage(sender, errorMsg);
            return errorMsg; // ✅ Return error message
        }

        // Prioritas HD, fallback ke SD jika HD tidak tersedia
        const videoUrl = data.data.hd || data.data.sd;
        
        if (!videoUrl) {
            const errorMsg = '❌ Tidak ada video yang tersedia untuk didownload';
            await this.sendMessage(sender, errorMsg);
            return errorMsg; // ✅ Return error message
        }

        await this.sock.sendMessage(sender, {
            video: { url: videoUrl },
            caption: data?.data.title || 'Video Facebook',
            mimetype: 'video/mp4'
        });

        const successMsg = '✅ Video Facebook berhasil didownload!';
        // ❌ Hapus ini karena akan dikirim di processCommand
        // await this.sendMessage(sender, successMsg);
        
        return successMsg; // ✅ Return success message

    } catch (error) {
        console.error('Error processing Facebook download:', error);
        const errorMsg = '❌ Terjadi kesalahan saat mendownload';
        await this.sendMessage(sender, errorMsg);
        return errorMsg; // ✅ Return error message
    }
}

    async downloadMedia(message) {
        try {
            const mediaMessage = message.message?.imageMessage ||
                message.message?.videoMessage ||
                message.message?.stickerMessage ||
                message.message?.documentMessage;

            if (!mediaMessage) {
                console.log('❌ No media message found');
                return null;
            }

            const mimetype = mediaMessage.mimetype || 'application/octet-stream';
            console.log(`📥 Downloading media with mimetype: ${mimetype}`);

            const buffer = await downloadMediaMessage(message, 'buffer', {});

            if (!buffer || buffer.length === 0) {
                console.log('❌ Downloaded buffer is empty');
                return null;
            }

            console.log(`✅ Media downloaded successfully, size: ${buffer.length} bytes`);

            return {
                buffer: buffer,
                mimetype: mimetype,
                filename: mediaMessage.filename || 'media'
            };

        } catch (error) {
            console.error('Error downloading media:', error);
            return null;
        }
    }
    // =================== UTILITY METHODS ===================

    setupCleanupInterval() {
        setInterval(() => {
            this.cleanupInactiveUsers();
            this.newAIHandler.cleanupInactiveSessions();
            this.stickerMaker.cleanup();
        }, 4 * 24 * 60 * 60 * 1000); // 4 hari
    }

    cleanupInactiveUsers() {
        const now = Date.now();
        const inactiveThreshold = 60 * 60 * 1000;

        for (const [userId, userData] of this.userStates.entries()) {
            const lastActivity = userData.lastActivity || new Date();
            if (now - lastActivity.getTime() > inactiveThreshold) {
                console.log(`🧹 Cleaning up inactive user session: ${userId}`);
                this.userStates.delete(userId);
                this.userLastMessage.delete(userId);
                this.userWelcomeCount.delete(userId);
                this.processingUsers.delete(userId);
            }
        }
    }

    async sendMessage(jid, text) {
        try {
            const delay = this.getRandomDelay();
            await this.sleep(delay);

            const lastSentKey = `${jid}_${text}`;
            const currentTime = Date.now();
            const lastSentTime = this.messageQueue.get(lastSentKey) || 0;

            if (currentTime - lastSentTime < 2000) {
                console.log(`🚫 Mencegah spam ke ${jid}: "${text.substring(0, 50)}..."`);
                return;
            }

            await this.sock.sendMessage(jid, { text: text });
            this.messageQueue.set(lastSentKey, currentTime);

            if (this.messageQueue.size > 100) {
                const oldEntries = Array.from(this.messageQueue.entries())
                    .filter(([key, time]) => currentTime - time > 10000);
                oldEntries.forEach(([key]) => this.messageQueue.delete(key));
            }

        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    async sendVideo(jid, filePath, title, author) {
        try {
            const delay = this.getRandomDelay();
            await this.sleep(delay);

            const videoBuffer = await fs.readFile(filePath);
            const caption = `🎬 *${title}*\n👤 By: ${author}\n\n✅ Video berhasil didownload tanpa watermark!`;

            await this.sock.sendMessage(jid, {
                video: videoBuffer,
                caption: caption,
                mimetype: 'video/mp4'
            });

            console.log(`✅ Video berhasil dikirim ke ${jid}`);

        } catch (error) {
            console.error('Error sending video:', error);
            throw error;
        }
    }

    async sendSticker(jid, filePath) {
        try {
            const delay = this.getRandomDelay();
            await this.sleep(delay);

            const stickerBuffer = await fs.readFile(filePath);

            await this.sock.sendMessage(jid, {
                sticker: stickerBuffer,
                mimetype: 'image/webp'
            });

            console.log(`✅ Sticker berhasil dikirim ke ${jid}`);

        } catch (error) {
            console.error('Error sending sticker:', error);
            throw error;
        }
    }

    getStats() {
        const aiStats = this.newAIHandler.getStats();
        const activeSessions = this.newAIHandler.getActiveSessions().length;
        const quoteStats = this.quoteGenerator.getStats();
        const uptime = this.getUptime();

        return {
            botStats: this.botStats,
            uptime: uptime,
            totalUsers: this.userStates.size,
            activeUsers: this.processingUsers.size,
            activeAISessions: activeSessions,
            aiStats: aiStats,
            supportedStickerFormats: this.stickerMaker.constructor.getSupportedFormats(),
            quoteStats: quoteStats,
            memoryUsage: process.memoryUsage()
        };
    }

    resetBotStats() {
        this.botStats = {
            startTime: this.botStats.startTime, // PERTAHANKAN startTime asli
            totalMessages: 0,
            commandsProcessed: 0,
            apiSuccess: 0,
            apiErrors: 0,
            mediaProcessed: 0,
            stickersCreated: 0,
            videoDownloads: 0,
            audioDownloads: 0,
            aiQueries: 0,
            errors: 0,
            lastReset: Date.now(), // Update lastReset
            commandStats: {
                tiktok: 0,
                instagram: 0,
                facebook: 0,
                youtube: 0,
                sticker: 0,
                ai: 0,
                quote: 0,
                pantun: 0,
                motivasi: 0,
                brat: 0,
                help: 0,
                info: 0,
                ibot: 0
            }
        };

        // Reset download stats juga
        this.downloadStats = {
            totalFiles: 0,
            totalSize: 0,
            filesByType: {
                video: 0,
                audio: 0,
                image: 0,
                sticker: 0
            },
            platformStats: {
                tiktok: { count: 0, size: 0 },
                instagram: { count: 0, size: 0 },
                facebook: { count: 0, size: 0 },
                youtube: { count: 0, size: 0 },
                sticker: { count: 0, size: 0 }
            }
        };
    }
}

module.exports = WhatsAppClient;