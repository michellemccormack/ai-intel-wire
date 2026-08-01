/**
 * Synchronous auth gate for manual refresh.
 * Validates the passphrase, then invokes the background worker.
 * Unlike the background function, this can return 401 to the browser.
 */
export default async (req) => {
  console.log("REFRESH GATE STARTED");

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = process.env.REFRESH_SECRET;
  if (!secret) {
    console.error("REFRESH GATE: REFRESH_SECRET is not set");
    return new Response(JSON.stringify({ error: "REFRESH_SECRET is not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const provided = req.headers.get("x-refresh-key") || "";
  if (provided !== secret) {
    console.error("REFRESH GATE: wrong passphrase");
    return new Response(JSON.stringify({ error: "Wrong passphrase" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const workerUrl = new URL("/.netlify/functions/refresh-background", req.url);
  console.log("REFRESH GATE invoking worker", workerUrl.href);

  try {
    const workerRes = await fetch(workerUrl, {
      method: "POST",
      headers: { "x-refresh-key": secret },
    });
    console.log("REFRESH GATE worker status", workerRes.status);
    return new Response(
      JSON.stringify({ ok: true, workerStatus: workerRes.status }),
      {
        status: 202,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("REFRESH GATE worker invoke failed:", e.message);
    return new Response(JSON.stringify({ error: "Failed to start refresh worker" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
