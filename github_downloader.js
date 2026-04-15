/**
 * GitHub Downloader Stable v8 - Simple & Fast
 */

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { execSync, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const mode = process.env.MODE || "c2v"; 
const targetMessageId = parseInt(process.env.TARGET_MESSAGE_ID);
const thumbFileId = process.env.THUMB_FILE_ID;
const editMessageId = parseInt(process.env.EDIT_MESSAGE_ID);

const TG_API = `https://api.telegram.org/bot${botToken}`;
const tempDir = path.join(__dirname, 'temp');

let lastUpdateTime = 0;
async function updateProgress(statusText, currentMb, totalMb, percentStr, speedMb, etaStr) {
    const now = Date.now();
    if (now - lastUpdateTime < 3000 && percentStr !== "100.00") return;
    lastUpdateTime = now;

    const totalBlocks = 15;
    const filledBlocks = Math.round((parseFloat(percentStr) / 100) * totalBlocks);
    const progressBar = "■".repeat(filledBlocks) + "□".repeat(emptyBlocks = totalBlocks - filledBlocks);

    const text = `🚀 ${statusText}\n\n${progressBar}\n\n🔗 Size : ${currentMb} MB | ${totalMb} MB\n⏳ Done : ${percentStr}%\n🚀 Speed : ${speedMb} MB/s\n⏰ ETA : ${etaStr}`;
    
    try {
        await axios.post(`${TG_API}/editMessageText`, {
            chat_id: chatId,
            message_id: editMessageId,
            text: text
        });
    } catch (e) {}
}

async function downloadFromTelegramObj(fileId, savePath) {
    const fInfo = await axios.get(`${TG_API}/getFile?file_id=${fileId}`);
    const dUrl = `https://api.telegram.org/file/bot${botToken}/${fInfo.data.result.file_path}`;
    const resp = await axios({ url: dUrl, responseType: 'stream' });
    const writer = fs.createWriteStream(savePath);
    resp.data.pipe(writer);
    await new Promise((r) => writer.on('finish', r));
}

(async () => {
    console.log(`🚀 Stable v8 - Chat: ${chatId}, MsgID: ${targetMessageId}`);
    fs.ensureDirSync(tempDir);
    
    const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
    await client.start({ botAuthToken: botToken });

    let finalFilePath = "";
    let thumbPath = "";

    try {
        // --- FETCH ORIGINAL MESSAGE ---
        const messages = await client.getMessages(chatId, { ids: [targetMessageId] });
        if (!messages || messages.length === 0) throw new Error("Could not fetch message.");
        const originalMsg = messages[0];

        // --- DETECT URL OR MEDIA ---
        let url = "";
        const text = originalMsg.message || "";
        const urlMatch = text.match(/https?:\/\/[^\s]+/);
        if (urlMatch) url = urlMatch[0];

        if (url && url.startsWith("http")) {
            // --- yt-dlp DOWNLOAD ---
            finalFilePath = path.join(tempDir, `video_${Date.now()}.mp4`);
            console.log("🛠 Downloading from URL: " + url);
            await updateProgress("Downloading URL Media...", "0", "0", "0", "0", "0s");

            await new Promise((resolve, reject) => {
                const ytDlp = spawn('yt-dlp', [
                    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                    '--no-check-certificate', '--newline', '-o', finalFilePath, url
                ]);
                ytDlp.on('close', (code) => code === 0 ? resolve() : reject(new Error("yt-dlp failed.")));
            });
        } else if (originalMsg.media) {
            // --- MTProto DOWNLOAD ---
            console.log("🛠 Downloading via MTProto...");
            let fileName = "file.mp4";
            if (originalMsg.document) fileName = originalMsg.document.attributes.find(a => a.fileName)?.fileName || fileName;
            finalFilePath = path.join(tempDir, fileName);

            await client.downloadMedia(originalMsg.media, {
                outputFile: finalFilePath,
                progressCallback: async (downloaded, total) => {
                    const percent = ((downloaded / total) * 100).toFixed(2);
                    const curr = (downloaded / 1048576).toFixed(2);
                    const tot = (total / 1048576).toFixed(2);
                    await updateProgress("Downloading Media...", curr, tot, percent, "MTProto", "Live");
                }
            });
        } else {
            throw new Error("No media or link found in message.");
        }

        // --- OPTIONAL THUMBNAIL ---
        if (thumbFileId && thumbFileId !== "null") {
            try {
                thumbPath = path.join(tempDir, `thumb.jpg`);
                await downloadFromTelegramObj(thumbFileId, thumbPath);
                
                const embeddedPath = path.join(tempDir, `processed_${Date.now()}.mp4`);
                execSync(`ffmpeg -i "${finalFilePath}" -i "${thumbPath}" -map 0:v -map 0:a? -map 1 -c copy -c:v:1 png -disposition:v:1 attached_pic "${embeddedPath}" -y`);
                finalFilePath = embeddedPath;
            } catch (e) {
                console.log("Thumb embed failed, skipping...");
            }
        }

        // --- UPLOAD ---
        const isDoc = (mode === "c2d");
        await updateProgress("Uploading to Telegram...", "0", "0", "0", "MTProto", "⏳");
        
        await client.sendFile(chatId, {
            file: finalFilePath,
            thumb: thumbPath || undefined,
            forceDocument: isDoc,
            caption: isDoc ? "📁 **Document Format**" : "🎬 **Video Format**",
            supportsStreaming: true,
            workers: 16
        });

        console.log("✅ Success!");
        await axios.post(`${TG_API}/deleteMessage`, { chat_id: chatId, message_id: editMessageId }).catch(() => {});

    } catch (err) {
        console.error("❌ Error:", err.message);
        await axios.post(`${TG_API}/editMessageText`, {
            chat_id: chatId,
            message_id: editMessageId,
            text: `❌ Error: ${err.message}`
        });
    }

    fs.removeSync(tempDir);
    process.exit(0);
})();
