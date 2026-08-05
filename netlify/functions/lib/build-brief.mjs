import { getStore } from "@netlify/blobs";

const AA_MODELS_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
const NEWSAPI_URL = "https://newsapi.org/v2/everything";
const NEWS_MODEL = "claude-sonnet-4-6";
const ASSIGNMENT_MODEL = "claude-sonnet-5";

function blobStore() {
  return getStore(process.env.BLOB_STORE_NAME || "aiwire");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatContextWindow(tokens) {
  const n = Number(tokens);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(0)}K`;
  }
  return String(n);
}

function formatReleaseDate(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function modalityLabel(modality) {
  if (!modality) return "text generation";
  if (typeof modality === "string") {
    const m = modality.toLowerCase();
    if (m.includes("image") || m.includes("audio") || m.includes("video") || m.includes("+")) {
      return "multimodal reasoning";
    }
    if (m.includes("code")) return "code generation";
    return "text generation";
  }
  if (typeof modality === "object") {
    const parts = [];
    for (const [k, v] of Object.entries(modality)) {
      if (v) parts.push(k);
    }
    if (parts.some((p) => /image|audio|video|vision/i.test(p))) return "multimodal reasoning";
  }
  return "text generation";
}

function formatModality(modality) {
  if (!modality) return "text";
  if (typeof modality === "string") return modality;
  if (typeof modality === "object") {
    const parts = Object.entries(modality)
      .filter(([, v]) => v)
      .map(([k]) => k.replace(/_/g, ""));
    return parts.length ? parts.join("+") : "text";
  }
  return "text";
}

function parseJsonFromText(text) {
  const clean = String(text || "").replace(/```json|```/g, "").trim();
  const iArr = clean.indexOf("[");
  const iObj = clean.indexOf("{");
  const i = iArr === -1 ? iObj : iObj === -1 ? iArr : Math.min(iArr, iObj);
  if (i === -1) throw new Error("No JSON found in model response");
  const closer = clean[i] === "[" ? "]" : "}";
  const raw = clean.slice(i, clean.lastIndexOf(closer) + 1);
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of raw) {
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr && ch === "\n") {
      out += "\\n";
      continue;
    }
    if (inStr && ch === "\r") {
      out += "\\r";
      continue;
    }
    if (inStr && ch === "\t") {
      out += "\\t";
      continue;
    }
    if (inStr && ch.charCodeAt(0) < 0x20) continue;
    out += ch;
  }
  return JSON.parse(out);
}

async function callClaude(prompt, { model, webSearch = false, maxTokens = 2000, label = "claude" } = {}) {
  const maxAttempts = 5;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const body = {
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      };
      if (webSearch) {
        body.tools = [{ type: "web_search_20250305", name: "web_search" }];
      }
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.text();
        const err = new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 300)}`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      const text = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const parsed = parseJsonFromText(text);
      if (attempt > 1) console.log(`[${label}] succeeded on attempt ${attempt}`);
      return parsed;
    } catch (e) {
      lastErr = e;
      const retriable =
        e.status === 429 || e.status === 502 || e.status === 503 || e.status === 529 || !e.status;
      console.warn(`[${label}] attempt ${attempt} failed: ${e.message.slice(0, 150)}`);
      if (!retriable || attempt === maxAttempts) break;
      const delay = Math.min(30000, 2000 * Math.pow(2, attempt - 1)) + Math.random() * 1000;
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Frontier companies: best single model from each, matched against AA creator names. */
const FRONTIER_COMPANIES = [
  { label: "OpenAI", match: (co) => /openai/i.test(co) },
  { label: "Anthropic", match: (co) => /anthropic/i.test(co) },
  { label: "Google DeepMind", match: (co) => /google|deepmind/i.test(co) },
  { label: "xAI", match: (co) => /\bxai\b|spacexai/i.test(co) },
  { label: "Meta", match: (co) => /^(meta|facebook)\b|\bmeta ai\b/i.test(co) },
  { label: "DeepSeek", match: (co) => /deepseek/i.test(co) },
  { label: "Alibaba (Qwen)", match: (co) => /alibaba|qwen/i.test(co) },
  { label: "Mistral", match: (co) => /mistral/i.test(co) },
];

function modelKey(co, model) {
  return `${String(co || "").trim()}|${String(model || "").trim()}`;
}

/** Calendar date in America/New_York as YYYY-MM-DD. */
function todayEtDateStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function parseYmd(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Calendar days on the frontier list: "1 day on list", "2 days on list", … */
function streakLabel(firstDateStr, todayStr) {
  const days = Math.round((parseYmd(todayStr) - parseYmd(firstDateStr)) / 86_400_000);
  const n = !Number.isFinite(days) || days <= 0 ? 1 : days + 1;
  return n === 1 ? "1 day on list" : `${n} days on list`;
}

function modelUrlFromAA(m) {
  const raw = m.url || m.model_page_url || m.model_url || m.page_url || "";
  if (typeof raw === "string") {
    const url = raw.trim();
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("/")) return `https://artificialanalysis.ai${url}`;
  }
  // AA list endpoint has no url field — public pages are /models/{slug}.
  const slug = typeof m.slug === "string" ? m.slug.trim() : "";
  if (slug) return `https://artificialanalysis.ai/models/${encodeURIComponent(slug)}`;
  return "";
}

function mapAAModel(m) {
  const idx = m?.evaluations?.artificial_analysis_intelligence_index;
  if (idx == null || !Number.isFinite(Number(idx))) return null;
  const modality = m.modality ?? m.modalities ?? null;
  const ctxTokens = m.context_window ?? m.context_window_tokens ?? null;
  const co = m.model_creator?.name || m.creator?.name || "Unknown";
  const model = m.name || "";
  return {
    co,
    model,
    ver: m.version || "",
    date: formatReleaseDate(m.release_date || m.releaseDate || m.released_at || ""),
    cap: modalityLabel(modality),
    mode: formatModality(modality),
    ctx: formatContextWindow(ctxTokens),
    access: m.access || m.licensing?.type || "API",
    idx: Math.round(Number(idx)),
    url: modelUrlFromAA(m),
    new: "",
  };
}

/**
 * Group AA models by lab, keep each lab's highest-scoring model,
 * return up to `limit` labs ranked by that best index.
 */
export function fetchAllLabsFromAA(mapped, limit = 20) {
  const bestByLab = new Map();
  for (const m of mapped) {
    const lab = String(m.co || "Unknown").trim() || "Unknown";
    const prev = bestByLab.get(lab);
    if (!prev || m.idx > prev.idx) bestByLab.set(lab, m);
  }
  return [...bestByLab.values()]
    .sort((a, b) => b.idx - a.idx)
    .slice(0, limit)
    .map((m) => ({
      co: m.co,
      model: m.model,
      idx: m.idx,
      url: m.url || "",
    }));
}

/**
 * Fetch models from Artificial Analysis.
 * Returns { frontier, all, streaks } where frontier is the top 7 tracked
 * labs, all is up to 20 labs each represented by their best model, and
 * streaks is the persisted first-seen map written to the blob store.
 */
export async function fetchModelsFromAA() {
  if (!process.env.AA_API_KEY) {
    throw new Error("AA_API_KEY environment variable is not set");
  }
  const headers = {
    Accept: "application/json",
    "x-api-key": process.env.AA_API_KEY,
  };

  const res = await fetch(AA_MODELS_URL, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Artificial Analysis API ${res.status}: ${body.slice(0, 300)}`);
  }

  const payload = await res.json();
  const rows = Array.isArray(payload) ? payload : payload.data || payload.models || [];

  const mapped = rows.map(mapAAModel).filter(Boolean);
  if (!mapped.length) {
    throw new Error("Artificial Analysis returned no models with intelligence index");
  }

  const sorted = mapped.slice().sort((a, b) => b.idx - a.idx);

  // One row per lab: best model, top 20 labs by intelligence index.
  const all = fetchAllLabsFromAA(mapped, 20);

  // Best model per frontier lab, then keep the top 7 labs by intelligence index.
  const frontier = [];
  for (const company of FRONTIER_COMPANIES) {
    const best = sorted.find((m) => company.match(m.co));
    if (!best) continue;
    frontier.push({
      ...best,
      co: company.label,
      new: "",
    });
  }
  frontier.sort((a, b) => b.idx - a.idx);
  frontier.splice(7);

  const store = blobStore();
  const streaks = (await store.get("model-streaks", { type: "json" })) || {};
  const today = todayEtDateStr();
  const nextStreaks = { ...streaks };

  for (const m of frontier) {
    const key = modelKey(m.co, m.model);
    if (!nextStreaks[key]) nextStreaks[key] = today;
    m.streak = streakLabel(nextStreaks[key], today);
  }

  await store.setJSON("model-streaks", nextStreaks);
  console.log(
    `AA models fetched: frontier=${frontier.length}, labs=${all.length}, streaks=${Object.keys(nextStreaks).length}`,
  );
  return { frontier, all, streaks: nextStreaks };
}

/** Fetch recent AI headlines from NewsAPI, then pick/format top 5 via Claude. */
export async function fetchNewsFromNewsAPI() {
  if (!process.env.NEWSAPI_KEY) {
    throw new Error("NEWSAPI_KEY environment variable is not set");
  }

  const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    q: '("AI" OR "artificial intelligence" OR "LLM") AND (release OR launch OR funding OR breakthrough OR regulation)',
    sortBy: "publishedAt",
    language: "en",
    pageSize: "20",
    from,
    apiKey: process.env.NEWSAPI_KEY,
  });

  const res = await fetch(`${NEWSAPI_URL}?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`NewsAPI ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const articles = (data.articles || [])
    .filter((a) => a?.title && a?.url)
    .slice(0, 20)
    .map((a) => ({
      title: a.title,
      source: a.source?.name || "Unknown",
      url: a.url,
    }));

  if (!articles.length) throw new Error("NewsAPI returned no articles");

  const prompt = `From these 20 recent AI news headlines, pick the 5 most important representing diverse angles (product release, business/funding, regulation, research, culture). Return JSON only, no prose. Each story: src (publication name), head (original headline), sum (2 sentence summary based on the headline), url (original URL), why (one sentence why it matters to a media founder, max 20 words).

Headlines:
${JSON.stringify(articles)}`;

  const parsed = await callClaude(prompt, {
    model: NEWS_MODEL,
    webSearch: false,
    maxTokens: 2500,
    label: "news",
  });

  const stories = Array.isArray(parsed) ? parsed : parsed.stories;
  if (!Array.isArray(stories) || stories.length < 1) {
    throw new Error("Claude news formatting returned no stories");
  }

  const byUrl = new Map(articles.map((a) => [a.url, a]));
  const normalized = stories.slice(0, 5).map((s) => {
    const match = byUrl.get(s.url) || articles.find((a) => a.title === s.head);
    return {
      src: s.src || match?.source || "Unknown",
      head: s.head || match?.title || "",
      sum: s.sum || "",
      url: s.url || match?.url || "",
      why: s.why || "",
    };
  });

  console.log(`News stories formatted: ${normalized.length}`);
  return { stories: normalized };
}

/** Today's Assignment — Claude Sonnet 5 with web search, callable independently. */
export async function fetchAssignment() {
  const prompt = `Search the web for useful AI productivity practices (today is ${new Date().toDateString()}). Respond with ONLY a JSON object, no prose, no markdown, keys exactly:
"move" (one specific, actionable way to use AI TODAY to work faster, smarter, or more creatively, focused on productivity, workflow, decision-making, communication, research, or content creation, one sentence, imperative voice. Not about coding, software development, or building apps.),
"detail" (2-3 sentences on exactly how to execute it as a busy operator/founder).
Valid JSON only. No newlines or tabs inside string values.`;

  const advice = await callClaude(prompt, {
    model: ASSIGNMENT_MODEL,
    webSearch: true,
    maxTokens: 1000,
    label: "assignment",
  });

  if (!advice?.move || !advice?.detail) {
    throw new Error("Assignment response missing move/detail");
  }
  console.log("Assignment fetched");
  return advice;
}

export async function buildBrief() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }
  console.log("Building brief…");

  const store = blobStore();
  const prior =
    (await store.get("snapshot", { type: "json" })) || {
      models: { frontier: [], all: [] },
      news: { stories: [], advice: {} },
    };

  const results = await Promise.allSettled([
    fetchModelsFromAA(),
    fetchNewsFromNewsAPI(),
    fetchAssignment(),
  ]);
  const [modelsRes, newsRes, adviceRes] = results;

  const modelsPayload = modelsRes.status === "fulfilled" ? modelsRes.value : null;
  const newsPayload = newsRes.status === "fulfilled" ? newsRes.value : null;
  const advice = adviceRes.status === "fulfilled" ? adviceRes.value : null;

  if (!modelsPayload && !newsPayload && !advice) {
    const errs = results
      .map((r) => (r.status === "rejected" ? r.reason?.message : "ok"))
      .join(" | ");
    throw new Error("All three calls failed: " + errs);
  }

  for (const [label, res] of [
    ["models", modelsRes],
    ["news", newsRes],
    ["assignment", adviceRes],
  ]) {
    if (res.status === "rejected") {
      console.warn(`[${label}] failed, using prior snapshot data: ${res.reason?.message?.slice(0, 150)}`);
    }
  }

  const priorModels = normalizeModelsPayload(prior.models);
  const models = modelsPayload
    ? { frontier: modelsPayload.frontier, all: modelsPayload.all }
    : priorModels;

  const snapshot = {
    ts: Date.now(),
    models,
    news: {
      stories: newsPayload?.stories || prior.news?.stories || [],
      advice: advice || prior.news?.advice || {},
    },
    partial: !(modelsPayload && newsPayload && advice),
  };

  await store.setJSON("snapshot", snapshot);
  console.log(
    `Brief saved. frontier=${snapshot.models.frontier.length}, all=${snapshot.models.all.length}, news=${snapshot.news.stories.length}, partial=${snapshot.partial}`,
  );
  return snapshot;
}

/** Normalize legacy array snapshots into { frontier, all }. */
function normalizeModelsPayload(models) {
  if (!models) return { frontier: [], all: [] };
  if (Array.isArray(models)) return { frontier: models, all: models };
  return {
    frontier: Array.isArray(models.frontier) ? models.frontier : [],
    all: Array.isArray(models.all) ? models.all : [],
  };
}
