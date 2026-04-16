/**
 * GitHub Advanced Downloader & Converter (v2 - Fixed Thumb & Speed)
 */

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const mode = process.env.MODE || "download";
const url = process.env.URL;
const targetFileId = process.env.TARGET_FILE_ID;
const thumbFileId = process.env.THUMB_FILE_ID;

const stringSession = new StringSession("");

(async () => {
    console.log(`🚀 v2 - Mode: ${mode}, Chat: ${chatId}`);
    
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.start({ botAuthToken: botToken });

    const tempDir = path.join(__dirname, 'temp');
    fs.ensureDirSync(tempDir);

    let finalFilePath = "";
    let thumbPath = "";

    try {
        // --- 1. GET TARGET FILE ---
        if (mode === "download") {
            finalFilePath = path.join(tempDir, `video_${Date.now()}.mp4`);
            execSync(`yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --no-check-certificate -o "${finalFilePath}" "${url}"`);
        } else {
            console.log("🛠 Downloading from Telegram...");
            const fResp = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${targetFileId}`);
            const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fResp.data.result.file_path}`;
            finalFilePath = path.join(tempDir, `file_${Date.now()}${path.extname(fResp.data.result.file_path)}`);
            const flow = await axios({ url: downloadUrl, responseType: 'stream' });
            const stream = fs.createWriteStream(finalFilePath);
            flow.data.pipe(stream);
            await new Promise((resolve) => stream.on('finish', resolve));
        }

        // --- 2. GET CUSTOM THUMBNAIL (IF PROVIDED) ---
        if (thumbFileId && thumbFileId !== "null") {
            console.log("🛠 Downloading Custom Thumbnail...");
            try {
                const tInfo = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${thumbFileId}`);
                const tUrl = `https://api.telegram.org/file/bot${botToken}/${tInfo.data.result.file_path}`;
                thumbPath = path.join(tempDir, `thumb_${Date.now()}.jpg`);
                
                const tr = await axios({ url: tUrl, responseType: 'stream' });
                const tw = fs.createWriteStream(thumbPath);
                tr.data.pipe(tw);
                await new Promise((resolve) => tw.on('finish', resolve));
                
                if (!fs.existsSync(thumbPath)) thumbPath = "";
                else console.log("✅ Thumbnail downloaded successfully.");
            } catch (e) {
                console.log("⚠️ Could not download custom thumb, will use default.");
            }
        }

        // --- 3. UPLOAD ---
        console.log(`📤 Uploading...`);
        await client.sendFile(chatId, {
            file: finalFilePath,
            thumb: thumbPath ? thumbPath : undefined,
            forceDocument: (mode === "c2d"),
            caption: mode === "c2v" ? "✅ **Custom Thumbnail Video**" : "📁 **Document Block File**",
            supportsStreaming: true,
            workers: 16
        });

        console.log("✨ All tasks completed successfully.");
    } catch (error) {
        console.error("❌ Fatal Error:", error.message);
        await client.sendMessage(chatId, { message: `❌ විධානය අසාර්ථකයි: ${error.message}` });
    }

    fs.removeSync(tempDir);
    process.exit(0);
})();
