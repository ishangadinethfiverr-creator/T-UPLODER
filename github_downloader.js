/**
 * GitHub Advanced Downloader & Converter (v3 - Ultimate Thumb Fix)
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
    console.log(`🚀 v3 - Mode: ${mode}, ChatId: ${chatId}`);
    
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.start({ botAuthToken: botToken });

    const tempDir = path.join(__dirname, 'temp');
    fs.ensureDirSync(tempDir);

    let finalFilePath = "";
    let thumbBuffer = null;

    try {
        // --- 1. TARGET FILE ---
        if (mode === "download") {
            finalFilePath = path.join(tempDir, `video_${Date.now()}.mp4`);
            execSync(`yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --no-check-certificate -o "${finalFilePath}" "${url}"`);
        } else {
            console.log("🛠 Downloading Target File...");
            const fResp = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${targetFileId}`);
            const dUrl = `https://api.telegram.org/file/bot${botToken}/${fResp.data.result.file_path}`;
            finalFilePath = path.join(tempDir, `file_${Date.now()}${path.extname(fResp.data.result.file_path)}`);
            const writer = fs.createWriteStream(finalFilePath);
            const response = await axios({ url: dUrl, method: 'GET', responseType: 'stream' });
            response.data.pipe(writer);
            await new Promise((resolve) => writer.on('finish', resolve));
        }

        // --- 2. THUMBNAIL (As Buffer) ---
        if (thumbFileId && thumbFileId !== "null") {
            console.log("🛠 Processing Thumbnail...");
            try {
                const tInfo = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${thumbFileId}`);
                const tUrl = `https://api.telegram.org/file/bot${botToken}/${tInfo.data.result.file_path}`;
                const tResp = await axios.get(tUrl, { responseType: 'arraybuffer' });
                thumbBuffer = Buffer.from(tResp.data);
                console.log("✅ Thumbnail buffer loaded.");
            } catch (e) {
                console.log("⚠️ Thumb download failed, using default.");
            }
        }

        // --- 3. SEND FILE ---
        console.log(`📤 Sending as ${mode === "c2d" ? "Document" : "Video"}...`);
        
        // MTProto upload
        await client.sendFile(chatId, {
            file: finalFilePath,
            thumb: thumbBuffer ? thumbBuffer : undefined,
            forceDocument: (mode === "c2d"),
            caption: mode === "c2v" ? "✅ **Thumbnail Updated!**" : "📁 **Converted to Document**",
            supportsStreaming: true,
            workers: 16
        });

        console.log("✨ Process completed!");
    } catch (error) {
        console.error("❌ Fatal Error:", error.message);
        await client.sendMessage(chatId, { message: `❌ විධානය අසාර්ථකයි: ${error.message}` });
    }

    fs.removeSync(tempDir);
    process.exit(0);
})();
