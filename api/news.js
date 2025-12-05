import fetch from "node-fetch";

// 긴 텍스트도 안정적으로 요약하는 함수 (옵션 A)
async function summarize(text, title) {
    const HF_TOKEN = process.env.HF_TOKEN;

    if (!HF_TOKEN) {
        console.error("HF_TOKEN not found");
        return "요약 생성 실패(HF_TOKEN 없음)";
    }

  // ---------------------------
  // 1) 텍스트 정제
  // ---------------------------
    const cleanText = (text || title || "")
        .replace(/\s+/g, " ")
        .replace(/<[^>]+>/g, "")
        .trim();

    if (!cleanText) return "요약 생성 실패(본문 없음)";

  // ---------------------------
  // 2) 청크(부분) 나누기 (각 900자)
  // ---------------------------
    const chunkSize = 900;
    const chunks = [];

    for (let i = 0; i < cleanText.length; i += chunkSize) {
        chunks.push(cleanText.slice(i, i + chunkSize));
    }

  // 요약 모델 URL
    const HF_URL =
    "https://api-inference.huggingface.co/models/sshleifer/distilbart-cnn-12-6";

  // ---------------------------
  // 3) 각 청크별 부분 요약
  // ---------------------------
    async function summarizeChunk(chunk) {
        const payload = {
            inputs: chunk,
            parameters: {
                max_length: 120,
                min_length: 40,
                do_sample: false
            }
        };

        try {
            const res = await fetch(HF_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${HF_TOKEN}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            return data?.[0]?.summary_text || "";
        } catch (e) {
            console.error("Chunk summary error:", e);
            return "";
        }
    }

  // 모든 부분 요약 실행
    const partialSummaries = [];
    for (const chunk of chunks) {
        const part = await summarizeChunk(chunk);
        if (part) partialSummaries.push(part);
    }

    if (partialSummaries.length === 0) {
        return "요약 생성 실패(부분 요약 실패)";
    }

  // ---------------------------
  // 4) 부분 요약들을 합쳐서 하나의 텍스트로 결합
  // ---------------------------
    const combined = partialSummaries.join(" ");

  // ---------------------------
  // 5) 최종 요약 → 3줄 요약
  // ---------------------------
    const finalPayload = {
        inputs: combinedSummary,
        parameters: {
        max_length: 150,
        min_length: 60,
        do_sample: false
        }
    };

    try {
        const finalRes = await fetch(HF_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(finalPayload)
        });

    const finalData = await finalRes.json();
    const finalText = finalData?.[0]?.summary_text || "";

    // 3줄로 정제
    let sentences = finalText
        .replace(/\n+/g, " ")
        .split(/\.|\?|\!/g)
        .filter(Boolean)
        .map((s) => s.trim() + ".");

    sentences = sentences.slice(0, 3).map((s) => s + ".");

    return lines.join("\n");
    } catch (e) {
    console.error("Final summary error:", e);
    return "요약 생성 실패(최종 단계 오류)";
    }
}

function toMobileUrl(url) {
    try {
        if (url.includes("news.naver.com")) {
            return url.replace("news.naver.com", "m.news.naver.com");
        }
    } catch {}
    return url;
}

function extractText(html) {
    try {
        const cleaned = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

        const dicAreaMatch = cleaned.match(
            /<div[^>]*id=["']dic_area["'][^>]*>([\s\S]*?)<\/div>/
        );

        if (dicAreaMatch) {
            return dicAreaMatch[1]
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
        }

        const fallback = cleaned
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        return fallback;
    } catch (e) {
        console.error("본문 추출 실패:", e);
        return "";
    }
}

async function getNaverNews(query) {
    const NAVER_ID = process.env.NAVER_CLIENT_ID;
    const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;

    if (!NAVER_ID || !NAVER_SECRET) {
        console.error("네이버 API 키 누락");
        return [];
    }

    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(
        query
    )}&display=10&sort=sim`;

    try {
        const res = await fetch(url, {
            headers: {
                "X-Naver-Client-Id": NAVER_ID,
                "X-Naver-Client-Secret": NAVER_SECRET,
            },
        });

    const data = await res.json();

    if (!data.items) return [];

    // 기사 본문을 가져올 수 있는 링크 정리
    return data.items.map((item) => ({
        title: item.title.replace(/<[^>]+>/g, ""),
        url: item.originallink || item.link,
    }));
    } catch (e) {
    console.error("Naver API error:", e);
    return [];
    }
}

// ------------------------------
// ✨ 실제 API 엔드포인트 (export default 필수!)
// ------------------------------
export default async function handler(req, res) {
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ error: "query 파라미터가 필요합니다." });
    }

    try {
        const articles = await getNaverNews(query);

        const result = [];
        for (const article of articles) {
            let summary = "요약 생성 실패";

            try {
        // 기사 HTML 본문 가져오기
                const html = await fetch(article.url).then((r) => r.text());

        // HTML → 텍스트 변환
                const text = html
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                    .replace(/<[^>]+>/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();

                summary = await summarize(text, article.title);
            } catch (e) {
                console.error("본문 크롤링 실패:", e);
            }

            result.push({
                title: article.title,
                url: article.url,
                summary,
            });
        }

    return res.status(200).json({ articles: result });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "서버 내부 오류" });
    }
}