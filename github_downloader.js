/**
 * GitHub Downloader v8 Ultimate - Bug Fixed & Secured
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
const CHANNEL_NAME = "<b>@IDS_UPLOADER</b>"; 

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
    form.append('parse_mode', 'HTML');
    if (thumbPath && fs.existsSync(thumbPath)) {
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

function humanBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

(async () => {
    console.log(`🚀 v8 Ultimate - Mode: ${mode}, Chat: ${chatId}`);
    fs.ensureDirSync(tempDir);
    let finalFilePath = "";
    let thumbPath = "";

    try {
        if (mode === "download") {
            const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
            await client.start({ botAuthToken: botToken });
            finalFilePath = path.join(tempDir, `video_${Date.now()}.mp4`);
            console.log("🛠 Downloading via yt-dlp...");
            execSync(`yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best" -o "${finalFilePath}" "${url}"`);
            
            await client.sendFile(chatId, { 
                file: finalFilePath, 
                caption: "<b>✅ Downloaded via IDS Bot!</b>", 
                parseMode: "html",
                supportsStreaming: true 
            });
            fs.removeSync(tempDir);
            process.exit(0);
        }

        // --- c2d / c2v ---
        const pathGetFile = (await axios.get(`${TG_API}/getFile?file_id=${targetFileId}`)).data.result.file_path;
        const originalExt = path.extname(pathGetFile) || ".mp4";
        finalFilePath = path.join(tempDir, `source${originalExt}`);
        await downloadFromTelegram(targetFileId, finalFilePath);

        // --- 1. Identify & Resize Thumbnail ---
        const globalThumb = path.join(__dirname, 'thumb.jpg');
        let rawThumb = "";
        if (thumbFileId && thumbFileId !== "null" && thumbFileId !== "undefined") {
            rawThumb = path.join(tempDir, 'raw_thumb.jpg');
            await downloadFromTelegram(thumbFileId, rawThumb);
        } else if (fs.existsSync(globalThumb)) {
            rawThumb = globalThumb;
        }

        if (rawThumb) {
            console.log("🛠 Standardizing thumbnail (320x320)...");
            thumbPath = path.join(tempDir, 'thumb_320.jpg');
            execSync(`ffmpeg -i "${rawThumb}" -vf "scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2" -frames:v 1 -y "${thumbPath}"`);
        }

        // --- 2. Process with Metadata (Branding) ---
        if (mode !== "c2d") {
            const outPath = path.join(tempDir, `branded_${Date.now()}.mp4`);
            let cmd = `ffmpeg -i "${finalFilePath}" `;
            if (thumbPath) cmd += `-i "${thumbPath}" -map 0 -map 1 -c:v:1 mjpeg -disposition:v:1 attached_pic `;
            else cmd += `-map 0 `;
            cmd += `-c copy -metadata title="${path.basename(finalFilePath)}" -metadata author="${CHANNEL_NAME.replace(/<[^>]*>/g, '')}" -y "${outPath}"`;
            execSync(cmd);
            finalFilePath = outPath;
        }

        // --- 3. Send to Telegram ---
        const stats = fs.statSync(finalFilePath);
        const fileSize = humanBytes(stats.size);
        let durationStr = "N/A";
        try {
            const probe = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalFilePath}"`).toString().trim();
            const sec = Math.floor(parseFloat(probe));
            durationStr = new Date(sec * 1000).toISOString().substr(11, 8);
        } catch(e) {}

        const isDoc = (mode === "c2d");
        const filename = path.basename(finalFilePath);
        const caption = `<b>💎 IDS MOVIE PLANET</b>\n\n` +
                        `🎥 <b>Name:</b> <code>${filename}</code>\n` + 
                        `📦 <b>Size:</b> <code>${fileSize}</code>\n` + 
                        `⏰ <b>Duration:</b> <code>${durationStr}</code>\n\n` + 
                        `🏷 <b>By:</b> ${CHANNEL_NAME}`;

        console.log(`📤 Uploading as ${isDoc ? "Document" : "Video"}...`);
        await sendViaFormData(finalFilePath, isDoc, caption, thumbPath);
        console.log("✨ All tasks completed!");

    } catch (err) {
        console.error("❌ Error:", err.message);
        await axios.post(`${TG_API}/sendMessage`, { chat_id: chatId, text: `❌ **Error:** ${err.message}` });
    }
    fs.removeSync(tempDir);
    process.exit(0);
})();
