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
"advice": object with: move (one specific, actionable way to use AI TODAY to work faster, smarter, or more creatively, focused on productivity, workflow, decision-making, communication, research, or content creation, one sentence, imperative voice. Not about coding, software development, or building apps.), detail (2-3 sentences on exactly how to execute it as a busy operator/founder).
Valid JSON only. No newlines or tabs inside string values.`;

const MODELS = ["claude-sonnet-5", "claude-sonnet-4-6"];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callClaudeOnce(prompt, model) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
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

async function callClaude(prompt, label) {
  const maxAttempts = 5;
  let lastErr;
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await callClaudeOnce(prompt, model);
        if (attempt > 1 || model !== MODELS[0]) {
          console.log(`[${label}] succeeded on ${model} attempt ${attempt}`);
        }
        return result;
      } catch (e) {
        lastErr = e;
        const retriable = e.status === 429 || e.status === 502 || e.status === 503 || e.status === 529 || !e.status;
        console.warn(`[${label}] ${model} attempt ${attempt} failed: ${e.message.slice(0, 150)}`);
        if (!retriable) break;
        if (attempt < maxAttempts) {
          const delay = Math.min(30000, 2000 * Math.pow(2, attempt - 1)) + Math.random() * 1000;
          await sleep(delay);
        }
      }
    }
    console.warn(`[${label}] falling back to next model after ${model}`);
  }
  throw lastErr;
}

export async function buildBrief() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }
  console.log("Building brief…");
  const results = await Promise.allSettled([
    callClaude(modelPrompt(COMPANIES_A), "models-A"),
    callClaude(modelPrompt(COMPANIES_B), "models-B"),
    callClaude(newsPrompt(), "news"),
  ]);
  const [aRes, bRes, newsRes] = results;
  const store = getStore("aiwire");
  const prior = (await store.get("snapshot", { type: "json" })) || { models: [], news: { stories: [], advice: {} } };
  const modelsA = aRes.status === "fulfilled" ? aRes.value : null;
  const modelsB = bRes.status === "fulfilled" ? bRes.value : null;
  const news = newsRes.status === "fulfilled" ? newsRes.value : null;
  if (!modelsA && !modelsB && !news) {
    const errs = results.map((r) => (r.status === "rejected" ? r.reason?.message : "ok")).join(" | ");
    throw new Error("All three calls failed: " + errs);
  }
  const combinedModels = [...(modelsA || []), ...(modelsB || [])];
  const snapshot = {
    ts: Date.now(),
    models: combinedModels.length ? combinedModels : prior.models,
    news: news || prior.news,
    partial: !(modelsA && modelsB && news),
  };
  await store.setJSON("snapshot", snapshot);
  console.log(`Brief saved. models=${snapshot.models.length}, news=${snapshot.news?.stories?.length ?? 0}, partial=${snapshot.partial}`);
  return snapshot;
}
