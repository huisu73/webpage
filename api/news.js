import { load } from "cheerio";

// ===============================
// 메인 핸들러
// ===============================
export default async function handler(req, res) {
    try {
        const query = req.query.query;
        if (!query) {
            return res.status(400).json({ error: "Missing query" });
        }

        // 1) RSS에서 뉴스 목록 가져오기
        const results = await searchGoogleNewsRSS(query);

        const articles = [];

        // 2) 각 기사 본문 추출 + 요약
        for (const item of results) {
            const text = await extractArticle(item.url);

            const summary = text
                ? await summarize(text)
                : "본문을 가져오지 못했습니다.";

            articles.push({
                title: item.title,
                url: item.url,
                summary,
            });
        }

        return res.status(200).json({ articles });
    } catch (err) {
        console.error("API ERROR:", err);
        return res.status(500).json({ error: "Server error" });
    }
}

// ===============================
// STEP 1 — Google News RSS 검색
// ===============================
async function searchGoogleNewsRSS(keyword) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
        keyword
    )}&hl=ko&gl=KR&ceid=KR:ko`;

    const xml = await fetch(url).then((r) => r.text());
    const $ = load(xml, { xmlMode: true });

    const items = [];

    $("item").each((_, el) => {
        const title = $(el).find("title").text().trim();

    // ⭐ guid가 진짜 URL임
        let realUrl = $(el).find("guid").text().trim();

    // guid가 비어있으면 fallback으로 link 사용
        if (!realUrl) {
            realUrl = $(el).find("link").text().trim();
        }

    // URL 아닌 값들은 제외
        if (!realUrl.startsWith("http")) return;

        items.push({ title, url: realUrl });
    });

    return items.slice(0, 5); // 최대 5개
}

// ===============================
// STEP 2 — 기사 본문 추출
// ===============================
async function extractArticle(url) {
    if (!url) return null;

    try {
        // 1) Google Redirect URL 요청
        const res = await fetch(url, {
            redirect: "follow",
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
                "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            },
        });

        const finalUrl = res.url;
        console.log("📌 최종 기사 URL:", finalUrl);

        // 리다이렉트 실패한 경우
        if (!finalUrl || finalUrl.includes("news.google.com")) {
            console.log("❌ 리다이렉트 실패:", finalUrl);
            return null;
        }

        // 2) 실제 페이지 HTML 가져오기
        const html = await res.text();
        const $ = load(html);

        // 한국 주요 언론 본문 선택자
        const selectors = [
            "article",
            "#articleBody",
            "#articeBody",
            ".article",
            ".article_body",
            ".article-body",
            ".news_end",
            ".news_article",
            ".post-content",
            "#content",
            ".story-news",
            ".txt_story",
            ".text",
            ".article_txt",
            "#news_body_area",
            "#news_body",
        ];

        // 선택자 순회하여 본문 찾기
        for (const sel of selectors) {
            const text = $(sel).text().replace(/\s+/g, " ").trim();
            if (text.length > 300) {
                return text;
            }
        }

        // fallback — body 전체
        const bodyText = $("body").text().replace(/\s+/g, " ").trim();
        if (bodyText.length > 400) {
            return bodyText;
        }

        return null;
    } catch (err) {
        console.error("Extract error:", err);
        return null;
    }
}

// ===============================
// STEP 3 — OpenAI 요약 (2~3문장)
// ===============================
async function summarize(text) {
    const clean = text.replace(/\s+/g, " ").trim();

    const prompt = `
다음 뉴스 기사의 전체 내용을 참고해서 핵심만 뽑아
한국어로 2~3문장으로 자연스럽게 요약해줘.
모든 문장은 마침표로 끝나는 평서문으로 작성해줘.

기사 전체 내용:
${clean}
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 250,
        }),
    }).then((r) => r.json());

    return (
        response?.choices?.[0]?.message?.content?.trim() ||
        "요약을 생성하지 못했습니다."
    );
}
