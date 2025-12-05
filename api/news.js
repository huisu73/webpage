// /api/news.js

export default async function handler(req, res) {
	try {
		const query = req.query.query;
		if (!query) return res.status(400).json({ error: "Missing query" });

		const results = await searchGoogleNews(query);

		const articles = [];
		for (const item of results) {
			const content = await extractArticle(item.url);

			let summary = "";
			if (content) {
				summary = await summarize(content); // AI 요약
			} else {
				summary = "본문을 가져오지 못했습니다.";
			}

			articles.push({
				title: item.title,
				url: item.url,
				summary,
			});
		}

		return res.status(200).json({ articles });

	} catch (err) {
		console.error(err);
		return res.status(500).json({ error: "Server error" });
	}
}


/* ---------------------------------------------------
   STEP 1 — 구글 뉴스 검색 페이지 HTML 가져오기
--------------------------------------------------- */
import cheerio from "cheerio";

async function searchGoogleNews(keyword) {
	const url = `https://news.google.com/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR%3Ako`;

	const html = await fetch(url, {
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
		},
	}).then((r) => r.text());

	const $ = cheerio.load(html);
	const items = [];

	$("article").each((_, el) => {
		const title = $(el).find("h3").text().trim();
		let link = $(el).find("a").attr("href");

		if (!title || !link) return;

		// 구글 뉴스는 링크 앞에 ./ 나 붙어서 처리 필요
		if (link.startsWith("./")) {
			link = "https://news.google.com" + link.replace(".", "");
		}

		items.push({ title, url: link });
	});

	return items.slice(0, 5); // 최대 5개만
}


/* ---------------------------------------------------
   STEP 2 — 실제 원문 URL로 이동해서 본문 추출
--------------------------------------------------- */

async function extractArticle(url) {

	// 구글 뉴스 링크를 언론사 링크로 자동 변환
	const redirected = await fetch(url, {
		redirect: "follow",
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
		},
	});

	const finalUrl = redirected.url;
	const html = await redirected.text();
	const $ = cheerio.load(html);

	// 언론사 사이트마다 본문 구조 다름 → 여러 패턴 대응
	const selectors = [
		"article",
		"#articleBody",
		".news_end",
		".article",
		"#articeBody",
		".post-content",
		"#content",
	];

	for (const sel of selectors) {
		const text = $(sel).text().trim();
		if (text.length > 150) return text; // 충분히 긴 본문이면 채택
	}

	return null;
}

/* ---------------------------------------------------
   STEP 3 — 기사 본문 요약
--------------------------------------------------- */

async function summarize(text) {
	const clean = text.replace(/\s+/g, " ").trim();

	const prompt = `
아래 뉴스 기사의 전체 내용을 2~3줄로 자연스럽게 요약해줘.
문장은 모두 한국어 평서문으로 끝맺음하고, 핵심만 포함해줘.

기사 내용:
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
			max_tokens: 200,
		}),
	}).then((r) => r.json());

	return response?.choices?.[0]?.message?.content || "요약 실패";
}
