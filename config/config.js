// Konfigurasi bot
const config = {

    // Folder untuk menyimpan file
    folders: {
        downloads: './downloads',
        temp: './temp',
        sessions: './sessions',
        stickers: './stickers'
    },

    // API keys dan URL untuk berbagai layanan
    ferdev: {
        apiKey: process.env.FERDEV_API_KEY, 
        apiUrl: 'https://api.ferdev.my.id',
    },

     newAI: {
        apiUrl: 'https://ai-production-9984.up.railway.app/ask',
        timeout: 30000, // 30 seconds
        maxHistoryPerUser: 10,
        cleanupInterval: 30 * 60 * 1000, // 30 minutes
        inactiveThreshold: 60 * 60 * 1000, // 1 hour
        rateLimitPerUser: 100, // max requests per user per hour
        rateLimitWindow: 60 * 60 * 1000 // 1 hour window
    },

    // Ganti dengan konfigurasi API AI baru
AI: {
    apikey: process.env.FERDEV_API_KEY,
    apiUrl: 'https://api.ferdev.my.id/',
    models: {
        default: 'ai/gptlogic',

    },
    // parameter sesuai API baru
     maxTokens: 150,
    temperature: 0.7
},

    // Kategori video yang tersedia (masih bisa digunakan untuk default category)
    categories: {
        '1': 'Video tiktok',
        '2': 'Edukasi',
        '3': 'Olahraga',
        '4': 'Musik',
        '5': 'Kuliner',
        '6': 'Tutorial',
        '7': 'Lainnya'
    },

    // Sticker configuration
    sticker: {
        maxSize: 1024 * 1024 * 5, // 5MB max file size
        quality: 100,
        packname: 'IGIMONSAN BOT',
        author: 'Igimonsan Bot',
        supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm'],
        maxDuration: 10 // seconds for video stickers
    },

    // Pesan bot
    messages: {
        info: 
    `📂 BOT INFORMATION\n│\n` +
     `├─ 🤖 Bot Details\n` +
     `│  ├─ Name: Bot by IGIMONSAN\n` +
     `│  ├─ Version: 4.0.0\n` +
     `│  ├─ Status: 🟢 Online\n` +
     `│  └─ Developer: Igimonsan\n│\n` +
     `├─ 📱 Media Downloader\n` +
     `│  ├─ !tiktok [link] → Download video TikTok\n` +
     `│  ├─ !fb [link] → Download video Facebook\n` +
     `│  ├─ !ytmp4 [link] → Download video YouTube\n` +
     `│  ├─ !ig [link] → Download video Instagram\n` +
     `│  └─ !ytmp3 [link] → Download audio YouTube\n│\n` +
     `├─ 🎨 Creative Tools\n` +
     `│  ├─ !sticker → Buat sticker (kirim gambar)\n` +
     `│  ├─ !brats → Buat sticker dari teks\n` +
     `│  ├─ !quote → Quote inspiratif random\n` +
     `│  ├─ !pantun → Pantun lucu random\n` +
     `│  ├─ !motivasi → Motivasi semangat random\n` +
     `│  └─ !hitamkan → Penghitaman gambar (kirim foto)\n│\n` +
     `├─ 🤖 IgimonAI Assistant\n` +
     `│  ├─ !ai [pertanyaan] → Chat dengan AI 🆕\n` +
     `│  ├─ !aitest → Uji koneksi AI\n` +
     `│  ├─ !aireset → Reset session percakapan\n` +
     `│  └─ !aiinfo → Info lengkap tentang IgimonAI\n│\n` +
     `├─ ℹ️ Bot Information\n` +
     `│  ├─ !help → Tampilkan menu perintah ini\n` +
     `│  └─ !info → Informasi detail bot\n│\n` +
     `├─ 📖 Usage Examples\n` +
     `│  ├─ Media: !tiktok https://vt.tiktok.com/...\n` +
     `│  ├─ AI Chat: !ai Jelaskan tentang kecerdasan buatan\n` +
     `│  └─ Tools: Kirim gambar + !sticker\n│\n` +
     `└─ ✨ IgimonAI Capabilities\n` +
        `   ├─ Percakapan natural & kontekstual\n` +
        `   ├─ Riwayat chat tersimpan otomatis\n` +
        `   └─ Respons cepat & akurat 24/7`,
        menu :
        `📂 DAFTAR PERINTAH YANG TERSEDIA\n│\n` +
        `├─ 📱 Media Downloader\n` +
        `│  ├─ !tiktok [link] → Download video TikTok\n` +
        `│  ├─ !fb [link] → Download video Facebook\n` +
        `│  ├─ !ytmp4 [link] → Download video YouTube\n` +
        `│  ├─ !ig [link] → Download video Instagram\n` +
        `│  └─ !ytmp3 [link] → Download audio YouTube\n│\n` +
        `├─ 🔍 Pinterest\n`+
        `│  └─!pin [query] → Cari gambar dari Pinterest\n│\n` +
        `├─ 🎨 Creative Tools\n` +
        `│  ├─ !sticker → Buat sticker (kirim gambar)\n` +
        `│  ├─ !brats → Buat sticker dari teks\n` +
        `│  ├─ !quote → Quote inspiratif random\n` +
        `│  ├─ !pantun → Pantun lucu random\n` +
        `│  ├─ !motivasi → Motivasi semangat random\n` +
        `│  └─ !hitamkan → Penghitaman gambar (kirim foto)\n│\n` +
        `├─ 🤖 IgimonAI Assistant\n` +
        `│  ├─ !ai [pertanyaan] → Chat dengan AI 🆕\n` +
        `│  ├─ !aitest → Uji koneksi AI\n` +
        `│  ├─ !aireset → Reset session percakapan\n` +
        `│  └─ !aiinfo → Info lengkap tentang IgimonAI\n│\n` +
        `├─ ℹ️ Bot Information\n` +
        `│  ├─ !help → Tampilkan menu perintah ini\n` +
        `│  └─ !info → Informasi detail bot\n│\n` +
        `├─ 📖 Usage Examples\n` +
        `│  ├─ Media: !tiktok https://vt.tiktok.com/...\n` +
        `│  ├─ AI Chat: !ai Jelaskan tentang kecerdasan buatan\n` +
        `│  └─ Tools: Kirim gambar + !sticker\n│\n` +
        `├─ 🔧 Admin Commands:\n` +
        `│  ├─ !bot on → Aktifkan bot\n` +
        `│  ├─ !bot off → Nonaktifkan bot\n` +
        `│  └─ !bot status → Status bot\n│\n` +
        `└─ ✨ IgimonAI Capabilities\n` +
        `   ├─ Percakapan natural & kontekstual\n` +
        `   ├─ Riwayat chat tersimpan otomatis\n` +
        `   └─ Respons cepat & akurat 24/7`
    },
    // Regex untuk validasi ytube link
    ytmp4Regex: /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    // Add this to your config file
    ytmp3Regex: /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    // Regex untuk validasi link TikTok
    facebookRegex: /https?:\/\/(?:www\.)?facebook\.com\/(?:watch\?v=|share\/|video\/|.*\/videos\/)([\w\-]+)/,
    // Regex untuk validasi link TikTok
    tiktokRegex: /https?:\/\/(?:www\.|vt\.)?tiktok\.com\/[\w\-\._~:\/?#\[\]@!\$&'\(\)\*\+,;=]*/
};

module.exports = config;
