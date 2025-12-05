import { load } from "cheerio";

export default async function handler(req, res) {
	try {
		const query = req.query.query;
		if (!query) return res.status(400).json({ error: "Missing query" });

		// STEP 1: RSS에서 뉴스 목록 가져오기
		const results = await searchGoogleNewsRSS(query);

		const articles = [];

		// STEP 2: 각 기사 본문 크롤링 + 요약
		for (const item of results) {
			const articleText = await extractArticle(item.link);

			let summary = "";
			if (articleText) {
				summary = await summarize(articleText);
			} else {
				summary = "본문을 가져오지 못했습니다.";
			}

			articles.push({
				title: item.title,
				url: item.link,
				summary,
			});
		}

		return res.status(200).json({ articles });
	} catch (err) {
		console.error("API ERROR:", err);
		return res.status(500).json({ error: "Server error" });
	}
}

/* ---------------------------------------------------
   STEP 1 — Google News RSS 사용 (차단 없음!)
--------------------------------------------------- */

async function searchGoogleNewsRSS(keyword) {
	const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
		keyword
	)}&hl=ko&gl=KR&ceid=KR:ko`;

	const xml = await fetch(url).then((r) => r.text());
	const $ = load(xml, { xmlMode: true });

	const items = [];

	$("item").each((_, el) => {
        const title = $(el).find("title").text().trim();
        const link = $(el).find("link").text().trim();

        if (!title || !link) return;

    // RSS 링크 내부에서 실제 언론사 링크 추출
        const realMatch = link.match(/url=(https?:\/\/[^&]+)/);
        const realUrl = realMatch ? decodeURIComponent(realMatch[1]) : link;

        items.push({ title, url: realUrl });
    });

	return items.slice(0, 5); // 상위 최대 5개 기사만
}

/* ---------------------------------------------------
   STEP 2 — 실제 기사 본문 크롤링
--------------------------------------------------- */

async function extractArticle(url) {
	try {
		const res = await fetch(url, {
			redirect: "follow",
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
			},
		});

		const html = await res.text();
		const $ = load(html);

		const selectors = [
			"article",
			"#articleBody",
			".news_end",
			"#articeBody",
			".article",
			".article-body",
			".post-content",
			"#content",
		];

		for (const sel of selectors) {
			const text = $(sel).text().trim();
			if (text.length > 200) return text;
		}

		return null;
	} catch (err) {
		console.error("Extract error:", err);
		return null;
	}
}

/* ---------------------------------------------------
   STEP 3 — OpenAI 요약
--------------------------------------------------- */

async function summarize(text) {
	const prompt = `
다음 뉴스 기사를 한국어로 2~3문장으로 자연스럽게 요약해줘.
문장은 모두 평서문으로 끝내고, 핵심 내용만 포함해줘.

기사 전문:
${text.replace(/\s+/g, " ").trim()}
`;

	const res = await fetch("https://api.openai.com/v1/chat/completions", {
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

	return res?.choices?.[0]?.message?.content || "요약 실패";
}
