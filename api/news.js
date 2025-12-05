// api/news.js

function sanitizeHtml(text = "") {
    return text
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// 기사 본문 크롤링
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
        console.warn("Article fetch failed:", res.status, url);
        return "";
        }

        const html = await res.text();
        return sanitizeHtml(html).slice(0, 6000);
    } catch (e) {
        console.warn("fetchArticleText error:", e);
        return "";
    }
}

// ------------------------------------------------
// HuggingFace Summarization API (무료, 안정적)
// ------------------------------------------------
async function summarize(text, title) {
    const HF_TOKEN = process.env.HF_TOKEN;

    if (!HF_TOKEN) return "요약 생성 실패(HF_TOKEN 없음)";

    const inputText = text.slice(0, 1500); // 너무 긴 본문은 요약 전에 자르기

    const payload = {
        inputs: inputText,
        parameters: {
        max_length: 120,
        min_length: 40,
        do_sample: false
        }
    };

    try {
        const res = await fetch(
        "https://api-inference.huggingface.co/models/sshleifer/distilbart-cnn-12-6",
        {
            method: "POST",
            headers: {
            Authorization: `Bearer ${HF_TOKEN}`,
            "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        }
        );

        const data = await res.json();

        if (Array.isArray(data) && data[0]?.summary_text) {
        return data[0].summary_text.trim();
        }

        console.warn("HF 응답 예외:", data);
        return "요약 생성 실패(응답 오류)";
    } catch (err) {
        console.error("HF summarize error:", err);
        return "요약 생성 실패(HF 오류)";
    }
}

// ------------------------------------------------
// 메인 핸들러
// ------------------------------------------------
export default async function handler(req, res) {
    if (req.method !== "GET") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }

    const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
    const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
        res.status(500).json({ error: "네이버 API 키 누락" });
        return;
    }

    try {
        const urlObj = new URL(req.url, "http://localhost");
        const keyword =
        urlObj.searchParams.get("query") || urlObj.searchParams.get("q");

        if (!keyword?.trim()) {
            res.status(400).json({ error: "검색어(query)가 필요합니다" });
            return;
        }

    // -----------------------------
    // 1) 네이버 뉴스 검색
    // -----------------------------
    const naverRes = await fetch(
        `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(
            keyword
        )}&display=10&sort=sim`,
        {
        headers: {
            "X-Naver-Client-Id": NAVER_CLIENT_ID,
            "X-Naver-Client-Secret": NAVER_CLIENT_SECRET
        }
        }
    );

    if (!naverRes.ok) {
        res.status(502).json({ error: "네이버 뉴스 API 호출 실패" });
        return;
    }

    const naverData = await naverRes.json();
    const items = naverData.items || [];

    if (items.length === 0) {
        res.status(200).json({ articles: [] });
        return;
    }

    // -----------------------------
    // 2) 각 기사 요약 생성
    // -----------------------------
    const articles = await Promise.all(
        items.map(async (item) => {
            const title = sanitizeHtml(item.title || "");
            const description = sanitizeHtml(item.description || "");
            const url = item.originallink || item.link || "";

        // 본문 크롤링 실패 시 description 사용
        const articleText =
            (await fetchArticleText(url)) || description || title;

        const summary = await summarize(articleText, title);

        return {
            title,
            summary,
            url
        };
        })
    );

    res.status(200).json({ articles });
    } catch (error) {
    console.error("Handler error:", error);
    res.status(500).json({ error: "서버 내부 오류" });
    }
}
