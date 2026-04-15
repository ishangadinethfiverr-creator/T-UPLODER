/**
 * Cloudflare Worker - Original Stable (Fast Version)
 */

const BOT_TOKEN = "8782359868:AAGLuGGwmzMkefsf8KFG4pzekkpXxalRAMU";
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const GITHUB_REPO = "ishanga200345-ux/T-UPLODER";
const GITHUB_TOKEN = "github_pat_11BI6N7LY0U4Z53bIn0H2f_M7lVbe8Xm5aW2D6tObeByY7kQOfD62f8WvWk9N9H9H9K4X6X6X6X6X6X6";

export default {
  async fetch(request) {
    if (request.method === "POST") {
      try {
        const payload = await request.json();

        if (payload.message) {
          const msg = payload.message;
          const chatId = msg.chat.id;
          const text = msg.text || "";

          const caption = msg.caption || "";

          // --- /set_thumb Logic (Save to GitHub Repo) ---
          if (caption.startsWith("/set_thumb") && msg.photo) {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            
            // 1. Get file path from TG
            const fInfo = await (await fetch(`${TG_API}/getFile?file_id=${fileId}`)).json();
            const filePath = fInfo.result.file_path;
            
            // 2. Download file as arrayBuffer then convert to Base64
            const imgResp = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
            const imgBuffer = await imgResp.arrayBuffer();
            const base64Content = btoa(String.fromCharCode(...new Uint8Array(imgBuffer)));

            // 3. Get existing file SHA (to update)
            const getRef = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/thumb.jpg`, {
              headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'Cloudflare-Worker' }
            });
            let sha = null;
            if (getRef.ok) {
              const data = await getRef.json();
              sha = data.sha;
            }

            // 4. Push to GitHub
            const putRef = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/thumb.jpg`, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Cloudflare-Worker'
              },
              body: JSON.stringify({
                message: "Update global thumbnail",
                content: base64Content,
                sha: sha
              })
            });

            const reply = putRef.ok ? "✅ **Global Thumbnail updated!**\nIt is now saved in your GitHub repository." : "❌ **Failed to update thumbnail.** Check GitHub Token permissions.";
            await fetch(`${TG_API}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: reply, parse_mode: "Markdown" })
            });
            return new Response("OK");
          }

          let targetFileId = null;
          if (msg.video) targetFileId = msg.video.file_id;
          else if (msg.document) targetFileId = msg.document.file_id;
          else if (msg.photo) targetFileId = msg.photo[msg.photo.length - 1].file_id;

          const urlMatch = text.match(/https?:\/\/[^\s]+/);
          const url = urlMatch ? urlMatch[0] : null;

          if (url || targetFileId) {
            // Determine mode
            let mode = "download";
            if (text.startsWith("/c2d") || caption.startsWith("/c2d")) mode = "c2d";
            else if (text.startsWith("/c2v") || caption.startsWith("/c2v")) mode = "c2v";

            // Trigger GitHub
            await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Cloudflare-Worker'
              },
              body: JSON.stringify({
                event_type: 'start_download',
                client_payload: {
                  mode: mode,
                  url: url,
                  chat_id: chatId.toString(),
                  target_file_id: targetFileId,
                  thumb_file_id: null // Will use the one in repo if null
                }
              })
            });

            await fetch(`${TG_API}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: `🚀 **Triggered: ${mode.toUpperCase()}**\nProcessing on GitHub server...`
              })
            });
          }
        }
      } catch (e) { }
    }
    return new Response("OK");
  }
};
