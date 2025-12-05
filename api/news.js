// /api/news.js
import fetch from "node-fetch";

/* ---------------------------------------------------
   1) 구글 뉴스 검색
--------------------------------------------------- */
export default async function handler(req, res) {
	try {
		const query = req.query.query;
		if (!query) {
			return res.status(400).json({ error: "Missing query" });
		}

		// 구글 뉴스 검색 결과 가져오기
		const results = await searchGoogleNews(query);

		const articles = [];
		for (const item of results) {
			// URL 요약 생성
			const summary = await summarizeByUrl(item.url);

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
   STEP 1 — 구글 뉴스 검색 페이지 파싱
--------------------------------------------------- */

async function searchGoogleNews(keyword) {
	const searchUrl = `https://news.google.com/search?q=${encodeURIComponent(
		keyword
	)}&hl=ko&gl=KR&ceid=KR%3Ako`;

	const html = await fetch(searchUrl, {
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
		},
	}).then((r) => r.text());

	const items = [];

	const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g;
	let match;

	while ((match = linkRegex.exec(html)) !== null) {
		let href = match[1];
		let title = match[2].replace(/<[^>]+>/g, "").trim();

		// 기사 링크만 필터링
		if (!href.includes("/articles/")) continue;
		if (!title) continue;

		if (href.startsWith("./")) {
			href = "https://news.google.com" + href.substring(1);
		}

		items.push({ title, url: href });
	}

	return items.slice(0, 5);
}

/* ---------------------------------------------------
   STEP 2 — OpenAI로 URL 요약하기
--------------------------------------------------- */

async function summarizeByUrl(url) {
	const prompt = `
아래 뉴스 기사(URL)의 전체 내용을 읽고 핵심만 2~3줄로 자연스럽게 요약해줘.
모든 문장은 한국어 평서문으로 끝나게 작성해줘.

URL: ${url}
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

	return response?.choices?.[0]?.message?.content || "요약 실패";
}
