/**
 * GitHub Advanced Downloader & Converter
 * Handles Download, c2d, c2v
 */

const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// Inputs from GitHub Events
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const mode = process.env.MODE || "download"; // download, c2d, c2v
const url = process.env.URL;
const targetFileId = process.env.TARGET_FILE_ID;
const thumbFileId = process.env.THUMB_FILE_ID;

const stringSession = new StringSession("");

(async () => {
    console.log(`🚀 Mode: ${mode}, Chat: ${chatId}`);
    
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.start({ botAuthToken: botToken });

    const tempDir = path.join(__dirname, 'temp');
    fs.ensureDirSync(tempDir);

    let finalFilePath = "";
    let thumbPath = "";

    try {
        // --- 1. GET TARGET FILE ---
        if (mode === "download") {
            console.log("🛠 Downloading from URL...");
            finalFilePath = path.join(tempDir, `video_${Date.now()}.mp4`);
            execSync(`yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --no-check-certificate -o "${finalFilePath}" "${url}"`);
        } else {
            console.log("🛠 Fetching file from Telegram...");
            // Use Bot API to get file path for simple download
            const fileResp = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${targetFileId}`);
            const filePathOnTG = fileResp.data.result.file_path;
            const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePathOnTG}`;
            
            finalFilePath = path.join(tempDir, path.basename(filePathOnTG));
            const resp = await axios({ url: downloadUrl, method: 'GET', responseType: 'stream' });
            const writer = fs.createWriteStream(finalFilePath);
            resp.data.pipe(writer);
            await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });
        }

        // --- 2. GET THUMBNAIL (Optional) ---
        if (thumbFileId && thumbFileId !== "null") {
            console.log("🛠 Fetching Custom Thumbnail...");
            const tResp = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${thumbFileId}`);
            const tPathTG = tResp.data.result.file_path;
            thumbPath = path.join(tempDir, `thumb_${Date.now()}.jpg`);
            const tr = await axios({ url: `https://api.telegram.org/file/bot${botToken}/${tPathTG}`, responseType: 'stream' });
            const tw = fs.createWriteStream(thumbPath);
            tr.data.pipe(tw);
            await new Promise((resolve) => tw.on('finish', resolve));
        }

        // --- 3. UPLOAD ---
        console.log(`📤 Uploading as ${mode === "c2d" ? "Document" : "Video"}...`);
        await client.sendFile(chatId, {
            file: finalFilePath,
            thumb: thumbPath || undefined,
            forceDocument: (mode === "c2d"),
            caption: mode === "c2v" ? "✅ **Thumbnail Updated!**" : "📁 **Converted to Document**",
            supportsStreaming: true,
            workers: 16
        });

        console.log("✨ Done!");
    } catch (error) {
        console.error("❌ Error:", error.message);
        await client.sendMessage(chatId, { message: `❌ සිදුවීම අසාර්ථකයි: ${error.message}` });
    }

    fs.removeSync(tempDir);
    process.exit(0);
})();
