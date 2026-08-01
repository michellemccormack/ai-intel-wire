import { getStore } from "@netlify/blobs";

export default async () => {
  const store = getStore(process.env.BLOB_STORE_NAME || "aiwire");
  const snapshot = await store.get("snapshot", { type: "json" });
  if (!snapshot) {
    return new Response(JSON.stringify({ error: "No snapshot yet. Run a refresh." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(snapshot), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
};

export const config = {
  path: "/api/brief",
};
