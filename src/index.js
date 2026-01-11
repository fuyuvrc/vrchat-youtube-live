export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /lives?page=1
    if (url.pathname === "/lives") {
      return handleLiveList(env, request);
    }

    // /video?id=VIDEO_ID
    if (url.pathname === "/video") {
      const videoId = url.searchParams.get("id");
      return handleVideoInfo(env, videoId);
    }

    return new Response("Not Found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  }
};

// ===============================
// 配信中ライブリスト
async function handleLiveList(env, request) {
  // テスト用：キャッシュをクリア
  await cache.delete(cacheKey);

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);

  const PER_PAGE = 8;
  const MAX_ITEMS = 24;

  const cache = caches.default;
  const cacheKey = new Request("https://cache/youtube-live-list");

  let allLives;

  const cached = await cache.match(cacheKey);
  if (cached) {
    allLives = await cached.json();
  } else {
    const apiKey = env.YOUTUBE_API_KEY;

    const searchUrl =
      "https://www.googleapis.com/youtube/v3/search" +
      "?part=snippet" +
      "&eventType=live" +
      "&type=video" +
      "&regionCode=JP" +
      "&maxResults=50" +
      "&q=ゲーム OR Game OR VTuber OR にじさんじ OR Nijisanji OR ホロライブ OR Hololive OR 雑談 OR ライブ OR Live OR 配信 OR Streaming  OR ニュース OR News OR 天気" +
      "&key=" + apiKey;

    const res = await fetch(searchUrl);
    const data = await res.json();

    allLives = await Promise.all(
      (data.items || [])
        .map(async item => {
          const videoId = item.id.videoId;
          const channelId = item.snippet.channelId;

          // チャンネルアイコン取得
          let channelIcon = "";
          try {
            const channelRes = await fetch(
              `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${apiKey}`
            );
            const channelData = await channelRes.json();
            channelIcon = channelData.items?.[0]?.snippet?.thumbnails?.default?.url || "";
          } catch (e) {
            console.error("Channel icon fetch failed:", e);
          }

          return {
            videoId,
            url: "https://www.youtube.com/watch?v=" + videoId,
            title: item.snippet.title,
            channelName: item.snippet.channelTitle,
            channelIcon, // ← 追加
            thumbnail: item.snippet.thumbnails.medium.url,
            startTime: item.snippet.publishedAt
          };
        })
        .slice(0, MAX_ITEMS)
    );

    await cache.put(
      cacheKey,
      new Response(JSON.stringify(allLives), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "max-age=1800",
          "Access-Control-Allow-Origin": "*"
        }
      })
    );
  }

  const start = (page - 1) * PER_PAGE;
  const items = allLives.slice(start, start + PER_PAGE);

  return new Response(
    JSON.stringify({
      page,
      perPage: PER_PAGE,
      total: allLives.length,
      totalPages: Math.ceil(allLives.length / PER_PAGE),
      items
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}

// ===============================
// 動画情報
async function handleVideoInfo(env, videoId) {
  if (!videoId) return new Response("videoId required", { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });

  const apiKey = env.YOUTUBE_API_KEY;

  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/videos" +
    "?part=snippet,liveStreamingDetails" +
    "&id=" + videoId +
    "&key=" + apiKey
  );

  const data = await res.json();
  if (!data.items?.length) return new Response(null, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });

  const v = data.items[0];

  return new Response(JSON.stringify({
    videoId,
    title: v.snippet.title,
    channelName: v.snippet.channelTitle,
    thumbnail: v.snippet.thumbnails.medium.url,
    isLive: !!v.liveStreamingDetails?.activeLiveChatId,
    startTime: v.liveStreamingDetails?.actualStartTime || null
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
