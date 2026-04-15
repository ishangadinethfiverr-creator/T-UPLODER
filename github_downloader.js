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

async function sendViaFormData(filePath, isDocument, caption) {
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

    const endpoint = isDocument ? 'sendDocument' : 'sendVideo';
    await axios.post(`${TG_API}/${endpoint}`, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    });
}

(async () => {
    console.log(`🚀 v6 - Mode: ${mode}, Chat: ${chatId}`);
    fs.ensureDirSync(tempDir);

    let finalFilePath = "";
    let thumbPath = "";

    try {
        if (mode === "download") {
            // GramJS for large downloads
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
        const tgPath = await downloadFromTelegram(targetFileId, path.join(tempDir, `source${path.extname((await axios.get(`${TG_API}/getFile?file_id=${targetFileId}`)).data.result.file_path)}`));
        finalFilePath = path.join(tempDir, `source${path.extname(tgPath)}`);
        console.log("✅ Target file ready.");

        // --- Embed Thumbnail using FFmpeg ---
        if (thumbFileId && thumbFileId !== "null") {
            console.log("🛠 Downloading thumbnail...");
            thumbPath = path.join(tempDir, `thumb.jpg`);
            await downloadFromTelegram(thumbFileId, thumbPath);
            console.log("✅ Thumbnail ready.");

            // Embed thumbnail directly into the video file metadata
            const embeddedPath = path.join(tempDir, `embedded_${Date.now()}.mp4`);
            console.log("🛠 Embedding thumbnail into video with FFmpeg...");
            execSync(`ffmpeg -i "${finalFilePath}" -i "${thumbPath}" -map 0:v -map 0:a? -map 1 -c copy -c:v:1 png -disposition:v:1 attached_pic "${embeddedPath}" -y`);
            finalFilePath = embeddedPath;
            console.log("✅ Thumbnail embedded into video.");
        }

        // --- Send File ---
        const isDocument = (mode === "c2d");
        const caption = isDocument ? "📁 **Converted to Document**" : "✅ **Custom Thumbnail Applied!**";
        console.log(`📤 Sending as ${isDocument ? "Document" : "Video"}...`);
        await sendViaFormData(finalFilePath, isDocument, caption);

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
