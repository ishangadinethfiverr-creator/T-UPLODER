/**
 * GitHub Downloader v5 - Bot API Multipart for Thumbnail
 * Uses native Bot API for c2d/c2v (100% thumb support)
 * Uses GramJS only for large file downloads
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
    return savePath;
}

async function sendWithBotAPI(filePath, thumbPath, isDocument, caption) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('parse_mode', 'Markdown');

    if (isDocument) {
        form.append('document', fs.createReadStream(filePath));
    } else {
        form.append('video', fs.createReadStream(filePath));
        form.append('supports_streaming', 'true');
    }

    if (thumbPath && fs.existsSync(thumbPath)) {
        form.append('thumbnail', fs.createReadStream(thumbPath));
    }

    const endpoint = isDocument ? 'sendDocument' : 'sendVideo';
    const resp = await axios.post(`${TG_API}/${endpoint}`, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    });

    return resp.data;
}

(async () => {
    console.log(`🚀 v5 - Mode: ${mode}, Chat: ${chatId}`);

    fs.ensureDirSync(tempDir);

    let finalFilePath = "";
    let thumbPath = "";

    try {
        // --- 1. GET TARGET FILE ---
        if (mode === "download") {
            // Use GramJS for large file downloads
            const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
            await client.start({ botAuthToken: botToken });

            finalFilePath = path.join(tempDir, `video_${Date.now()}.mp4`);
            execSync(`yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --no-check-certificate -o "${finalFilePath}" "${url}"`);

            await client.sendFile(chatId, {
                file: finalFilePath,
                caption: "✅ **Downloaded Successfully!**",
                supportsStreaming: true,
                workers: 16
            });

            fs.removeSync(tempDir);
            process.exit(0);
        }

        // --- c2d / c2v: Use Bot API Multipart (100% Thumb Support) ---
        console.log("🛠 Downloading target file from Telegram...");
        const fInfo = await axios.get(`${TG_API}/getFile?file_id=${targetFileId}`);
        const ext = path.extname(fInfo.data.result.file_path) || '.mp4';
        finalFilePath = path.join(tempDir, `file_${Date.now()}${ext}`);
        await downloadFromTelegram(targetFileId, finalFilePath);
        console.log("✅ Target file downloaded.");

        // --- 2. GET THUMBNAIL ---
        if (thumbFileId && thumbFileId !== "null") {
            console.log("🛠 Downloading thumbnail...");
            thumbPath = path.join(tempDir, `thumb.jpg`);
            await downloadFromTelegram(thumbFileId, thumbPath);
            console.log("✅ Thumbnail downloaded.");
        }

        // --- 3. SEND VIA BOT API (Multipart - Native Thumb Support) ---
        console.log("📤 Sending via Bot API...");
        const isDocument = (mode === "c2d");
        const caption = isDocument ? "📁 **Converted to Document**" : "✅ **Custom Thumbnail Applied!**";
        await sendWithBotAPI(finalFilePath, thumbPath, isDocument, caption);

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
