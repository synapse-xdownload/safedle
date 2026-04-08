// Vercel Serverless Function - /api/image-proxy
// Safebooru images ko proxy karta hai taaki CORS/hotlink issues na aayein

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "url parameter required" });
  }

  // Sirf safebooru.org URLs allow karo security ke liye
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  if (!decodedUrl.includes("safebooru.org")) {
    return res.status(403).json({ error: "Only safebooru.org URLs allowed" });
  }

  try {
    const response = await fetch(decodedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://safebooru.org/",
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "Image fetch failed" });
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const imageBuffer = await response.arrayBuffer();

    // Image cache karo 7 din ke liye
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", imageBuffer.byteLength);

    return res.send(Buffer.from(imageBuffer));
  } catch (error) {
    console.error("Image proxy error:", error);
    return res.status(500).json({ error: "Failed to fetch image" });
  }
}
