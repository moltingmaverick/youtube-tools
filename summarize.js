const fs = require("fs");

// --- Read the transcript ---
if (!fs.existsSync("transcript.txt")) {
  console.log("ERROR: No transcript.txt file found!");
  console.log("Paste your YouTube transcript into a file called transcript.txt first.");
  process.exit(1);
}

const text = fs.readFileSync("transcript.txt", "utf-8").trim();
if (!text) {
  console.log("ERROR: transcript.txt is empty!");
  process.exit(1);
}

// --- Common words to ignore when finding important topics ---
const stopWords = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
  "is","am","are","was","were","be","been","being","have","has","had","do",
  "does","did","will","would","could","should","may","might","shall","can",
  "this","that","these","those","it","its","i","you","he","she","we","they",
  "me","him","her","us","them","my","your","his","our","their","what","which",
  "who","whom","where","when","how","why","if","then","than","so","not","no",
  "just","also","very","really","about","up","out","all","some","any","each",
  "from","into","over","after","before","between","under","again","there",
  "here","more","most","other","like","know","think","going","get","got",
  "go","come","make","take","see","say","said","one","two","thing","things",
  "way","much","many","well","even","because","through","right","dont","im",
  "thats","youre","ive","weve","theyre","youve","gonna","want","something",
  "actually","people","lot","kind","still","back","now","new","good","first",
  "need","look","different","around","every","down","let","put","yeah","okay",
  "oh","um","uh","hey","stuff","basically","literally"
]);

// --- Split text into sentences ---
function getSentences(text) {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);
}

// --- Count how often each meaningful word appears ---
function getWordFrequency(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
  const freq = {};
  for (const w of words) {
    if (w.length > 2 && !stopWords.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  return freq;
}

// --- Score each sentence by how many important words it contains ---
function scoreSentences(sentences, freq) {
  return sentences.map((sentence, index) => {
    const words = sentence.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
    let score = 0;
    for (const w of words) {
      score += freq[w] || 0;
    }
    // Boost earlier sentences slightly (intros often contain key points)
    score *= 1 + 0.2 / (1 + index * 0.1);
    return { sentence, score, index };
  });
}

// --- Main ---
const sentences = getSentences(text);
const freq = getWordFrequency(text);
const scored = scoreSentences(sentences, freq);

// Pick top sentences for summary (keep them in original order)
const summaryCount = Math.min(Math.max(3, Math.floor(sentences.length * 0.1)), 10);
const topSentences = scored
  .sort((a, b) => b.score - a.score)
  .slice(0, summaryCount)
  .sort((a, b) => a.index - b.index)
  .map(s => s.sentence);

// Pick top keywords as key takeaways
const topKeywords = Object.entries(freq)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .map(([word]) => word);

// --- Output ---
const wordCount = text.split(/\s+/).length;
console.log("=".repeat(50));
console.log("  TRANSCRIPT SUMMARY");
console.log("=".repeat(50));
console.log(`\nWord count: ${wordCount} words\n`);

console.log("--- SUMMARY ---\n");
topSentences.forEach(s => console.log(`  - ${s}\n`));

console.log("--- KEY TOPICS ---\n");
console.log(`  ${topKeywords.join(", ")}\n`);

console.log("--- KEY TAKEAWAYS ---\n");
// Build takeaways from highest-scored sentences
const takeaways = scored
  .sort((a, b) => b.score - a.score)
  .slice(0, 5)
  .map(s => {
    // Shorten to first ~100 chars if needed
    let t = s.sentence;
    if (t.length > 120) t = t.substring(0, 117) + "...";
    return t;
  });
takeaways.forEach((t, i) => console.log(`  ${i + 1}. ${t}\n`));

console.log("=".repeat(50));
