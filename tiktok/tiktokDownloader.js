const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');

class TikTokDownloader {
    constructor() {
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br'
        };
    }

    // Method untuk mengekstrak video ID dari URL
    extractVideoId(url) {
        try {
            const regex = /(?:https?:\/\/)?(?:www\.)?(?:tiktok\.com\/@[\w.-]+\/video\/|vm\.tiktok\.com\/|tiktok\.com\/t\/)(\w+)/;
            const match = url.match(regex);
            return match ? match[1] : null;
        } catch (error) {
            console.error('Error extracting video ID:', error);
            return null;
        }
    }

    // Method untuk mendapatkan URL asli dari shortlink
    async getOriginalUrl(shortUrl) {
        try {
            const response = await axios.get(shortUrl, {
                headers: this.headers,
                maxRedirects: 5,
                timeout: 10000
            });
            return response.request.res.responseUrl || shortUrl;
        } catch (error) {
            console.error('Error getting original URL:', error);
            return shortUrl;
        }
    }

    // Method utama untuk download konten TikTok (video atau carousel)
    async downloadContent(url) {
        try {
            // Jika URL pendek, dapatkan URL asli
            if (url.includes('vm.tiktok.com') || url.includes('/t/')) {
                url = await this.getOriginalUrl(url);
            }

            console.log('Processing URL:', url);

            // Gunakan tikwm API
            const result = await this.downloadWithTikwm(url);
            
            if (result.success) {
                return result;
            }

            // Fallback ke API alternatif
            return await this.fallbackDownload(url);

        } catch (error) {
            console.error('Error downloading content:', error);
            return {
                success: false,
                error: 'Gagal mendownload konten. Coba lagi nanti.'
            };
        }
    }

    // Method untuk download menggunakan tikwm API
    async downloadWithTikwm(url) {
        try {
            const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
            
            const response = await axios.get(apiUrl, {
                headers: this.headers,
                timeout: 15000
            });

            console.log('TikWM API Response:', JSON.stringify(response.data, null, 2));

            if (response.data && response.data.code === 0) {
                const data = response.data.data;
                
                // Cek apakah ini carousel (image slideshow)
                if (data.images && data.images.length > 0) {
                    return {
                        success: true,
                        type: 'carousel',
                        title: data.title || 'TikTok Carousel',
                        author: {
                            username: data.author.unique_id || 'unknown',
                            nickname: data.author.nickname || 'Unknown',
                            avatar: data.author.avatar || null
                        },
                        music: {
                            title: data.music_info?.title || 'Unknown Music',
                            author: data.music_info?.author || 'Unknown Artist',
                            url: data.music || data.music_info?.play || null,
                            duration: data.duration || 0
                        },
                        images: data.images.map((img, index) => ({
                            index: index + 1,
                            url: img
                        })),
                        stats: {
                            views: data.play_count || 0,
                            likes: data.digg_count || 0,
                            comments: data.comment_count || 0,
                            shares: data.share_count || 0
                        },
                        create_time: data.create_time || null
                    };
                } 
                // Video biasa
                else if (data.play) {
                    return {
                        success: true,
                        type: 'video',
                        title: data.title || 'TikTok Video',
                        author: {
                            username: data.author.unique_id || 'unknown',
                            nickname: data.author.nickname || 'Unknown',
                            avatar: data.author.avatar || null
                        },
                        video: {
                            noWatermark: data.play || null,
                            watermark: data.wmplay || null,
                            // cover: data.cover || null,  // REMOVED: Tidak menyertakan URL cover/thumbnail
                            duration: data.duration || 0
                        },
                        music: {
                            title: data.music_info?.title || 'Unknown Music',
                            author: data.music_info?.author || 'Unknown Artist',
                            url: data.music || data.music_info?.play || null,
                            duration: data.duration || 0
                        },
                        stats: {
                            views: data.play_count || 0,
                            likes: data.digg_count || 0,
                            comments: data.comment_count || 0,
                            shares: data.share_count || 0
                        },
                        create_time: data.create_time || null
                    };
                }
            }

            throw new Error('Invalid response from TikWM API');

        } catch (error) {
            console.error('TikWM API failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    // Method fallback untuk download
    async fallbackDownload(url) {
        try {
            const apiUrl = `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(url)}`;
            
            const response = await axios.get(apiUrl, {
                headers: this.headers,
                timeout: 15000
            });

            if (response.data && response.data.video) {
                return {
                    success: true,
                    type: 'video',
                    title: response.data.title || 'TikTok Video',
                    author: {
                        username: response.data.author || 'unknown',
                        nickname: response.data.author || 'Unknown',
                        avatar: null
                    },
                    video: {
                        noWatermark: response.data.video.noWatermark,
                        watermark: response.data.video.watermark,
                        // cover: response.data.images?.[0] || null,  // REMOVED: Tidak menyertakan cover dari fallback API
                        duration: 0
                    },
                    music: {
                        title: 'Unknown Music',
                        author: 'Unknown Artist',
                        url: response.data.music || null,
                        duration: 0
                    },
                    stats: {
                        views: 0,
                        likes: 0,
                        comments: 0,
                        shares: 0
                    },
                    create_time: null
                };
            }

            throw new Error('Fallback API failed');

        } catch (error) {
            console.error('Fallback download failed:', error);
            return {
                success: false,
                error: 'Gagal mendownload konten dari semua API yang tersedia.'
            };
        }
    }

    // Method untuk download file (video, gambar, atau audio)
    async downloadFile(fileUrl, fileName, category, subfolder = '') {
        try {
            const response = await axios({
                method: 'GET',
                url: fileUrl,
                responseType: 'stream',
                headers: this.headers,
                timeout: 60000
            });

            // Buat folder berdasarkan kategori dan subfolder
            const folderPath = subfolder ? 
                path.join('./downloads', category, subfolder) : 
                path.join('./downloads', category);
            
            await fs.ensureDir(folderPath);

            const filePath = path.join(folderPath, fileName);
            const writer = fs.createWriteStream(filePath);

            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(filePath));
                writer.on('error', reject);
            });

        } catch (error) {
            console.error('Error downloading file:', error);
            throw error;
        }
    }

    // Method untuk membersihkan nama file
    sanitizeFileName(fileName) {
        return fileName
            .replace(/[^\w\s-]/g, '') // Hapus karakter khusus
            .replace(/\s+/g, '_') // Ganti spasi dengan underscore
            .replace(/_+/g, '_') // Hapus underscore berulang
            .substring(0, 100); // Batasi panjang nama file
    }

    // Method untuk download carousel lengkap
    async downloadCarousel(contentInfo, category) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
            const authorName = this.sanitizeFileName(contentInfo.author.username);
            const titleName = this.sanitizeFileName(contentInfo.title);
            
            const carouselFolder = `${authorName}_${titleName}_${timestamp}`;
            const results = {
                success: true,
                type: 'carousel',
                folder: carouselFolder,
                files: {
                    images: [],
                    music: null,
                    info: null
                },
                info: contentInfo
            };

            console.log(`Downloading carousel to folder: ${carouselFolder}`);

            // Download semua gambar
            for (const image of contentInfo.images) {
                try {
                    const imageFileName = `image_${String(image.index).padStart(2, '0')}.jpg`;
                    const imagePath = await this.downloadFile(
                        image.url, 
                        imageFileName, 
                        category, 
                        carouselFolder
                    );
                    
                    results.files.images.push({
                        index: image.index,
                        fileName: imageFileName,
                        path: imagePath
                    });
                    
                    console.log(`✓ Downloaded image ${image.index}: ${imageFileName}`);
                } catch (error) {
                    console.error(`✗ Failed to download image ${image.index}:`, error.message);
                }
            }

            // Download musik jika tersedia
            if (contentInfo.music && contentInfo.music.url) {
                try {
                    const musicFileName = `${this.sanitizeFileName(contentInfo.music.title)}_${this.sanitizeFileName(contentInfo.music.author)}.mp3`;
                    const musicPath = await this.downloadFile(
                        contentInfo.music.url, 
                        musicFileName, 
                        category, 
                        carouselFolder
                    );
                    
                    results.files.music = {
                        fileName: musicFileName,
                        path: musicPath
                    };
                    
                    console.log(`✓ Downloaded music: ${musicFileName}`);
                } catch (error) {
                    console.error('✗ Failed to download music:', error.message);
                }
            }

            // Simpan informasi lengkap ke file JSON
            const infoFileName = 'info.json';
            const infoPath = path.join('./downloads', category, carouselFolder, infoFileName);
            await fs.writeJSON(infoPath, contentInfo, { spaces: 2 });
            
            results.files.info = {
                fileName: infoFileName,
                path: infoPath
            };

            console.log(`✓ Saved info: ${infoFileName}`);

            return results;

        } catch (error) {
            console.error('Error downloading carousel:', error);
            return {
                success: false,
                error: 'Terjadi kesalahan saat mendownload carousel'
            };
        }
    }

    // Method untuk download video lengkap (TANPA THUMBNAIL)
    async downloadVideo(contentInfo, category) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
            const authorName = this.sanitizeFileName(contentInfo.author.username);
            const titleName = this.sanitizeFileName(contentInfo.title);
            
            const videoFolder = `${authorName}_${titleName}_${timestamp}`;
            const results = {
                success: true,
                type: 'video',
                folder: videoFolder,
                files: {
                    video: null,
                    // cover: null,  // REMOVED: Tidak ada field cover di hasil
                    music: null,
                    info: null
                },
                info: contentInfo
            };

            console.log(`Downloading video to folder: ${videoFolder}`);

            // Download video (prioritas tanpa watermark)
            const videoUrl = contentInfo.video.noWatermark || contentInfo.video.watermark;
            if (videoUrl) {
                try {
                    const videoFileName = `${titleName}.mp4`;
                    const videoPath = await this.downloadFile(
                        videoUrl, 
                        videoFileName, 
                        category, 
                        videoFolder
                    );
                    
                    results.files.video = {
                        fileName: videoFileName,
                        path: videoPath,
                        hasWatermark: !contentInfo.video.noWatermark
                    };
                    
                    console.log(`✓ Downloaded video: ${videoFileName}`);
                } catch (error) {
                    console.error('✗ Failed to download video:', error.message);
                }
            }

            // REMOVED: Bagian download cover/thumbnail dihapus sepenuhnya
            /*
            if (contentInfo.video.cover) {
                try {
                    const coverFileName = `${titleName}_cover.jpg`;
                    const coverPath = await this.downloadFile(
                        contentInfo.video.cover, 
                        coverFileName, 
                        category, 
                        videoFolder
                    );
                    
                    results.files.cover = {
                        fileName: coverFileName,
                        path: coverPath
                    };
                    
                    console.log(`✓ Downloaded cover: ${coverFileName}`);
                } catch (error) {
                    console.error('✗ Failed to download cover:', error.message);
                }
            }
            */

            // Download musik jika tersedia
            if (contentInfo.music && contentInfo.music.url) {
                try {
                    const musicFileName = `${this.sanitizeFileName(contentInfo.music.title)}_${this.sanitizeFileName(contentInfo.music.author)}.mp3`;
                    const musicPath = await this.downloadFile(
                        contentInfo.music.url, 
                        musicFileName, 
                        category, 
                        videoFolder
                    );
                    
                    results.files.music = {
                        fileName: musicFileName,
                        path: musicPath
                    };
                    
                    console.log(`✓ Downloaded music: ${musicFileName}`);
                } catch (error) {
                    console.error('✗ Failed to download music:', error.message);
                }
            }

            // Simpan informasi lengkap ke file JSON
            const infoFileName = 'info.json';
            const infoPath = path.join('./downloads', category, videoFolder, infoFileName);
            await fs.writeJSON(infoPath, contentInfo, { spaces: 2 });
            
            results.files.info = {
                fileName: infoFileName,
                path: infoPath
            };

            console.log(`✓ Saved info: ${infoFileName}`);

            return results;

        } catch (error) {
            console.error('Error downloading video:', error);
            return {
                success: false,
                error: 'Terjadi kesalahan saat mendownload video'
            };
        }
    }

    // Method utama untuk proses download lengkap
    async processDownload(url, category = 'tiktok') {
        try {
            console.log('='.repeat(50));
            console.log('🚀 Starting TikTok download process...');
            console.log('URL:', url);
            console.log('='.repeat(50));
            
            // Dapatkan informasi konten
            const contentInfo = await this.downloadContent(url);
            
            if (!contentInfo.success) {
                return {
                    success: false,
                    error: contentInfo.error || 'Gagal mendapatkan informasi konten'
                };
            }

            console.log(`📱 Content Type: ${contentInfo.type.toUpperCase()}`);
            console.log(`👤 Author: ${contentInfo.author.nickname} (@${contentInfo.author.username})`);
            console.log(`📝 Title: ${contentInfo.title}`);
            
            if (contentInfo.type === 'carousel') {
                console.log(`🖼️  Images: ${contentInfo.images.length} items`);
                console.log(`🎵 Music: ${contentInfo.music.title} - ${contentInfo.music.author}`);
                return await this.downloadCarousel(contentInfo, category);
            } else {
                console.log(`🎬 Video Duration: ${contentInfo.video.duration}s`);
                console.log(`🎵 Music: ${contentInfo.music.title} - ${contentInfo.music.author}`);
                return await this.downloadVideo(contentInfo, category);
            }

        } catch (error) {
            console.error('❌ Process download error:', error);
            return {
                success: false,
                error: 'Terjadi kesalahan saat memproses download'
            };
        }
    }

    // Method untuk menampilkan statistik konten
    displayStats(contentInfo) {
        if (!contentInfo.stats) return;
        
        console.log('\n📊 Content Statistics:');
        console.log(`   Views: ${this.formatNumber(contentInfo.stats.views)}`);
        console.log(`   Likes: ${this.formatNumber(contentInfo.stats.likes)}`);
        console.log(`   Comments: ${this.formatNumber(contentInfo.stats.comments)}`);
        console.log(`   Shares: ${this.formatNumber(contentInfo.stats.shares)}`);
        
        if (contentInfo.create_time) {
            console.log(`   Created: ${new Date(contentInfo.create_time * 1000).toLocaleDateString()}`);
        }
    }

    // Helper untuk format angka
    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }
}

module.exports = TikTokDownloader;