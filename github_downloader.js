/**
 * GitHub Advanced Downloader & Converter (v4 - Manual Thumb Upload)
 */

const { TelegramClient, Api } = require("telegram");
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
    console.log(`🚀 v4 - Starting... Mode: ${mode}`);
    
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.start({ botAuthToken: botToken });

    const tempDir = path.join(__dirname, 'temp');
    fs.ensureDirSync(tempDir);

    let finalFilePath = "";
    let thumbPath = "";

    try {
        // --- 1. TARGET FILE ---
        if (mode === "download") {
            finalFilePath = path.join(tempDir, `video_${Date.now()}.mp4`);
            execSync(`yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --no-check-certificate -o "${finalFilePath}" "${url}"`);
        } else {
            const fInfo = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${targetFileId}`);
            const dUrl = `https://api.telegram.org/file/bot${botToken}/${fInfo.data.result.file_path}`;
            finalFilePath = path.join(tempDir, `file_${Date.now()}${path.extname(fInfo.data.result.file_path)}`);
            const dw = await axios({ url: dUrl, responseType: 'stream' });
            const ds = fs.createWriteStream(finalFilePath);
            dw.data.pipe(ds);
            await new Promise((r) => ds.on('finish', r));
        }

        // --- 2. THUMBNAIL (Manual Upload) ---
        let uploadedThumb = null;
        if (thumbFileId && thumbFileId !== "null") {
            console.log("🛠 Downloading and Uploading Thumbnail...");
            try {
                const tInfo = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${thumbFileId}`);
                const tUrl = `https://api.telegram.org/file/bot${botToken}/${tInfo.data.result.file_path}`;
                thumbPath = path.join(tempDir, `thumb.jpg`);
                
                const tr = await axios({ url: tUrl, responseType: 'stream' });
                const tw = fs.createWriteStream(thumbPath);
                tr.data.pipe(tw);
                await new Promise((r) => tw.on('finish', r));

                // Manually upload the thumbnail file to Telegram first
                uploadedThumb = await client.uploadFile({
                    file: thumbPath,
                    workers: 1,
                    fileName: "thumb.jpg"
                });
                console.log("✅ Thumbnail uploaded to TG servers.");
            } catch (e) {
                console.log("⚠️ Thumb upload failed:", e.message);
            }
        }

        // --- 3. SEND FILE ---
        console.log(`📤 Final sending step...`);
        await client.sendFile(chatId, {
            file: finalFilePath,
            thumb: uploadedThumb || undefined, // Use the uploaded InputFile object
            forceDocument: (mode === "c2d"),
            caption: mode === "c2v" ? "✅ **Thumbnail Updated!**" : "📁 **Converted to Document**",
            supportsStreaming: true,
            workers: 16
        });

        console.log("✨ Done!");
    } catch (err) {
        console.error("❌ Error:", err.message);
        await client.sendMessage(chatId, { message: `❌ සිදුවීම අසාර්ථකයි: ${err.message}` });
    }

    fs.removeSync(tempDir);
    process.exit(0);
})();
