import { buildBrief } from "./lib/build-brief.mjs";

export default async (req) => {
  console.log("REFRESH STARTED");
  try {
    if (req.method !== "POST") {
      console.log("REFRESH REJECTED: method", req.method);
      return;
    }
    const secret = process.env.REFRESH_SECRET;
    if (!secret) {
      console.error("REFRESH REJECTED: REFRESH_SECRET is not set");
      return;
    }
    const provided = req.headers.get("x-refresh-key") || "";
    if (provided !== secret) {
      console.error("REFRESH REJECTED: wrong passphrase");
      return;
    }
    console.log("REFRESH AUTH OK — building brief…");
    await buildBrief();
    console.log("Manual refresh complete");
  } catch (e) {
    console.error("Manual refresh failed:", e.message);
  } finally {
    console.log("REFRESH FINISHED");
  }
};

export const config = {
  background: true,
};
