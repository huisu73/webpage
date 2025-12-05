import { load } from "cheerio";

// 메인 핸들러
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

			let summary = "";
			if (text) {
				summary = await summarize(text);
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
		console.error("API ERROR:", err);
		return res.status(500).json({ error: "Server error" });
	}
}

/* ---------------------------------------------------
   STEP 1 — Google News RSS 검색
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

		// 여기서는 일단 link 그대로 사용 (news.google.com/rss/articles/...)
		// fetch에서 redirect: "follow" 로 실제 언론사 기사 페이지까지 따라감
		items.push({ title, url: link });
	});

	// 최대 5개까지만 사용 (원하면 10개까지 늘려도 됨)
	return items.slice(0, 5);
}

/* ---------------------------------------------------
   STEP 2 — 기사 본문 추출
--------------------------------------------------- */

async function extractArticle(url) {
	if (!url) return null;

	try {
		const res = await fetch(url, {
			redirect: "follow",
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
			},
		});

		const html = await res.text();
		const $ = load(html);

		// 1차: 흔히 쓰이는 기사 본문 선택자들
		const selectors = [
			"article",
			"#articleBody",
			"#articeBody",
			".news_end",
			".article",
			".article-body",
			".post-content",
			"#content",
		];

		for (const sel of selectors) {
			const text = $(sel).text().replace(/\s+/g, " ").trim();
			if (text && text.length > 300) {
				return text;
			}
		}

		// 2차: 그래도 못 찾으면 body 전체에서 텍스트 추출
		let bodyText = $("body").text().replace(/\s+/g, " ").trim();
		if (bodyText.length > 400) {
			return bodyText;
		}

		return null;
	} catch (err) {
		console.error("Extract error:", err);
		return null;
	}
}

/* ---------------------------------------------------
   STEP 3 — OpenAI 요약 (2~3문장, 문장 끝마침 확실하게)
--------------------------------------------------- */

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

	return response?.choices?.[0]?.message?.content?.trim() || "요약을 생성하지 못했습니다.";
}
