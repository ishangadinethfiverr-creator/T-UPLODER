/**
 * GitHub Downloader v7 - Live Progress & 2GB + FFmpeg Thumb Embed
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
const url = process.env.URL;
const targetFileId = process.env.TARGET_FILE_ID;
const targetMessageId = parseInt(process.env.TARGET_MESSAGE_ID);
const newFileName = process.env.NEW_FILE_NAME;
const thumbFileId = process.env.THUMB_FILE_ID;
const editMessageId = parseInt(process.env.EDIT_MESSAGE_ID);

const TG_API = `https://api.telegram.org/bot${botToken}`;
const tempDir = path.join(__dirname, 'temp');

let lastUpdateTime = 0;
async function updateProgress(statusText, currentMb, totalMb, percentStr, speedMb, etaStr) {
    const now = Date.now();
    if (now - lastUpdateTime < 3000 && percentStr !== "100.00") return; // update every 3s
    lastUpdateTime = now;

    const totalBlocks = 15;
    const filledBlocks = Math.round((parseFloat(percentStr) / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;
    const progressBar = "■".repeat(filledBlocks) + "□".repeat(emptyBlocks);

    const text = `🚀 ${statusText} ⚡\n\n${progressBar}\n\n🔗 Size : ${currentMb} MB | ${totalMb} MB\n⏳ Done : ${percentStr}%\n🚀 Speed : ${speedMb} MB/s\n⏰ ETA : ${etaStr}`;
    
    try {
        await axios.post(`${TG_API}/editMessageText`, {
            chat_id: chatId,
            message_id: editMessageId,
            text: text
        });
    } catch (e) {
        // Ignore errors (like message not modified)
    }
}

async function downloadFromTelegramObj(fileId, savePath) {
    const fInfo = await axios.get(`${TG_API}/getFile?file_id=${fileId}`);
    const dUrl = `https://api.telegram.org/file/bot${botToken}/${fInfo.data.result.file_path}`;
    const resp = await axios({ url: dUrl, responseType: 'stream' });
    const writer = fs.createWriteStream(savePath);
    resp.data.pipe(writer);
    await new Promise((r) => writer.on('finish', r));
    return fInfo.data.result.file_path;
}

(async () => {
    console.log(`🚀 v7 - Mode: ${mode}, Chat: ${chatId}`);
    fs.ensureDirSync(tempDir);
    
    // Load GramJS
    const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
    await client.start({ botAuthToken: botToken });

    // --- FETCH MESSAGE FIRST TO DETECT REAL URL ---
    console.log(`🛠 Fetching original message (ID: ${targetMessageId})...`);
    const messages = await client.getMessages(chatId, { ids: [targetMessageId] });
    if (!messages || messages.length === 0) {
        throw new Error("Could not fetch target message.");
    }
    const originalMsg = messages[0];

    // If URL is missing, see if original message text has it
    if (!url || !url.startsWith("http")) {
        const text = originalMsg.message || "";
        const urlMatch = text.match(/https?:\/\/[^\s]+/);
        if (urlMatch) url = urlMatch[0];
    }

    let finalFilePath = "";
    let thumbPath = "";

    try {
        if (url && url.startsWith("http")) {
            // --- URL DOWNLOAD (yt-dlp) ---
            finalFilePath = path.join(tempDir, (newFileName && newFileName.trim() !== '') ? newFileName : `video_${Date.now()}.mp4`);
            console.log("🛠 Downloading from URL: " + url);
            
            await updateProgress("Downloading Media...", "0.0", "0.0", "0.00", "0.0", "0s");

            await new Promise((resolve, reject) => {
                const ytDlp = spawn('yt-dlp', [
                    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                    '--no-check-certificate',
                    '--newline', 
                    '-o', finalFilePath,
                    url
                ]);

                ytDlp.stdout.on('data', async (data) => {
                    const output = data.toString();
                    const regex = /\[download\]\s+([\d\.]+)%\s+of(?:[\s~]+)([\d\.]+)(MiB|GiB|KiB)\s+at\s+([\d\.]+)(MiB|GiB|KiB)\/s\s+ETA\s+([\d:]+)/i;
                    const match = output.match(regex);
                    if (match) {
                        let percentStr = match[1];
                        
                        let totalVal = parseFloat(match[2]);
                        if (match[3].toUpperCase() === "GIB") totalVal *= 1024;
                        if (match[3].toUpperCase() === "KIB") totalVal /= 1024;
                        let totalMb = totalVal.toFixed(2);
                        
                        let speedVal = parseFloat(match[4]);
                        if (match[5].toUpperCase() === "GIB") speedVal *= 1024;
                        if (match[5].toUpperCase() === "KIB") speedVal /= 1024;
                        let speedMb = speedVal.toFixed(2);
                        
                        let currentMb = ((parseFloat(percentStr) / 100) * totalMb).toFixed(2);
                        let etaStr = match[6];
                        
                        await updateProgress("Downloading Media...", currentMb, totalMb, percentStr, speedMb, etaStr);
                    }
                });

                ytDlp.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error("yt-dlp process failed."));
                });
            });

        } else {
            // --- MTProto FILE DOWNLOAD ---
            if (!originalMsg.media) {
                throw new Error("Target message contains no media or URL.");
            }
            console.log("🛠 Downloading target file via MTProto...");
            
            let targetFileName = (newFileName && newFileName.trim() !== '') ? newFileName : "video.mp4";
            if (originalMsg.document && (!newFileName || newFileName.trim() === '')) {
                targetFileName = originalMsg.document.attributes.find(a => a.fileName)?.fileName || targetFileName;
            }
            finalFilePath = path.join(tempDir, targetFileName);

                let startTime = Date.now();
                let lastBytes = 0;
                let lastSpeedTime = startTime;
                let speedBytes = 0;

                await client.downloadMedia(msg.media, {
                    outputFile: finalFilePath,
                    progressCallback: async (downloaded, total) => {
                        const now = Date.now();
                        if (now - lastSpeedTime > 1000) {
                            speedBytes = (downloaded - lastBytes) / ((now - lastSpeedTime) / 1000);
                            lastBytes = downloaded;
                            lastSpeedTime = now;
                        }
                        
                        const percentStr = Number((downloaded / total) * 100).toFixed(2);
                        const currentMb = (downloaded / (1024 * 1024)).toFixed(2);
                        const totalMb = (total / (1024 * 1024)).toFixed(2);
                        const speedMb = (speedBytes / (1024 * 1024)).toFixed(2);
                        
                        let etaSeconds = "0s";
                        if (speedBytes > 0) etaSeconds = Math.round((total - downloaded) / speedBytes) + "s";
                        
                        await updateProgress("Downloading Media...", currentMb, totalMb, percentStr, speedMb, etaSeconds);
                    }
                });
            }
        }
        
        console.log("✅ Target file ready.");

        // --- Embed Thumbnail using FFmpeg ---
        if (thumbFileId && thumbFileId !== "null") {
            try {
                console.log("🛠 Downloading thumbnail...");
                await updateProgress("Processing Thumbnail...", "0.0", "0.0", "100.00", "0.0", "0s");
                
                thumbPath = path.join(tempDir, `thumb.jpg`);
                await downloadFromTelegramObj(thumbFileId, thumbPath);
                console.log("✅ Thumbnail ready.");

                const embeddedPath = path.join(tempDir, `embedded_${Date.now()}.mp4`);
                console.log("🛠 Embedding thumbnail into video with FFmpeg...");
                execSync(`ffmpeg -i "${finalFilePath}" -i "${thumbPath}" -map 0:v -map 0:a? -map 1 -c copy -c:v:1 png -disposition:v:1 attached_pic "${embeddedPath}" -y`);
                finalFilePath = embeddedPath;
                console.log("✅ Thumbnail embedded into video.");
            } catch (e) {
                console.log("Thumbnail embed skipped/failed:", e.message);
            }
        }

        // --- UPLOAD VIA MTProto ---
        const isDocument = (mode === "c2d");
        const captionStr = isDocument ? "📁 **Converted to Document**" : "✅ **Ready & Processed!**";
        console.log(`📤 Sending as ${isDocument ? "Document" : "Video"}...`);

        let upStartTime = Date.now();
        let upLastBytes = 0;
        let upLastSpeedTime = upStartTime;
        let upSpeedBytes = 0;

        await client.sendFile(chatId, {
            file: finalFilePath,
            thumb: thumbPath || undefined,
            forceDocument: isDocument,
            caption: captionStr,
            supportsStreaming: true,
            workers: 16,
            progressCallback: async (uploaded, total) => {
                const now = Date.now();
                if (now - upLastSpeedTime > 1000) {
                    upSpeedBytes = (uploaded - upLastBytes) / ((now - upLastSpeedTime) / 1000);
                    upLastBytes = uploaded;
                    upLastSpeedTime = now;
                }

                const percentStr = Number((uploaded / total) * 100).toFixed(2);
                const currentMb = (uploaded / (1024 * 1024)).toFixed(2);
                const totalMb = (total / (1024 * 1024)).toFixed(2);
                const speedMb = (upSpeedBytes / (1024 * 1024)).toFixed(2);
                
                let etaSeconds = "0s";
                if (upSpeedBytes > 0) etaSeconds = Math.round((total - uploaded) / upSpeedBytes) + "s";

                await updateProgress(`Uploading ${isDocument ? "Document" : "Video"}...`, currentMb, totalMb, percentStr, speedMb, etaSeconds);
            }
        });

        console.log("✨ All done!");
        
        // Remove progress message softly
        await axios.post(`${TG_API}/deleteMessage`, {
            chat_id: chatId,
            message_id: editMessageId
        }).catch(() => {});

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
