const axios = require('axios');

class NewAIHandler {
    constructor() {
        this.apiUrl = 'https://ai-production-6984.up.railway.app/ask';
        this.userSessions = new Map();
        this.requestCount = 0;
        this.lastCleanup = Date.now();
    }

    // Membuat session untuk user
    createUserSession(userId) {
        const session = {
            userId: userId,
            conversationHistory: [],
            lastActivity: Date.now(),
            requestCount: 0
        };

        this.userSessions.set(userId, session);
        return session;
    }

    hasActiveSession(userId) {
        // Cek apakah user punya session aktif
        return this.userSessions.has(userId);
    }

    async resetUserSession(userId) {
        const response = await axios.post(`${this.apiUrl}/reset`, { userId: userId }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'IgimonBot/1.0'
            },
            timeout: 30000 // 30 second timeout
        });

        console.log(`🔄 Reset AI session for user: ${userId}, response:`, response.data);

        if (response.status !== 200) {
            throw new Error(`Failed to reset session for user ${userId}: ${response.statusText}`);
        }

        // Jika berhasil, hapus session user
        if (response.data.success) {
            console.log(`✅ AI session reset successfully for user: ${userId}`);
        } else {
            console.error(`❌ Failed to reset AI session for user: ${userId}, error:`, response.data.error);
            return false;
        }

        // Hapus session user
        return this.userSessions.delete(userId);
    }

    // Mendapatkan atau membuat session user
    getUserSession(userId) {
        let session = this.userSessions.get(userId);

        if (!session) {
            session = this.createUserSession(userId);
        } else {
            session.lastActivity = Date.now();
        }

        return session;
    }

    // Proses pertanyaan AI
    async processQuestion(userId, prompt) {
        try {
            const session = this.getUserSession(userId);

            // Increment counters
            session.requestCount++;
            this.requestCount++;

            console.log(`🤖 Processing AI request from ${userId}: ${prompt.substring(0, 50)}...`);

            // Prepare request data
            const requestData = {
                userId: userId,
                prompt: prompt
            };

            // Make API request
            const response = await axios.post(this.apiUrl, requestData, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'IgimonBot/1.0'
                },
                timeout: 30000 // 30 second timeout
            });

            console.log('🔍 AI API Response status:', response.status);
            console.log('🔍 AI API Response data:', response.data);

            // Validate response
            if (!response.data) {
                throw new Error('No response data from AI API');
            }

            // Extract AI response
            let aiResponse = '';

            if (response.data.response) {
                aiResponse = response.data.response;
            } else if (response.data.message) {
                aiResponse = response.data.message;
            } else if (response.data.answer) {
                aiResponse = response.data.answer;
            } else if (response.data.data) {
                aiResponse = response.data.data;
            } else if (typeof response.data === 'string') {
                aiResponse = response.data;
            } else {
                throw new Error('No valid AI response found in API data');
            }

            // Validate response is not empty
            if (!aiResponse || aiResponse.trim() === '') {
                throw new Error('Empty response from AI');
            }

            // Save to conversation history
            session.conversationHistory.push({
                question: prompt,
                answer: aiResponse,
                timestamp: Date.now()
            });

            // Keep only last 10 conversations
            if (session.conversationHistory.length > 10) {
                session.conversationHistory = session.conversationHistory.slice(-10);
            }

            return {
                success: true,
                response: aiResponse,
                sessionInfo: {
                    userId: userId,
                    requestCount: session.requestCount,
                    totalRequests: this.requestCount
                }
            };

        } catch (error) {
            console.error('Error processing AI question:', error);
            console.error('Error details:', {
                message: error.message,
                response: error.response?.data,
                status: error.response?.status,
                url: error.config?.url
            });

            return this.handleError(error);
        }
    }

    // Handle different types of errors
    handleError(error) {
        let errorMessage = "❌ Terjadi kesalahan saat memproses AI";

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            errorMessage = '❌ Tidak dapat terhubung ke server AI. Periksa koneksi internet.';
        } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            errorMessage = '❌ Request timeout. Server AI terlalu lambat merespons.';
        } else if (error.response?.status === 429) {
            errorMessage = '❌ Server AI sedang sibuk. Coba lagi dalam beberapa menit.';
        } else if (error.response?.status === 401) {
            errorMessage = '❌ Akses ditolak. Hubungi administrator.';
        } else if (error.response?.status === 400) {
            const apiMessage = error.response?.data?.message || error.response?.data?.error || 'Invalid request';
            errorMessage = `❌ Request Error: ${apiMessage}`;
        } else if (error.response?.status === 500) {
            errorMessage = '❌ Server AI mengalami masalah internal. Coba lagi nanti.';
        } else if (error.message.includes('Empty response')) {
            errorMessage = '❌ AI tidak memberikan respons. Coba dengan pertanyaan yang berbeda.';
        } else if (error.message.includes('No valid AI response')) {
            errorMessage = '❌ Format respons AI tidak valid. Coba lagi nanti.';
        }

        return {
            success: false,
            error: errorMessage,
            details: error.message
        };
    }

    // Get user conversation history
    getUserHistory(userId) {
        const session = this.userSessions.get(userId);
        return session ? session.conversationHistory : [];
    }

    // Clear user session
    clearUserSession(userId) {
        this.userSessions.delete(userId);
        console.log(`🧹 Cleared AI session for user: ${userId}`);
    }

    // Get active sessions
    getActiveSessions() {
        return Array.from(this.userSessions.keys());
    }

    // Cleanup inactive sessions
    cleanupInactiveSessions() {
        const now = Date.now();
        const inactiveThreshold = 60 * 60 * 1000; // 1 hour
        const currentTime = Date.now();

        // Only cleanup every 30 minutes
        if (currentTime - this.lastCleanup < 30 * 60 * 1000) {
            return;
        }

        let cleanedCount = 0;

        for (const [userId, session] of this.userSessions.entries()) {
            if (now - session.lastActivity > inactiveThreshold) {
                this.userSessions.delete(userId);
                cleanedCount++;
                console.log(`🧹 Cleaned up inactive AI session: ${userId}`);
            }
        }

        this.lastCleanup = currentTime;

        if (cleanedCount > 0) {
            console.log(`🧹 Cleaned up ${cleanedCount} inactive AI sessions`);
        }
    }

    // Get statistics
    getStats() {
        return {
            totalSessions: this.userSessions.size,
            totalRequests: this.requestCount,
            activeSessions: this.getActiveSessions().length,
            apiEndpoint: this.apiUrl
        };
    }

    // Test API connection
    async testConnection() {
        try {
            const testResponse = await axios.post(this.apiUrl, {
                userId: 'test_user',
                prompt: 'Hello, are you working?'
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            return {
                success: true,
                status: testResponse.status,
                message: 'AI API connection successful'
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                status: error.response?.status || 'No response'
            };
        }
    }
}

module.exports = NewAIHandler;