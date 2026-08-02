/**
 * Daily cron (7am ET / 11:00 UTC).
 *
 * Scheduled functions hard-timeout at 30s. buildBrief() regularly exceeds that
 * (Claude + web search), so this handler only kicks the background worker and
 * returns. The worker has a 15-minute budget and writes the snapshot.
 */
export default async () => {
  const secret = process.env.REFRESH_SECRET;
  if (!secret) {
    console.error("Scheduled refresh: REFRESH_SECRET is not set");
    return new Response("missing secret", { status: 500 });
  }

  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    console.error("Scheduled refresh: URL env var is not set");
    return new Response("missing url", { status: 500 });
  }

  const workerUrl = new URL("/.netlify/functions/refresh-background", base);
  console.log("Scheduled refresh invoking worker", workerUrl.href);

  try {
    const workerRes = await fetch(workerUrl, {
      method: "POST",
      headers: { "x-refresh-key": secret },
    });
    console.log("Scheduled refresh worker status", workerRes.status);
    // Background functions acknowledge with 202; treat that as success.
    return new Response(
      JSON.stringify({ ok: true, workerStatus: workerRes.status }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("Scheduled refresh invoke failed:", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  // 11:00 UTC = 7:00am ET during daylight time, 6:00am during standard time
  schedule: "0 11 * * *",
};
