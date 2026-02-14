require("dotenv").config();
const https = require("https");
const fs = require("fs");

const API_KEY = process.env.YOUTUBE_API_KEY;
const input = process.argv[2];

if (!API_KEY || API_KEY === "paste-your-key-here") {
  console.log("ERROR: No YouTube API key found.");
  console.log("");
  console.log("To fix this:");
  console.log('  1. Open the .env file in this folder');
  console.log('  2. Replace "paste-your-key-here" with your real API key');
  console.log("");
  console.log("Don't have a key? Follow the steps at:");
  console.log("  https://console.cloud.google.com/");
  console.log('  Search "YouTube Data API v3" → Enable → Create Credentials → API Key');
  process.exit(1);
}

if (!input) {
  console.log("ERROR: Please provide a YouTube channel URL or handle.");
  console.log('Usage: npm run channel-report -- "https://www.youtube.com/@ChannelName"');
  process.exit(1);
}

// --- Helper: HTTPS GET that returns JSON ---
function apiGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Invalid response from YouTube API"));
        }
      });
    }).on("error", reject);
  });
}

// --- Extract channel handle or ID from URL ---
function parseChannelInput(input) {
  // Handle: @username
  const handleMatch = input.match(/@([\w.-]+)/);
  if (handleMatch) return { type: "handle", value: handleMatch[1] };

  // Channel ID: /channel/UCxxxxx
  const idMatch = input.match(/\/channel\/(UC[\w-]+)/);
  if (idMatch) return { type: "id", value: idMatch[1] };

  // Username: /user/name or /c/name
  const userMatch = input.match(/\/(user|c)\/([\w.-]+)/);
  if (userMatch) return { type: "handle", value: userMatch[2] };

  // Maybe they just typed a handle directly
  if (input.startsWith("@")) return { type: "handle", value: input.slice(1) };

  // Maybe it's a raw channel ID
  if (input.startsWith("UC")) return { type: "id", value: input };

  return { type: "handle", value: input };
}

// --- Look up the channel ID ---
async function getChannelId(parsed) {
  let url;
  if (parsed.type === "id") {
    return parsed.value;
  }

  // Try forHandle first
  url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=${parsed.value}&key=${API_KEY}`;
  let data = await apiGet(url);
  if (data.items && data.items.length > 0) return data.items[0].id;

  // Fallback: search for the channel
  url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(parsed.value)}&maxResults=1&key=${API_KEY}`;
  data = await apiGet(url);
  if (data.items && data.items.length > 0) return data.items[0].snippet.channelId;

  return null;
}

// --- Get the channel's upload playlist ---
async function getUploadsPlaylistId(channelId) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&id=${channelId}&key=${API_KEY}`;
  const data = await apiGet(url);
  if (!data.items || data.items.length === 0) return null;
  return {
    playlistId: data.items[0].contentDetails.relatedPlaylists.uploads,
    channelName: data.items[0].snippet.title,
  };
}

// --- Get recent videos from playlist ---
async function getRecentVideos(playlistId, count) {
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${count}&key=${API_KEY}`;
  const data = await apiGet(url);
  if (!data.items) return [];
  return data.items.map((item) => ({
    videoId: item.snippet.resourceId.videoId,
    title: item.snippet.title,
    publishedAt: item.snippet.publishedAt,
  }));
}

// --- Get view counts for videos ---
async function getVideoStats(videoIds) {
  const ids = videoIds.join(",");
  const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${API_KEY}`;
  const data = await apiGet(url);
  if (!data.items) return {};
  const stats = {};
  for (const item of data.items) {
    stats[item.id] = {
      views: parseInt(item.statistics.viewCount || "0"),
      likes: parseInt(item.statistics.likeCount || "0"),
      comments: parseInt(item.statistics.commentCount || "0"),
    };
  }
  return stats;
}

// --- Format number with commas ---
function formatNumber(n) {
  return n.toLocaleString("en-US");
}

// --- Format date nicely ---
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// --- Generate "What's Working" summary ---
function generateSummary(videos) {
  if (videos.length === 0) return "No videos to analyze.";

  const sorted = [...videos].sort((a, b) => b.views - a.views);
  const totalViews = videos.reduce((sum, v) => sum + v.views, 0);
  const avgViews = Math.round(totalViews / videos.length);

  const top3 = sorted.slice(0, 3);
  const bottom3 = sorted.slice(-3);

  // Find common words in top performing titles
  const stopWords = new Set([
    "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
    "is","am","are","was","were","be","been","have","has","had","do","does","did",
    "will","would","could","should","may","might","can","this","that","it","its",
    "i","you","he","she","we","they","my","your","his","our","their","what","which",
    "who","where","when","how","why","if","not","no","just","also","about","from",
  ]);

  const topWords = {};
  for (const v of top3) {
    const words = v.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
    for (const w of words) {
      if (w.length > 2 && !stopWords.has(w)) {
        topWords[w] = (topWords[w] || 0) + 1;
      }
    }
  }
  const trendingWords = Object.entries(topWords)
    .filter(([_, count]) => count >= 2)
    .map(([word]) => word);

  const lines = [];
  lines.push(`Average views across ${videos.length} videos: ${formatNumber(avgViews)}`);
  lines.push("");
  lines.push("Top performer:");
  lines.push(`  "${top3[0].title}" — ${formatNumber(top3[0].views)} views`);
  lines.push("");

  if (top3[0].views > avgViews * 2) {
    lines.push(`The #1 video got ${Math.round(top3[0].views / avgViews)}x the average views — a clear outlier.`);
  }

  if (trendingWords.length > 0) {
    lines.push(`Recurring themes in top videos: ${trendingWords.join(", ")}`);
  }

  const topAvg = Math.round(top3.reduce((s, v) => s + v.views, 0) / top3.length);
  const bottomAvg = Math.round(bottom3.reduce((s, v) => s + v.views, 0) / bottom3.length);
  if (topAvg > bottomAvg * 1.5) {
    lines.push(`Top 3 videos average ${formatNumber(topAvg)} views vs bottom 3 at ${formatNumber(bottomAvg)} — ${Math.round(topAvg / bottomAvg)}x difference.`);
  }

  // Check posting frequency
  if (videos.length >= 2) {
    const dates = videos.map((v) => new Date(v.publishedAt).getTime()).sort((a, b) => b - a);
    const gaps = [];
    for (let i = 0; i < dates.length - 1; i++) {
      gaps.push((dates[i] - dates[i + 1]) / (1000 * 60 * 60 * 24));
    }
    const avgGap = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
    lines.push(`Posting frequency: roughly every ${avgGap} day${avgGap !== 1 ? "s" : ""}`);
  }

  return lines.join("\n");
}

// --- Main ---
async function main() {
  const parsed = parseChannelInput(input);
  console.log(`Looking up channel...`);

  const channelId = await getChannelId(parsed);
  if (!channelId) {
    console.log("ERROR: Could not find that YouTube channel.");
    console.log("Make sure the URL or handle is correct.");
    process.exit(1);
  }

  const channelInfo = await getUploadsPlaylistId(channelId);
  if (!channelInfo) {
    console.log("ERROR: Could not load channel data.");
    process.exit(1);
  }

  console.log(`Found: ${channelInfo.channelName}`);
  console.log("Fetching recent videos...\n");

  const videos = await getRecentVideos(channelInfo.playlistId, 10);
  if (videos.length === 0) {
    console.log("No videos found on this channel.");
    process.exit(1);
  }

  const stats = await getVideoStats(videos.map((v) => v.videoId));

  // Merge stats into videos
  const enriched = videos.map((v) => ({
    ...v,
    views: stats[v.videoId]?.views || 0,
    likes: stats[v.videoId]?.likes || 0,
    comments: stats[v.videoId]?.comments || 0,
  }));

  // Print report
  console.log("=".repeat(60));
  console.log(`  CHANNEL REPORT: ${channelInfo.channelName}`);
  console.log("=".repeat(60));
  console.log("");
  console.log("--- TOP 10 RECENT VIDEOS ---\n");

  enriched.forEach((v, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${v.title}`);
    console.log(`      Views: ${formatNumber(v.views)}  |  Published: ${formatDate(v.publishedAt)}`);
    console.log("");
  });

  console.log("--- WHAT'S WORKING ---\n");
  console.log(generateSummary(enriched));
  console.log("");
  console.log("=".repeat(60));
}

main();
