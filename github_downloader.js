/**
 * GitHub Downloader v12 - PRO VERSION
 *  - Fast Mode: Instant re-delivery with Custom Thumbnail (No Download)
 *  - Worker Boost: 16x Download / 32x Upload for normal modes
 *  - Professional FFmpeg Mapping
 */
const { TelegramClient, Api } = require("telegram");
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
const targetFileId = process.env.TARGET_FILE_ID;
const sourceMsgId = parseInt(process.env.SOURCE_MSG_ID);
const thumbFileId = process.env.THUMB_FILE_ID;
const newName = process.env.NEW_NAME;
const TG_API = `https://api.telegram.org/bot${botToken}`;
const tempDir = path.join(__dirname, "temp");
const CHANNEL = "@IDS_UPLOADER";

function humanBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

(async () => {
  console.log(`🚀 v12 Pro-Server | Mode: ${mode} | Starting...`);
  fs.ensureDirSync(tempDir);
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
  await client.start({ botAuthToken: botToken });

  try {
    let thumbPath = null;

    // ══════════════ 1. PREPARE THUMBNAIL ══════════════
    if (thumbFileId && thumbFileId !== "null" && thumbFileId !== "undefined") {
      console.log("🛠 Downloading Custom Thumbnail...");
      const rawThumb = path.join(tempDir, "raw_thumb.jpg");
      try {
        const tInfo = await axios.get(`${TG_API}/getFile?file_id=${thumbFileId}`);
        const tr = await axios({ url: `https://api.telegram.org/file/bot${botToken}/${tInfo.data.result.file_path}`, responseType: 'stream' });
        const tw = fs.createWriteStream(rawThumb);
        tr.data.pipe(tw);
        await new Promise((res) => tw.on('finish', res));

        thumbPath = path.join(tempDir, "std_thumb.jpg");
        execSync(`ffmpeg -i "${rawThumb}" -vf "scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2,format=yuv420p" -qscale:v 5 -frames:v 1 -y "${thumbPath}"`);
        console.log("✅ Thumbnail ready.");
      } catch (e) { console.log("⚠️ Thumb error:", e.message); }
    }

    // ══════════════ 2. DISTRIBUTE BY MODE ══════════════

    if (mode === "fast") {
      console.log("⚡ FAST MODE: Re-sending via Remote ID...");
      const msgs = await client.getMessages(chatId, { ids: [sourceMsgId] });
      if (msgs && msgs[0]?.media) {
        await client.sendFile(chatId, {
          file: msgs[0].media, // MTProto Reference (Instant)
          thumb: thumbPath,
          caption: `<b>💎 IDS MOVIE PLANET - FAST</b>\n\n<b>Name:</b> <code>${newName || "Original"}</code>\n🏷 <b>By:</b> ${CHANNEL}`,
          parseMode: "html",
          forceDocument: false
        });
        console.log("✅ Fast delivery complete!");
      }
    } 
    else {
      // ══════════════ 3. DOWNLOAD (Normal Modes) ══════════════
      console.log("⬇️ Downloading via GramJS (Workers: 16)...");
      const localSource = path.join(tempDir, "source_file");
      const msgs = await client.getMessages(chatId, { ids: [sourceMsgId] });
      
      if (!msgs || msgs.length === 0 || !msgs[0].media) throw new Error("Could not fetch source message/media");
      
      await client.downloadMedia(msgs[0].media, { 
        outputFile: localSource, 
        workers: 16 
      });
      console.log("✅ Download finished.");

      let processPath = localSource;

      // ══════════════ 4. PROCESS (c2v / c2d) ══════════════
      if (mode === "c2v") {
        console.log("🛠 Remuxing for Video Mode (Embedding Thumb)...");
        const outPath = path.join(tempDir, "processed.mp4");
        const cmd = thumbPath 
          ? `ffmpeg -i "${localSource}" -i "${thumbPath}" -map 0:v:0 -map 0:a? -map 1 -c copy -c:v:1 mjpeg -disposition:v:1 attached_pic -y "${outPath}"`
          : `ffmpeg -i "${localSource}" -c copy -y "${outPath}"`;
        execSync(cmd, { stdio: "inherit" });
        processPath = outPath;
      }

      // Final Renaming
      const extension = (mode === "dl_audio") ? ".mp3" : ".mp4";
      const finalFileName = `${newName || "File"}${extension}`;
      const renamedPath = path.join(tempDir, finalFileName);
      fs.copySync(processPath, renamedPath);

      // ══════════════ 5. UPLOAD ══════════════
      console.log("📤 Uploading (Workers: 32)...");
      const stats = fs.statSync(renamedPath);
      await client.sendFile(chatId, {
        file: renamedPath,
        thumb: thumbPath,
        forceDocument: (mode === "c2d"),
        caption: `<b>💎 IDS MOVIE PLANET</b>\n\n<b>Name:</b> <code>${newName}</code>\n📦 <b>Size:</b> <code>${humanBytes(stats.size)}</code>\n\n🏷 <b>By:</b> ${CHANNEL}`,
        parseMode: "html",
        supportsStreaming: (mode !== "c2d"),
        workers: 32
      });
    }

    console.log("✨ Mission complete!");
  } catch (err) {
    console.error("❌ Fatal Error:", err);
  }
  
  fs.removeSync(tempDir);
  process.exit(0);
})();
