import { getStore } from "@netlify/blobs";

const COMPANIES_A =
  "OpenAI, Anthropic, Google DeepMind, Meta AI, xAI, Mistral, DeepSeek, Alibaba Qwen, Amazon, Microsoft";
const COMPANIES_B =
  "NVIDIA, Moonshot AI (Kimi), Zhipu AI (GLM), MiniMax, ByteDance (Doubao/Seed), Cohere, Perplexity, Black Forest Labs, Runway, ElevenLabs";

const modelPrompt = (companies) =>
  `Search the web for the CURRENT latest flagship or newest AI model release from each of these companies: ${companies}. Today is ${new Date().toDateString()}. For each company return its single most important current model (the latest flagship, or the newest notable release if newer).
Respond with ONLY a JSON array, no prose, no markdown. Each object, keys exactly:
co (company), model (model name), ver (version string), date (release date, e.g. "Jun 2026"), cap (primary capability, max 6 words), mode (modalities, e.g. "text+image+audio"), ctx (context window, e.g. "1M"), access (e.g. "API", "open weights", "app"), idx (Artificial Analysis Intelligence Index 0-100, or your best estimate as a number), new (what changed in this release, max 12 words).
Keep every value short. Valid JSON only. No newlines or tabs inside string values.`;

const newsPrompt = () =>
  `Search the web for today's AI industry news (today is ${new Date().toDateString()}). Respond with ONLY a JSON object, no prose, no markdown, keys exactly:
"stories": array of the 5 most important AI news stories from the last 24-48 hours, each with: src (publication), head (headline, your own words), sum (2 sentence summary, your own words), why (one sentence: why it matters to a media founder and producer, max 20 words).
"advice": object with: move (one specific, actionable way to use AI today for someone running a media brand and production company, one sentence, imperative voice), detail (2-3 sentences on exactly how to execute it).
Valid JSON only. No newlines or tabs inside string values.`;

async function callClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  const iArr = clean.indexOf("[");
  const iObj = clean.indexOf("{");
  const i = iArr === -1 ? iObj : iObj === -1 ? iArr : Math.min(iArr, iObj);
  if (i === -1) throw new Error("No JSON found in model response");
  const closer = clean[i] === "[" ? "]" : "}";
  const raw = clean.slice(i, clean.lastIndexOf(closer) + 1);
  let out = "";
  let inStr = false, esc = false;
  for (const ch of raw) {
    if (esc) { out += ch; esc = false; continue; }
    if (ch === "\\") { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && ch === "\n") { out += "\\n"; continue; }
    if (inStr && ch === "\r") { out += "\\r"; continue; }
    if (inStr && ch === "\t") { out += "\\t"; continue; }
    if (inStr && ch.charCodeAt(0) < 0x20) continue;
    out += ch;
  }
  return JSON.parse(out);
}

export async function buildBrief() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }
  const [a, b, news] = await Promise.all([
    callClaude(modelPrompt(COMPANIES_A)),
    callClaude(modelPrompt(COMPANIES_B)),
    callClaude(newsPrompt()),
  ]);
  const snapshot = {
    ts: Date.now(),
    models: [...a, ...b],
    news,
  };
  const store = getStore("aiwire");
  await store.setJSON("snapshot", snapshot);
  return snapshot;
}
