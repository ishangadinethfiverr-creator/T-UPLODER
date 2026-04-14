/**
 * GitHub Downloader Script
 * Runs inside GitHub Actions
 */

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;
const videoUrl = process.env.VIDEO_URL;
const chatId = process.env.CHAT_ID;

const stringSession = new StringSession("");

(async () => {
    console.log(`📥 Starting download for Chat: ${chatId}, URL: ${videoUrl}`);
    
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.start({ botAuthToken: botToken });

    const fileName = `video_${Date.now()}.mp4`;
    const filePath = path.join(__dirname, fileName);

    try {
        // 1. Download using yt-dlp
        console.log("🛠 Downloading video...");
        execSync(`yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --no-check-certificate -o "${filePath}" "${videoUrl}"`);

        // 2. Upload to Telegram
        console.log("📤 Uploading to Telegram...");
        await client.sendFile(chatId, {
            file: filePath,
            caption: "🎬 **Hybrid Bot Upload**\nVia GitHub Actions",
            workers: 16, // GitHub Actions are powerful, using 16 workers
            supportsStreaming: true,
        });

        console.log("✅ Successfully sent!");
        fs.removeSync(filePath);
    } catch (error) {
        console.error("❌ Error:", error.message);
        await client.sendMessage(chatId, { message: `❌ ඩවුන්ලෝඩ් කිරීමේදී ගැටලුවක් මතු විය: ${error.message}` });
    }

    process.exit(0);
})();
