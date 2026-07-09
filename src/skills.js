// Skill 레이어: API 키 없이 동작하는 무료 데이터 소스만 사용
// ponytail: youtube_trending은 API 키 필요 → 키 확보 시 여기에 추가

const UA = { "User-Agent": "video-creator/0.1 (trend research bot)" };

async function safeFetch(url, opts = {}) {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000), ...opts });
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  }
}

function rssTitles(xml, source, limit = 15) {
  // ponytail: 정규식 RSS/Atom 파싱 — 제목만 필요하므로 XML 파서 불필요
  const items = [...xml.matchAll(/<(?:item|entry)>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g)];
  return items.slice(0, limit).map((m) => ({ source, title: m[1].trim() }));
}

async function hackernews() {
  const res = await safeFetch("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=15");
  if (!res) return [];
  const data = await res.json();
  return data.hits.map((h) => ({
    source: "hackernews", title: h.title, url: h.url, points: h.points, comments: h.num_comments,
  }));
}

async function geeknews() {
  const res = await safeFetch("https://news.hada.io/rss/news");
  if (!res) return [];
  return rssTitles(await res.text(), "geeknews");
}

async function googleTrends() {
  const res = await safeFetch("https://trends.google.com/trending/rss?geo=KR");
  if (!res) return [];
  return rssTitles(await res.text(), "google_trends", 20);
}

async function reddit() {
  const res = await safeFetch("https://www.reddit.com/r/programming/top.json?t=day&limit=15");
  if (!res) return [];
  const data = await res.json();
  return data.data.children.map((c) => ({
    source: "reddit", title: c.data.title, ups: c.data.ups, comments: c.data.num_comments,
  }));
}

export async function gatherTrendSources() {
  const [hn, gn, gt, rd] = await Promise.all([hackernews(), geeknews(), googleTrends(), reddit()]);
  return { hackernews: hn, geeknews: gn, google_trends: gt, reddit: rd };
}

// Research용: 토픽 키워드로 HN 검색 + 위키백과 요약
export async function research(topicTitle) {
  const q = encodeURIComponent(topicTitle.slice(0, 60));
  const [hnRes, wikiRes] = await Promise.all([
    safeFetch(`https://hn.algolia.com/api/v1/search?query=${q}&hitsPerPage=8`),
    safeFetch(`https://ko.wikipedia.org/api/rest_v1/page/summary/${q}`),
  ]);
  const out = { web_search: [], wikipedia: null };
  if (hnRes) {
    const data = await hnRes.json();
    out.web_search = data.hits.map((h) => ({
      title: h.title, url: h.url, points: h.points, comments: h.num_comments, date: h.created_at,
    }));
  }
  if (wikiRes) {
    const w = await wikiRes.json();
    if (w.extract) out.wikipedia = { title: w.title, extract: w.extract };
  }
  return out;
}
