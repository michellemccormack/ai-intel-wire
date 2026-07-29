import { buildBrief } from "./lib/build-brief.mjs";

export default async () => {
  try {
    const snapshot = await buildBrief();
    console.log("Scheduled refresh complete", new Date(snapshot.ts).toISOString());
  } catch (e) {
    console.error("Scheduled refresh failed:", e.message);
  }
  return new Response("ok");
};

export const config = {
  // 11:00 UTC = 7:00am ET during daylight time, 6:00am during standard time
  schedule: "0 11 * * *",
};
