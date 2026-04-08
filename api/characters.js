// Vercel Serverless Function - /api/characters
// Safebooru se AUTOMATICALLY popular characters fetch karta hai
// Koi hardcoded list nahi - sab dynamic hai

// Minimum post count threshold - isse kam waale skip
const MIN_POST_COUNT = 150;

// Kitne characters fetch karne hain
const TARGET_CHARACTER_COUNT = 250;

// Safebooru API se popular character tags fetch karo
async function fetchPopularCharacterTags(limit = 300) {
  // Safebooru tag type 4 = character tags, order by count (most popular first)
  const url = `https://safebooru.org/index.php?page=dapi&s=tag&q=index&json=1&type=4&order=count&limit=${limit}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SafedleBot/1.0)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("Invalid response from Safebooru");
  return data;
}

// Ek character ke liye image fetch karo
async function fetchImageForTag(tag) {
  try {
    const url = `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(tag + " solo")}&limit=15&pid=0`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SafedleBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const posts = await res.json();
    if (!Array.isArray(posts) || posts.length === 0) return null;

    // Best image dhundo - sample_url prefer karo, good dimensions ke saath
    for (const post of posts) {
      if (post.sample_url && post.width > 200 && post.height > 200) {
        return post.sample_url;
      }
    }
    // Fallback: preview_url
    for (const post of posts) {
      if (post.preview_url) return post.preview_url;
    }
    return null;
  } catch {
    return null;
  }
}

// Tag naam ko clean aur readable banana
function formatTagName(tag) {
  return tag
    .replace(/_/g, " ")
    .replace(/\(.*?\)/g, "") // parentheses hataao
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Tag se franchise detect karo (simple heuristic)
function detectFranchise(tagName, postCount) {
  // Agar tag mein koi source identifier nahi hai aur count bahut high hai
  // toh franchise ho sakta hai - lekin yeh heuristic hai, sab characters return karenge
  const franchiseKeywords = [
    "pokemon", "naruto", "one_piece", "dragon_ball", "bleach",
    "fairy_tail", "sword_art_online", "attack_on_titan", "my_hero_academia",
    "re:zero", "genshin_impact", "fate/", "touhou", "kantai_collection",
    "azur_lane", "girls_frontline", "arknights", "blue_archive",
    "fire_emblem", "overwatch", "league_of_legends", "final_fantasy",
    "street_fighter", "mortal_kombat", "guilty_gear", "the_idolmaster",
    "love_live", "bang_dream", "vocaloid", "kimetsu_no_yaiba",
    "chainsaw_man", "spy_x_family", "bocchi_the_rock", "oshi_no_ko"
  ];

  const lowerTag = tagName.toLowerCase();
  for (const keyword of franchiseKeywords) {
    if (lowerTag.includes(keyword)) return true;
  }
  return false;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const includeFranchises = req.query.includeFranchises !== "false";

  try {
    // Step 1: Safebooru se popular character tags fetch karo
    console.log("Fetching popular character tags from Safebooru...");
    const allTags = await fetchPopularCharacterTags(400);

    // Step 2: Filter - sirf wo characters jo minimum post count se zyada hain
    const filtered = allTags.filter(tag => {
      const count = parseInt(tag.count) || 0;
      return count >= MIN_POST_COUNT;
    });

    console.log(`Found ${filtered.length} characters with ${MIN_POST_COUNT}+ posts`);

    // Step 3: Franchise filter agar user ne disable kiya ho
    let toProcess = filtered;
    if (!includeFranchises) {
      toProcess = filtered.filter(tag => !detectFranchise(tag.name, parseInt(tag.count)));
    }

    // Step 4: Limit karo
    const limited = toProcess.slice(0, TARGET_CHARACTER_COUNT);

    // Step 5: Images fetch karo in parallel batches
    console.log(`Fetching images for ${limited.length} characters...`);
    const results = [];
    const batchSize = 15;

    for (let i = 0; i < limited.length; i += batchSize) {
      const batch = limited.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(async (tag) => {
          try {
            const imageUrl = await fetchImageForTag(tag.name);
            return {
              tag_name: tag.name,
              display_name: formatTagName(tag.name),
              post_count: parseInt(tag.count) || 0,
              image_url: imageUrl,
              is_franchise: detectFranchise(tag.name, parseInt(tag.count)),
              note: null,
            };
          } catch {
            return {
              tag_name: tag.name,
              display_name: formatTagName(tag.name),
              post_count: parseInt(tag.count) || 0,
              image_url: null,
              is_franchise: detectFranchise(tag.name, parseInt(tag.count)),
              note: null,
            };
          }
        })
      );

      batchResults.forEach((r) => {
        if (r.status === "fulfilled" && r.value !== null) {
          results.push(r.value);
        }
      });

      console.log(`Batch ${Math.floor(i / batchSize) + 1} done, ${results.length} characters so far`);
    }

    // Step 6: Sort by post count (highest first)
    const sorted = results.sort((a, b) => b.post_count - a.post_count);

    if (sorted.length === 0) {
      return res.status(503).json({ error: "No character data available from Safebooru" });
    }

    console.log(`Returning ${sorted.length} characters`);

    // Cache for 2 hours (characters don't change that fast)
    res.setHeader("Cache-Control", "public, s-maxage=7200, stale-while-revalidate=14400");
    return res.status(200).json(sorted);

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: "Failed to fetch character data from Safebooru", details: error.message });
  }
}
