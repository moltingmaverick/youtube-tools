const fs = require("fs");
const https = require("https");

// Get the YouTube URL from the command line
const url = process.argv[2];

if (!url) {
  console.log("ERROR: Please provide a YouTube URL.");
  console.log('Usage: npm run fetch -- "https://www.youtube.com/watch?v=xxxxx"');
  process.exit(1);
}

// Extract video ID from various YouTube URL formats
function getVideoId(url) {
  const patterns = [
    /(?:v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    }}, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\\n/g, " ")
    .replace(/\\\"/g, '"');
}

async function fetchTranscript(videoId) {
  // Step 1: Get the video page to find the transcript params
  console.log("Downloading video page...");
  const pageHtml = await httpsGet(`https://www.youtube.com/watch?v=${videoId}`);

  // Look for captions data in the page
  const captionsMatch = pageHtml.match(/"captions":\s*(\{.*?"playerCaptionsTracklistRenderer".*?\})\s*,\s*"videoDetails"/s);
  if (!captionsMatch) {
    // Try alternate pattern
    const altMatch = pageHtml.match(/"captionTracks":\s*(\[.*?\])/s);
    if (!altMatch) {
      throw new Error("No captions found on this video.");
    }
    const tracks = JSON.parse(altMatch[1]);
    if (tracks.length === 0) throw new Error("No caption tracks available.");

    // Prefer English
    const track = tracks.find(t => t.languageCode === "en") || tracks[0];
    return await downloadCaptions(track.baseUrl);
  }

  // Parse caption tracks
  const tracksMatch = pageHtml.match(/"captionTracks":\s*(\[.*?\])/s);
  if (!tracksMatch) throw new Error("No caption tracks found.");

  const tracks = JSON.parse(tracksMatch[1]);
  if (tracks.length === 0) throw new Error("No caption tracks available.");

  // Prefer English, fall back to first available
  const track = tracks.find(t => t.languageCode === "en") || tracks[0];
  console.log(`Found captions: ${track.name?.simpleText || track.languageCode}`);

  return await downloadCaptions(track.baseUrl);
}

async function downloadCaptions(baseUrl) {
  // Download the caption XML
  const captionUrl = decodeHtmlEntities(baseUrl);
  console.log("Downloading captions...");
  const xml = await httpsGet(captionUrl);

  // Parse the XML to extract text
  const textParts = [];
  const regex = /<text[^>]*>(.*?)<\/text>/gs;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    let text = match[1];
    text = decodeHtmlEntities(text);
    text = text.replace(/<[^>]+>/g, ""); // strip any HTML tags
    if (text.trim()) textParts.push(text.trim());
  }

  if (textParts.length === 0) throw new Error("Captions were empty.");
  return textParts.join(" ");
}

async function main() {
  const videoId = getVideoId(url);
  if (!videoId) {
    console.log("ERROR: Could not find a valid YouTube video ID in that URL.");
    console.log("Make sure you paste the full URL, like: https://www.youtube.com/watch?v=xxxxx");
    process.exit(1);
  }

  console.log(`Fetching transcript for video: ${videoId}...`);

  try {
    const text = await fetchTranscript(videoId);
    fs.writeFileSync("transcript.txt", text, "utf-8");
    const wordCount = text.split(/\s+/).length;
    console.log(`\nDone! Saved ${wordCount} words to transcript.txt`);
    console.log("Now run: npm run summarize");
  } catch (err) {
    console.log(`\nERROR: ${err.message}`);
    console.log("\nPossible reasons:");
    console.log("  - The video doesn't have captions/subtitles");
    console.log("  - The video is private or age-restricted");
    console.log("  - YouTube is blocking requests from this server");
    console.log("\nTry the manual method instead:");
    console.log('  1. Open the video in your browser');
    console.log('  2. Click "...More" → "Show transcript"');
    console.log('  3. Copy the text into transcript.txt');
    console.log('  4. Run: npm run summarize');
    process.exit(1);
  }
}

main();
