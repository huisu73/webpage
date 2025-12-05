// api/news.js
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

function sanitizeHtml(text = "") {
  return text.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

// 간단 카테고리 추론 (제목/요약 기반)
function inferCategory(title = "", description = "") {
  const text = `${title} ${description}`;

  if (/증시|주가|코스피|환율|경제|물가|금리/.test(text)) return "economy";
  if (/대선|총선|국회|정부|정치|외교/.test(text)) return "politics";
  if (/사건|사고|경찰|법원|사회|노동|복지/.test(text)) return "society";
  if (/IT|인공지능|AI|과학|반도체|기술|테크/.test(text)) return "it_science";
  if (/세계|국제|미국|중국|일본|유럽|외신/.test(text)) return "world";
  if (/야구|축구|농구|배구|골프|올림픽|스포츠/.test(text)) return "sports";
  if (/연예|영화|드라마|음악|아이돌|공연|문화/.test(text)) return "culture";

  return "other";
}

// 기사 본문 HTML을 텍스트로 단순 변환
async function fetchArticleText(url) {
  if (!url) return "";

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!res.ok) {
      console.warn("Article fetch failed", res.status, url);
      return "";
    }

    const html = await res.text();
    const text = sanitizeHtml(html);
    // 너무 길면 자르기 (토큰 절약)
    return text.slice(0, 6000);
  } catch (err) {
    console.warn("fetchArticleText error", url, err.message);
    return "";
  }
}

// OpenAI로 3줄 요약 생성
async function summarize(text, title) {
  if (!text) {
    return "이 기사는 본문을 가져오지 못해 간단한 요약만 제공됩니다.";
  }

  const prompt = `
다음은 뉴스 기사 내용입니다.

제목: ${title}

본문:
${text}

위 기사의 핵심 내용을 한국어로 "3줄"로 요약해줘.
- 각 줄은 하나의 문장으로만 구성해줘.
- 불릿 기호는 사용하지 말고, 자연스러운 문장 3개를 줄바꿈으로 구분해줘.
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: prompt
      }
    ],
    max_tokens: 220,
    temperature: 0.4
  });

  const summary = completion.choices[0]?.message?.content?.trim() ?? "";
  return summary || "요약을 생성하지 못했습니다.";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET || !process.env.OPENAI_API_KEY) {
    res.status(500).json({
      error: "서버 환경 변수(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, OPENAI_API_KEY)가 설정되지 않았습니다."
    });
    return;
  }

  try {
    const urlObj = new URL(req.url, "http://localhost");
    const keyword = urlObj.searchParams.get("query") || urlObj.searchParams.get("q");

    if (!keyword || !keyword.trim()) {
      res.status(400).json({ error: "query 파라미터(검색어)가 필요합니다." });
      return;
    }

    // 1. 네이버 뉴스 검색 API 호출
    const naverRes = await fetch(
      `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(
        keyword.trim()
      )}&display=10&sort=sim`,
      {
        headers: {
          "X-Naver-Client-Id": NAVER_CLIENT_ID,
          "X-Naver-Client-Secret": NAVER_CLIENT_SECRET
        }
      }
    );

    if (!naverRes.ok) {
      const text = await naverRes.text();
      console.error("Naver API error", naverRes.status, text);
      res.status(502).json({ error: "네이버 뉴스 API 호출 실패" });
      return;
    }

    const naverData = await naverRes.json();
    const items = naverData.items || [];

    // 결과 없으면 바로 리턴
    if (items.length === 0) {
      res.status(200).json({ articles: [] });
      return;
    }

    // 2. 각 기사에 대해 본문 크롤링 + 요약
    const articles = await Promise.all(
      items.map(async (item) => {
        const rawTitle = item.title || "";
        const rawDesc = item.description || "";

        const title = sanitizeHtml(rawTitle);
        const description = sanitizeHtml(rawDesc);
        const url = item.originallink || item.link || "";
        const category = inferCategory(title, description);

        const articleText = await fetchArticleText(url);
        const summary = await summarize(articleText || description, title);

        return {
          title,
          summary,
          url,
          category
        };
      })
    );

    res.status(200).json({ articles });
  } catch (error) {
    console.error("Handler error", error);
    res.status(500).json({ error: "서버 내부 오류" });
  }
}
