import xml2js from "xml2js";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
	try {
		const query = req.query.query;
		if (!query) return res.status(400).json({ error: "Missing query" });

		// 1) RSS에서 기사 목록 가져오기
		const rssItems = await fetchGoogleRSS(query);

		// 2) 기사 상세 데이터 구성
		const articles = [];
		for (const item of rssItems) {
			const content = await extractArticle(item.url);

			let summary = "";
			if (content) summary = await summarize(content);
			else summary = "본문을 가져오지 못했습니다.";

			articles.push({
				title: item.title,
				url: item.url,
				summary,
			});
		}

		return res.status(200).json({ articles });

	} catch (err) {
		console.error(err);
		return res.status(500).json({ error: "Server Error" });
	}
}

/* ---------------------------------------------------
   STEP 1 — Google RSS로 뉴스 목록 가져오기
--------------------------------------------------- */
async function fetchGoogleRSS(keyword) {
	const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
		keyword
	)}&hl=ko&gl=KR&ceid=KR:ko`;

	const xml = await fetch(rssUrl).then((r) => r.text());

	const parsed = await xml2js.parseStringPromise(xml);

	const items =
		parsed.rss.channel[0].item?.map((i) => ({
			title: i.title[0],
			url: i.link[0], // RSS는 원문 링크를 바로 제공함!!
		})) ?? [];

	return items.slice(0, 5);
}

/* ---------------------------------------------------
   STEP 2 — 기사 본문 가져오기 (여러 패턴 지원)
--------------------------------------------------- */
async function extractArticle(url) {
	const response = await fetch(url, {
		redirect: "follow",
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
		},
	});

	const html = await response.text();
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
		if (text.length > 150) return text; // 충분히 길면 본문으로 인정
	}

	return null;
}

/* ---------------------------------------------------
   STEP 3 — GPT 요약 생성
--------------------------------------------------- */
async function summarize(text) {
	const clean = text.replace(/\s+/g, " ").trim();

	const prompt = `
아래 뉴스 기사의 전체 내용을 바탕으로 자연스럽고 명확한 한국어 요약문을 2~3줄로 작성해줘.
모든 문장은 평서문으로 끝나야 하고, 핵심 내용만 담아줘.

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
			max_tokens: 180,
		}),
	}).then((r) => r.json());

	return response?.choices?.[0]?.message?.content || "요약 실패";
}
