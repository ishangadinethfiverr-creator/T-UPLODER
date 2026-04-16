/**
 * GitHub Downloader v10 - Full Fix
 * ✅ BUG 2 FIX: FFmpeg command order fixed (-c copy BEFORE -c:v:1 mjpeg)
 * ✅ BUG 3 FIX: c2d → sendDocument, no thumb append for documents
 * ✅ newName → actual file rename on disk (Telegram shows correct filename)
 * ✅ writer error catch added
 * ✅ dl_audio mode added
 */

const { TelegramClient } = require("telegram");
const { StringSession }  = require("telegram/sessions");
const { execSync }       = require("child_process");
const fs                 = require("fs-extra");
const path               = require("path");
const axios              = require("axios");
const FormData           = require("form-data");

const apiId        = parseInt(process.env.API_ID);
const apiHash      = process.env.API_HASH;
const botToken     = process.env.BOT_TOKEN;
const chatId       = process.env.CHAT_ID;
const mode         = process.env.MODE || "download";
const url          = process.env.URL;
const targetFileId = process.env.TARGET_FILE_ID;
const thumbFileId  = process.env.THUMB_FILE_ID;
const newName      = process.env.NEW_NAME;

const TG_API  = `https://api.telegram.org/bot${botToken}`;
const tempDir = path.join(__dirname, "temp");
const CHANNEL = "@IDS_UPLOADER"; // ← ඔබේ channel

// ─── Helpers ───────────────────────────────────────────

async function downloadFromTelegram(fileId, savePath) {
  const res  = await axios.get(`${TG_API}/getFile?file_id=${fileId}`);
  const dUrl = `https://api.telegram.org/file/bot${botToken}/${res.data.result.file_path}`;
  const resp = await axios({ url: dUrl, responseType: "stream" });
  const writer = fs.createWriteStream(savePath);
  resp.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject); // ✅ error catch
  });
  return res.data.result.file_path;
}

async function sendViaFormData(filePath, isDocument, caption, thumbPath) {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("parse_mode", "HTML");

  // ✅ BUG 3 FIX: Document mode හි thumb append නොකරන්න
  // (Telegram sendDocument + thumb causes video-like display on some clients)
  if (!isDocument && thumbPath && fs.existsSync(thumbPath)) {
    console.log("📎 Attaching thumbnail to video...");
    form.append("thumb", fs.createReadStream(thumbPath));
  }

  if (isDocument) {
    form.append("document", fs.createReadStream(filePath));
    console.log("📤 Sending as Document...");
  } else {
    form.append("video", fs.createReadStream(filePath));
    form.append("supports_streaming", "true");
    console.log("📤 Sending as Video...");
  }

  const endpoint = isDocument ? "sendDocument" : "sendVideo";
  const resp = await axios.post(`${TG_API}/${endpoint}`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 0
  });

  if (resp.data && !resp.data.ok) {
    throw new Error(`Telegram error: ${JSON.stringify(resp.data)}`);
  }
  return resp.data;
}

function humanBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function getDuration(filePath) {
  try {
    const raw = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    ).toString().trim();
    const sec = Math.floor(parseFloat(raw));
    if (isNaN(sec)) return "N/A";
    return new Date(sec * 1000).toISOString().substr(11, 8);
  } catch { return "N/A"; }
}

async function sendError(msg) {
  await axios.post(`${TG_API}/sendMessage`, {
    chat_id: chatId,
    parse_mode: "HTML",
    text: `❌ <b>Error:</b>\n<code>${msg.substring(0, 500)}</code>`
  }).catch(() => {});
}

// ─── Main ───────────────────────────────────────────────

(async () => {
  console.log(`🚀 v10 | Mode: ${mode} | Chat: ${chatId}`);
  fs.ensureDirSync(tempDir);

  let finalFilePath = "";
  let thumbPath     = "";

  try {

    // ══════════════ DOWNLOAD MODE (yt-dlp) ══════════════
    if (mode === "download") {
      const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
        connectionRetries: 5
      });
      await client.start({ botAuthToken: botToken });

      finalFilePath = path.join(tempDir, `video_${Date.now()}.mp4`);
      console.log("⬇️ Downloading via yt-dlp...");

      // ✅ Robust format selector with fallbacks
      execSync(
        `yt-dlp ` +
        `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" ` +
        `--no-check-certificate ` +
        `--merge-output-format mp4 ` +
        `-o "${finalFilePath}" ` +
        `"${url}"`,
        { stdio: "inherit" }
      );

      const stats    = fs.statSync(finalFilePath);
      const fileSize = humanBytes(stats.size);
      const fname    = newName ? `${newName}.mp4` : path.basename(finalFilePath);

      await client.sendFile(chatId, {
        file: finalFilePath,
        caption:
          `<b>✅ Downloaded!</b>\n\n` +
          `🎥 <b>Name:</b> <code>${fname}</code>\n` +
          `📦 <b>Size:</b> <code>${fileSize}</code>\n\n` +
          `🏷 <b>By:</b> ${CHANNEL}`,
        parseMode: "html",
        supportsStreaming: true,
        workers: 16
      });

      console.log("✨ Download complete!");
      fs.removeSync(tempDir);
      process.exit(0);
    }

    // ══════════════ AUDIO DOWNLOAD MODE ══════════════
    if (mode === "dl_audio") {
      finalFilePath = path.join(tempDir, `audio_${Date.now()}.mp3`);
      console.log("⬇️ Downloading audio via yt-dlp...");
      execSync(
        `yt-dlp -f bestaudio --extract-audio --audio-format mp3 ` +
        `--no-check-certificate ` +
        `-o "${finalFilePath}" "${url}"`,
        { stdio: "inherit" }
      );
      const stats    = fs.statSync(finalFilePath);
      const fileSize = humanBytes(stats.size);
      const form     = new FormData();
      form.append("chat_id", chatId);
      form.append("audio", fs.createReadStream(finalFilePath));
      form.append("caption", `🎵 <b>Audio Downloaded!</b>\n📦 <b>Size:</b> <code>${fileSize}</code>\n🏷 <b>By:</b> ${CHANNEL}`);
      form.append("parse_mode", "HTML");
      await axios.post(`${TG_API}/sendAudio`, form, {
        headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity
      });
      console.log("✨ Audio complete!");
      fs.removeSync(tempDir);
      process.exit(0);
    }

    // ══════════════ C2V / C2D MODE ══════════════
    console.log("⬇️ Downloading target file from Telegram...");
    const getFile = await axios.get(`${TG_API}/getFile?file_id=${targetFileId}`);
    const origExt = path.extname(getFile.data.result.file_path) || ".mp4";
    finalFilePath  = path.join(tempDir, `source${origExt}`);
    await downloadFromTelegram(targetFileId, finalFilePath);
    console.log("✅ Target file ready:", path.basename(finalFilePath));

    // ── Thumbnail ──
    const globalThumb = path.join(__dirname, "thumb.jpg");
    let rawThumb = "";

    if (thumbFileId === "repo") {
      if (fs.existsSync(globalThumb)) {
        rawThumb = globalThumb;
        console.log("✅ Using repo thumbnail.");
      } else {
        console.warn("⚠️ Repo thumb.jpg not found!");
      }
    } else if (thumbFileId && thumbFileId !== "null" && thumbFileId !== "undefined") {
      rawThumb = path.join(tempDir, "raw_thumb.jpg");
      await downloadFromTelegram(thumbFileId, rawThumb);
      console.log("✅ Custom thumbnail downloaded.");
    } else if (fs.existsSync(globalThumb)) {
      rawThumb = globalThumb;
      console.log("✅ Using repo thumbnail (auto).");
    }

    if (rawThumb) {
      console.log("🛠 Standardizing thumbnail to 320x320...");
      thumbPath = path.join(tempDir, "thumb_320.jpg");
      execSync(
        `ffmpeg -i "${rawThumb}" ` +
        `-vf "scale=320:320:force_original_aspect_ratio=decrease,` +
        `pad=320:320:(ow-iw)/2:(oh-ih)/2" ` +
        `-frames:v 1 -y "${thumbPath}"`,
        { stdio: "inherit" }
      );
      console.log("✅ Thumbnail standardized.");
    }

    // ── FFmpeg: Metadata + Thumb embed (c2v only) ──
    if (mode === "c2v") {
      const outPath = path.join(tempDir, `branded_${Date.now()}.mp4`);
      console.log("🛠 Injecting metadata + thumbnail...");

      let cmd = `ffmpeg -i "${finalFilePath}" `;
      if (thumbPath) {
        cmd += `-i "${thumbPath}" `;
        // ✅ BUG 2 FIX: -c copy FIRST, then -c:v:1 mjpeg to override
        cmd += `-map 0 -map 1 -c copy -c:v:1 mjpeg -disposition:v:1 attached_pic `;
      } else {
        cmd += `-map 0 -c copy `;
      }
      cmd +=
        `-metadata title="${path.basename(finalFilePath, origExt)}" ` +
        `-metadata author="${CHANNEL}" ` +
        `-metadata comment="Processed by IDS" ` +
        `-y "${outPath}"`;

      execSync(cmd, { stdio: "inherit" });
      finalFilePath = outPath;
      console.log("✅ Metadata injected.");
    }

    // ── Caption ──
    const stats    = fs.statSync(finalFilePath);
    const fileSize = humanBytes(stats.size);
    const duration = mode === "c2v" ? getDuration(finalFilePath) : "N/A";
    const isDoc    = mode === "c2d";

    // ✅ newName: actual file rename on disk so Telegram shows correct filename
    let sendPath = finalFilePath;
    let displayName = path.basename(finalFilePath, path.extname(finalFilePath));

    if (newName) {
      displayName = newName;
      const newExt     = isDoc ? origExt : ".mp4";
      const renamedPath = path.join(tempDir, `${newName}${newExt}`);
      fs.copySync(finalFilePath, renamedPath);
      sendPath = renamedPath;
      console.log(`✅ File renamed to: ${path.basename(renamedPath)}`);
    }

    const caption =
      `<b>💎 IDS MOVIE PLANET</b>\n\n` +
      `🎥 <b>Name:</b> <code>${displayName}</code>\n` +
      `📦 <b>Size:</b> <code>${fileSize}</code>\n` +
      (mode === "c2v" ? `⏰ <b>Duration:</b> <code>${duration}</code>\n` : "") +
      `\n🏷 <b>By:</b> ${CHANNEL}`;

    // ✅ BUG 3 FIX: sendViaFormData isDoc=true → sendDocument (no thumb for doc)
    await sendViaFormData(sendPath, isDoc, caption, thumbPath);
    console.log("✨ Mission complete!");

  } catch (err) {
    console.error("❌ Error:", err.message);
    await sendError(err.message);
  }

  fs.removeSync(tempDir);
  process.exit(0);
})();
