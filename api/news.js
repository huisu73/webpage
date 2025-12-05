import * as cheerio from "cheerio";

// ---------------------------------------------------
// API HANDLER
// ---------------------------------------------------
export default async function handler(req, res) {
	try {
		const query = req.query.query;
		if (!query) {
			return res.status(400).json({ error: "Missing query" });
		}

		// 1) 구글 뉴스 RSS에서 기사 목록 가져오기
		const results = await searchGoogleNews(query);

		const articles = [];

		for (const item of results) {
			const content = await extractArticle(item.url);

			let summary = "";
			if (content) {
				summary = await summarize(content);
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

// ---------------------------------------------------
// STEP 1: 구글 뉴스 RSS에서 기사 목록 가져오기
// ---------------------------------------------------
async function searchGoogleNews(keyword) {
	const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
		keyword
	)}&hl=ko&gl=KR&ceid=KR:ko`;

	const xml = await fetch(url, {
		headers: {
			"User-Agent": "Mozilla/5.0",
		},
	}).then((res) => res.text());

	// XML 모드로 로드
	const $ = cheerio.load(xml, { xmlMode: true });
	const items = [];

	$("item").each((_, el) => {
		const title = $(el).find("title").text().trim();
		let link = $(el).find("link").text().trim();

		if (!title || !link) return;

		items.push({ title, url: link });
	});

	// 너무 많으면 5개만 사용
	return items.slice(0, 5);
}

// ---------------------------------------------------
// STEP 2: 원문 페이지에서 실제 기사 본문 추출
// ---------------------------------------------------
async function extractArticle(url) {
	const resp = await fetch(url, {
		redirect: "follow",
		headers: {
			"User-Agent": "Mozilla/5.0",
		},
	});

	const html = await resp.text();
	const $ = cheerio.load(html);

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
		if (text.length > 200) {
			return text;
		}
	}

	return null;
}

// ---------------------------------------------------
// STEP 3: OpenAI(gpt-4o-mini)로 요약 생성
// ---------------------------------------------------
async function summarize(text) {
	const clean = text.replace(/\s+/g, " ").trim();

	const prompt = `
아래 뉴스 기사를 2~3줄로 자연스럽게 요약해줘.
모든 문장은 평서문으로 끝나야 하고, 핵심 내용이 잘 드러나야 해.

기사:
${clean}
`;

	const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
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

	return apiRes?.choices?.[0]?.message?.content || "요약을 생성할 수 없습니다.";
}
