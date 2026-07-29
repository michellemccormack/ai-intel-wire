import { buildBrief } from "./lib/build-brief.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const secret = process.env.REFRESH_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: "REFRESH_SECRET is not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const provided = req.headers.get("x-refresh-key") || "";
  if (provided !== secret) {
    return new Response(JSON.stringify({ error: "Wrong passphrase" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    await buildBrief();
    console.log("Manual refresh complete");
  } catch (e) {
    console.error("Manual refresh failed:", e.message);
  }
};
