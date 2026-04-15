/**
 * GitHub Downloader v6 - FFmpeg Thumb Embed (Ultimate Fix)
 */

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const mode = process.env.MODE || "download";
const url = process.env.URL;
const targetFileId = process.env.TARGET_FILE_ID;
const thumbFileId = process.env.THUMB_FILE_ID;

const TG_API = `https://api.telegram.org/bot${botToken}`;
const tempDir = path.join(__dirname, 'temp');

async function downloadFromTelegram(fileId, savePath) {
    const fInfo = await axios.get(`${TG_API}/getFile?file_id=${fileId}`);
    const dUrl = `https://api.telegram.org/file/bot${botToken}/${fInfo.data.result.file_path}`;
    const resp = await axios({ url: dUrl, responseType: 'stream' });
    const writer = fs.createWriteStream(savePath);
    resp.data.pipe(writer);
    await new Promise((r) => writer.on('finish', r));
    return fInfo.data.result.file_path;
}

async function sendViaFormData(filePath, isDocument, caption, thumbPath) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('parse_mode', 'Markdown');

    // --- Added Thumbnail parameter for UI Preview ---
    if (thumbPath && fs.existsSync(thumbPath)) {
        console.log("📎 Adding thumb parameter to Telegram API call...");
        form.append('thumb', fs.createReadStream(thumbPath));
    }

    if (isDocument) {
        form.append('document', fs.createReadStream(filePath));
    } else {
        form.append('video', fs.createReadStream(filePath));
        form.append('supports_streaming', 'true');
    }

    const endpoint = isDocument ? 'sendDocument' : 'sendVideo';
    await axios.post(`${TG_API}/${endpoint}`, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    });
}

(async () => {
    console.log(`🚀 v6 (Hybrid) - Mode: ${mode}, Chat: ${chatId}`);
    fs.ensureDirSync(tempDir);

    let finalFilePath = "";
    let thumbPath = "";

    try {
        if (mode === "download") {
            const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
            await client.start({ botAuthToken: botToken });

            finalFilePath = path.join(tempDir, `video_${Date.now()}.mp4`);
            console.log("🛠 Downloading from URL...");
            execSync(`yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --no-check-certificate -o "${finalFilePath}" "${url}"`);

            await client.sendFile(chatId, {
                file: finalFilePath,
                caption: "✅ **Downloaded!**",
                supportsStreaming: true,
                workers: 16
            });

            fs.removeSync(tempDir);
            process.exit(0);
        }

        // --- c2d / c2v ---
        console.log("🛠 Downloading target file...");
        const pathGetFile = (await axios.get(`${TG_API}/getFile?file_id=${targetFileId}`)).data.result.file_path;
        finalFilePath = path.join(tempDir, `source${path.extname(pathGetFile)}`);
        await downloadFromTelegram(targetFileId, finalFilePath);
        console.log("✅ Target file ready.");

        // --- 1. Identify Thumbnail Path ---
        const globalThumb = path.join(__dirname, 'thumb.jpg');
        if (thumbFileId && thumbFileId !== "null") {
            thumbPath = path.join(tempDir, `thumb_new.jpg`);
            await downloadFromTelegram(thumbFileId, thumbPath);
            console.log("✅ New specific thumbnail ready.");
        } else if (fs.existsSync(globalThumb)) {
            thumbPath = globalThumb;
            console.log("✅ Using global thumb from repo.");
        }

        // --- 2. Process with FFmpeg (Internal Embed) ---
        if (thumbPath && mode !== "c2d") { // Documents don't always need embedding, but videos do
            const embeddedPath = path.join(tempDir, `processed_${Date.now()}.mp4`);
            console.log("🛠 Processing with FFmpeg (Metadata Embed)...");
            // Use mjpeg for better compatibility, -c copy for speed
            execSync(`ffmpeg -i "${finalFilePath}" -i "${thumbPath}" -map 0 -map 1 -c copy -c:v:1 mjpeg -disposition:v:1 attached_pic "${embeddedPath}" -y`);
            finalFilePath = embeddedPath;
        }

        // --- 3. Send File with 'thumb' Parameter (UI Preview) ---
        let isDocument = (mode === "c2d");
        const captionText = isDocument ? "📁 **Converted to Document**" : "✅ **Custom Thumbnail Applied!**";
        
        if (isDocument) {
            // Force Telegram to treat as document by changing extension
            const docPath = finalFilePath + ".document";
            fs.renameSync(finalFilePath, docPath);
            finalFilePath = docPath;
        }

        console.log(`📤 Sending as ${isDocument ? "Document" : "Video"}...`);
        await sendViaFormData(finalFilePath, isDocument, captionText, thumbPath);

        console.log("✨ All done!");
    } catch (err) {
        console.error("❌ Error:", err.message);
        await axios.post(`${TG_API}/sendMessage`, {
            chat_id: chatId,
            text: `❌ Error: ${err.message}`
        });
    }

    fs.removeSync(tempDir);
    process.exit(0);
})();
