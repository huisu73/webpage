import * as cheerio from "cheerio";

export default async function handler(req, res) {
	try {
		const query = req.query.query;
		if (!query) return res.status(400).json({ error: "Missing query" });

		const results = await searchGoogleNews(query);

		const articles = [];
		for (const item of results) {
			const realUrl = await getRealArticleUrl(item.url); // 원문 URL 찾기
			const content = realUrl ? await extractArticle(realUrl) : null;

			let summary = "";
			if (content) {
				summary = await summarize(content);
			} else {
				summary = "본문을 가져오지 못했습니다.";
			}

			articles.push({
				title: item.title,
				url: realUrl || item.url,
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
   STEP 1 — Google 뉴스 검색 결과 가져오기
--------------------------------------------------- */

async function searchGoogleNews(keyword) {
	const url = `https://news.google.com/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR%3Ako`;

	const html = await fetch(url, {
		headers: { "User-Agent": "Mozilla/5.0" }
	}).then(r => r.text());

	const $ = cheerio.load(html);
	const items = [];

	$("article").each((_, el) => {
		const title = $(el).find("h3").text().trim();
		let link = $(el).find("a").attr("href");

		if (!title || !link) return;
		if (link.startsWith("./"))
			link = "https://news.google.com" + link.slice(1);

		items.push({ title, url: link });
	});

	return items.slice(0, 5);
}

/* ---------------------------------------------------
   STEP 2 — Google 뉴스 → 원문 URL 찾기
--------------------------------------------------- */

async function getRealArticleUrl(googleUrl) {
	try {
		const html = await fetch(googleUrl, {
			headers: { "User-Agent": "Mozilla/5.0" }
		}).then(r => r.text());

		const $ = cheerio.load(html);

		// canonical 링크가 실제 원문임
		const real = $("link[rel='canonical']").attr("href");

		return real || null;
	} catch (e) {
		return null;
	}
}

/* ---------------------------------------------------
   STEP 3 — 실제 기사 본문 추출
--------------------------------------------------- */

async function extractArticle(url) {
	try {
		const html = await fetch(url, {
			headers: { "User-Agent": "Mozilla/5.0" }
		}).then(r => r.text());

		const $ = cheerio.load(html);

		// 더 많은 셀렉터 추가
		const selectors = [
			"article",
			"#news_body_area",
			"#article_body",
			".article_body",
			".news_end",
			".post-content",
			"#content",
			".article-view",
			".view_txt",
		];

		for (const sel of selectors) {
			const text = $(sel).text().trim();
			if (text.length > 200) return text;
		}

		return null;
	} catch (err) {
		return null;
	}
}

/* ---------------------------------------------------
   STEP 4 — OpenAI 요약
--------------------------------------------------- */

async function summarize(text) {
	const prompt = `
아래 뉴스 기사를 2~3줄의 자연스러운 한국어로 요약해줘.
항상 문장을 평서문으로 끝내줘.

기사 내용:
${text}
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
	}).then(r => r.json());

	return response?.choices?.[0]?.message?.content || "요약 실패";
}
