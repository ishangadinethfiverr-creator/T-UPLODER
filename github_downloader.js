/**
 * GitHub Downloader - Original Stable (Fast Version)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const botToken = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const mode = process.env.MODE || "c2v"; 
const url = process.env.URL;
const targetFileId = process.env.TARGET_FILE_ID;

const TG_API = `https://api.telegram.org/bot${botToken}`;
const tempDir = path.join(__dirname, 'temp');

async function sendStatus(text) {
    try {
        await axios.post(`${TG_API}/sendMessage`, { chat_id: chatId, text: text });
    } catch (e) {}
}

async function downloadFromTelegram(fileId, savePath) {
    const fInfo = await axios.get(`${TG_API}/getFile?file_id=${fileId}`);
    const dUrl = `https://api.telegram.org/file/bot${botToken}/${fInfo.data.result.file_path}`;
    const resp = await axios({ url: dUrl, responseType: 'stream' });
    const writer = fs.createWriteStream(savePath);
    resp.data.pipe(writer);
    await new Promise((r) => writer.on('finish', r));
}

(async () => {
    fs.ensureDirSync(tempDir);
    console.log("🚀 Starting Original Stable Downloader...");

    try {
        let filePath = path.join(tempDir, `file_${Date.now()}.mp4`);

        if (url && url.startsWith("http")) {
            // Download from URL
            console.log("🛠 Downloading URL...");
            await new Promise((resolve, reject) => {
                const yt = spawn('yt-dlp', ['-f', 'best[ext=mp4]', '-o', filePath, url]);
                yt.on('close', (code) => code === 0 ? resolve() : reject(new Error("yt-dlp failed")));
            });
        } else if (targetFileId) {
            // Download from Telegram
            console.log("🛠 Downloading Telegram File...");
            await downloadFromTelegram(targetFileId, filePath);
        } else {
            throw new Error("Nothing to download.");
        }

        // Upload back to Telegram
        const method = (mode === "c2d") ? "sendDocument" : "sendVideo";
        const formData = new (require('form-data'))();
        formData.append('chat_id', chatId);
        formData.append(method === "sendDocument" ? 'document' : 'video', fs.createReadStream(filePath));
        formData.append('caption', "✅ Processed Successfully!");

        await axios.post(`${TG_API}/${method}`, formData, {
            headers: formData.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        console.log("✅ Done!");

    } catch (err) {
        console.error("❌ Error:", err.message);
        await sendStatus(`❌ Error: ${err.message}`);
    }

    fs.removeSync(tempDir);
    process.exit(0);
})();
