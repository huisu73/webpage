// /api/news.js
import { load } from "cheerio";

export default async function handler(req, res) {
	try {
		const query = req.query.query;
		if (!query) {
			return res.status(400).json({ error: "Missing query" });
		}

		const results = await searchGoogleNews(query); // 구글 뉴스 검색
		const articles = [];

		for (const item of results) {
			const articleText = await extractArticle(item.url); // 본문 추출

			let summary = "";
			if (articleText) {
				summary = await summarize(articleText); // AI 요약
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
   STEP 1 — 구글 뉴스 검색 HTML 파싱
--------------------------------------------------- */
async function searchGoogleNews(keyword) {
	const url = `https://news.google.com/search?q=${encodeURIComponent(
		keyword
	)}&hl=ko&gl=KR&ceid=KR%3Ako`;

	const html = await fetch(url, {
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
		},
	}).then((res) => res.text());

	const $ = load(html);
	const items = [];

	$("article").each((_, el) => {
		const title = $(el).find("h3").text().trim();
		let link = $(el).find("a").attr("href");

		if (!title || !link) return;

		if (link.startsWith("./")) {
			link = "https://news.google.com" + link.replace(".", "");
		}

		items.push({ title, url: link });
	});

	return items.slice(0, 5); // 상위 5개 기사만 반환
}

/* ---------------------------------------------------
   STEP 2 — 언론사 원문 본문 텍스트 추출
--------------------------------------------------- */
async function extractArticle(url) {
	try {
		const response = await fetch(url, {
			redirect: "follow",
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
			},
		});

		const finalUrl = response.url;
		const html = await response.text();
		const $ = load(html);

		const selectors = [
			"article",
			"#articleBody",
			".news_end",
			"#articeBody",
			".article",
			".article-body",
			"#content",
			".post-content",
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
   STEP 3 — OpenAI 요약 (2~3문장)
--------------------------------------------------- */
async function summarize(text) {
	const clean = text.replace(/\s+/g, " ").trim();

	const prompt = `
아래 뉴스 기사 전체 내용을 2~3문장으로 자연스럽게 요약해줘.
모든 문장은 한국어 평서문(이다/한다)으로 끝내고 핵심 정보만 포함해줘.

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
			max_tokens: 250,
		}),
	}).then((r) => r.json());

	return (
		response?.choices?.[0]?.message?.content ||
		"요약을 생성하지 못했습니다."
	);
}
