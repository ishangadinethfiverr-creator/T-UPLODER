/**
GitHub Downloader v11 - Production Ready (All Errors Fixed)
*/
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { execSync } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const mode = process.env.MODE || "download";
const url = process.env.URL;
const targetFileId = process.env.TARGET_FILE_ID;
const thumbFileId = process.env.THUMB_FILE_ID;
const newName = process.env.NEW_NAME;
const TG_API = `https://api.telegram.org/bot${botToken}`;
const tempDir = path.join(__dirname, "temp");
const CHANNEL = "@IDS_UPLOADER";
const stringSession = new StringSession("");

function humanBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getDuration(filePath) {
  try {
    const raw = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`).toString().trim();
    const sec = Math.floor(parseFloat(raw));
    if (isNaN(sec)) return "N/A";
    return new Date(sec * 1000).toISOString().substring(11, 19);
  } catch { return "N/A"; }
}

(async () => {
  console.log("🚀 v11 | Mode: " + mode + " | Chat: " + chatId);
  fs.ensureDirSync(tempDir);
  let finalFilePath = "";
  let thumbPath = null;
  const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
  await client.start({ botAuthToken: botToken });

  try {
    // ══════════════ 1. DOWNLOAD ══════════════
    if (mode === "download" || mode === "dl_audio") {
      console.log("⬇️ Downloading via yt-dlp (" + mode + ")...");
      if (mode === "dl_audio") {
        finalFilePath = path.join(tempDir, "audio_" + Date.now() + ".mp3");
        execSync('yt-dlp -f bestaudio --extract-audio --audio-format mp3 --no-check-certificate -o "' + finalFilePath + '" "' + url + '"', { stdio: "inherit" });
      } else {
        finalFilePath = path.join(tempDir, "video_" + Date.now() + ".mp4");
        execSync('yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --no-check-certificate --merge-output-format mp4 -o "' + finalFilePath + '" "' + url + '"', { stdio: "inherit" });
      }
    } else {
      console.log("⬇️ Downloading target file from Telegram...");
      const getFile = await axios.get(TG_API + "/getFile?file_id=" + targetFileId);
      const origExt = path.extname(getFile.data.result.file_path) || ".mp4";
      finalFilePath = path.join(tempDir, "source" + origExt);
      const dUrl = "https://api.telegram.org/file/bot" + botToken + "/" + getFile.data.result.file_path;
      const flow = await axios({ url: dUrl, responseType: "stream" });
      const writer = fs.createWriteStream(finalFilePath);
      flow.data.pipe(writer);
      await new Promise((resolve, reject) => { writer.on("finish", resolve); writer.on("error", reject); });
      console.log("✅ Target file downloaded.");
    }

    // ══════════════ 2. GET THUMBNAIL ══════════════
    const isDoc = (mode === "c2d");

    if (thumbFileId && thumbFileId !== "null" && thumbFileId !== "undefined") {
      const rawThumb = path.join(tempDir, "raw_thumb.jpg");
      console.log("🛠 Downloading Custom Thumbnail...");
      try {
        const tInfo = await axios.get(TG_API + "/getFile?file_id=" + thumbFileId);
        const tUrl = "https://api.telegram.org/file/bot" + botToken + "/" + tInfo.data.result.file_path;
        const tr = await axios({ url: tUrl, responseType: "stream" });
        const tw = fs.createWriteStream(rawThumb);
        tr.data.pipe(tw);
        await new Promise((resolve) => tw.on("finish", resolve));

        thumbPath = path.join(tempDir, "thumb_320.jpg");
        execSync('ffmpeg -i "' + rawThumb + '" -vf "scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2" -qscale:v 5 -frames:v 1 -y "' + thumbPath + '"', { stdio: "inherit" });
        console.log("✅ Custom Thumbnail standardized.");
      } catch (e) {
        console.log("⚠️ Failed to process custom thumbnail.", e.message);
        thumbPath = null;
      }
    }

    // ══════════════ 3. BRANDING & RENAMING ══════════════
    if (mode === "c2v") {
      const outPath = path.join(tempDir, "branded_" + Date.now() + ".mp4");
      console.log("🛠 Injecting metadata...");
      const origExt = path.extname(finalFilePath) || ".mp4";
      const actualNamePart = newName || path.basename(finalFilePath, origExt);
      const cmd = 'ffmpeg -i "' + finalFilePath + '" -c copy -metadata title="' + actualNamePart + '" -metadata author="' + CHANNEL + '" -metadata comment="Processed by IDS" -y "' + outPath + '"';
      execSync(cmd, { stdio: "inherit" });
      finalFilePath = outPath;
    }

    let displayName = path.basename(finalFilePath, path.extname(finalFilePath));
    let sendPath = finalFilePath;
    const finalExt = isDoc ? (path.extname(finalFilePath) || ".mp4") : ((mode === "dl_audio") ? ".mp3" : ".mp4");

    if (newName) {
      displayName = newName;
      const renamedPath = path.join(tempDir, newName + finalExt);
      if (finalFilePath !== renamedPath) fs.copySync(finalFilePath, renamedPath);
      sendPath = renamedPath;
    } else {
      let cleanName = displayName.replace(/^(source|branded|video|audio)_?/, "") || "IDS_Media";
      const renamedPath = path.join(tempDir, cleanName + finalExt);
      if (finalFilePath !== renamedPath) fs.copySync(finalFilePath, renamedPath);
      sendPath = renamedPath;
      displayName = cleanName;
    }

    // ══════════════ 4. UPLOAD ══════════════
    console.log("📤 Uploading as " + (isDoc ? "Document" : "Video/Audio") + "...");
    const stats = fs.statSync(sendPath);
    const fileSize = humanBytes(stats.size);
    const duration = (mode === "c2v") ? getDuration(sendPath) : "N/A";

    const captionText = 
      "<b>💎 IDS MOVIE PLANET</b>\n\n" +
      (mode === "dl_audio" ? "🎵 " : (isDoc ? "📁 " : "🎥 ")) + "<b>Name:</b> <code>" + displayName + "</code>\n" +
      "📦 <b>Size:</b> <code>" + fileSize + "</code>\n" +
      (mode === "c2v" ? "⏰ <b>Duration:</b> <code>" + duration + "</code>\n" : "") +
      "\n🏷 <b>By:</b> " + CHANNEL;

    // ✅ FIXED: thumbnail works for BOTH Video AND Document
    await client.sendFile(chatId, {
      file: sendPath,
      thumb: (thumbPath && fs.existsSync(thumbPath)) ? thumbPath : undefined,
      forceDocument: isDoc,
      caption: captionText,
      parseMode: "html",
      supportsStreaming: !isDoc,
      workers: 16
    });

    console.log("✨ Mission complete!");
  } catch (err) {
    console.error("❌ Fatal Error:", err.message);
    await axios.post(TG_API + "/sendMessage", {
      chat_id: chatId, parse_mode: "HTML",
      text: "❌ <b>Error:</b>\n<code>" + err.message.substring(0, 500) + "</code>"
    }).catch(() => {});
  }
  fs.removeSync(tempDir);
  process.exit(0);
})();
