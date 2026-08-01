// Module-level log runs during Lambda init, before the handler.
// If you never see this, the function bundle failed to load.
console.log("REFRESH MODULE EVALUATED");

export default async (req) => {
  console.log("REFRESH STARTED", {
    method: req?.method ?? req?.httpMethod ?? null,
    ts: Date.now(),
  });

  try {
    const method = req?.method ?? req?.httpMethod;
    if (method !== "POST") {
      console.log("REFRESH REJECTED: method", method);
      return;
    }

    const secret = process.env.REFRESH_SECRET;
    if (!secret) {
      console.error("REFRESH REJECTED: REFRESH_SECRET is not set");
      return;
    }

    const provided = readHeader(req, "x-refresh-key");
    if (provided !== secret) {
      console.error("REFRESH REJECTED: wrong passphrase");
      return;
    }

    console.log("REFRESH AUTH OK — importing build-brief…", {
      hasAnthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      hasAA: Boolean(process.env.AA_API_KEY),
      hasNews: Boolean(process.env.NEWSAPI_KEY),
      blobStore: process.env.BLOB_STORE_NAME || "aiwire",
    });

    // Dynamic import so a build-brief load failure still leaves STARTED logs.
    const { buildBrief } = await import("./lib/build-brief.mjs");
    console.log("REFRESH AUTH OK — building brief…");
    await buildBrief();
    console.log("Manual refresh complete");
  } catch (e) {
    console.error("Manual refresh failed:", e?.stack || e?.message || String(e));
  } finally {
    console.log("REFRESH FINISHED");
  }
};

function readHeader(req, name) {
  if (req?.headers && typeof req.headers.get === "function") {
    return req.headers.get(name) || "";
  }
  const headers = req?.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers["X-Refresh-Key"] || "";
}

// Background mode comes from the *-background filename.
// Do not also set config.background — dual declaration has caused empty, short runs.
