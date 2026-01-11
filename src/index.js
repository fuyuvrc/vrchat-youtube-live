export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // プリフライト対応
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    if (url.pathname === "/lives") {
      return handleLiveList(env, request);
    }

    if (url.pathname === "/video") {
      const videoId = url.searchParams.get("id");
      return handleVideoInfo(env, videoId);
    }

    return new Response("Not Found", {
      status: 404,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }
};

// ===============================
// 配信中ライブリスト
async function handleLiveList(env, request) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);

  const PER_PAGE = 8;
  const MAX_ITEMS = 24;

  const cache = caches.default;
  const cacheKey = new Request("https://cache/youtube-live-list");

  // テスト用：キャッシュをクリア
  // await cache.delete(cacheKey);

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
      "&relevanceLanguage=ja" +
      "&maxResults=50" +
      "&q=ゲーム OR Game OR VTuber OR にじさんじ OR Nijisanji OR ホロライブ OR Hololive OR 雑談 OR ライブ OR Live OR 配信 OR Streaming OR ニュース OR News OR 天気" +
      "&key=" + apiKey;

    const res = await fetch(searchUrl);
    const data = await res.json();

    const lives = (data.items || []).map(item => ({
      videoId: item.id.videoId,
      url: "https://www.youtube.com/watch?v=" + item.id.videoId,
      title: item.snippet.title,
      channelId: item.snippet.channelId,
      channelName: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium.url,
      startTime: item.snippet.publishedAt
    })).slice(0, MAX_ITEMS);

    const channelMap = await getChannelIcons(env, lives.map(v => v.channelId));

    allLives = lives.map(v => ({
      ...v,
      channelIcon: channelMap[v.channelId] || null
    }));

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
// チャンネル情報取得（キャッシュ付き）
async function getChannelIcons(env, channelIds) {
  const cache = caches.default;
  const CHANNEL_CACHE_KEY = new Request("https://cache/youtube-channels");

  let channelMap = {};
  const cached = await cache.match(CHANNEL_CACHE_KEY);
  if (cached) {
    channelMap = await cached.json();
  }

  const missingIds = channelIds.filter(id => !channelMap[id]);
  if (missingIds.length > 0) {
    const apiKey = env.YOUTUBE_API_KEY;
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${missingIds.join(",")}&key=${apiKey}`
    );
    const data = await res.json();
    (data.items || []).forEach(ch => {
      channelMap[ch.id] = ch.snippet.thumbnails.default.url;
    });

    await cache.put(
      CHANNEL_CACHE_KEY,
      new Response(JSON.stringify(channelMap), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "max-age=43200",
          "Access-Control-Allow-Origin": "*"
        }
      })
    );
  }

  return channelMap;
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

  const channelMap = await getChannelIcons(env, [v.snippet.channelId]);
  const channelIcon = channelMap[v.snippet.channelId] || null;

  return new Response(JSON.stringify({
    videoId,
    title: v.snippet.title,
    channelName: v.snippet.channelTitle,
    thumbnail: v.snippet.thumbnails.medium.url,
    channelIcon,
    isLive: !!v.liveStreamingDetails?.activeLiveChatId,
    startTime: v.liveStreamingDetails?.actualStartTime || null
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
