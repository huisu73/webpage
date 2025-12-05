import fetch from "node-fetch";

/* --------------------------------------------------------
	텍스트 정리 함수
-------------------------------------------------------- */
function cleanText(text) {
	return text
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function splitSentences(text) {
	return text
		.split(/(?<=[.!?])\s+/)
		.map(s => s.trim())
		.filter(Boolean);
}

function forcePeriod(s) {
	if (!s) return "";
	return /[.!?]$/.test(s) ? s : s + ".";
}

function extractKeySentence(sentList) {
	let longest = sentList[0];
	for (const s of sentList) {
		if (s.length > longest.length) longest = s;
	}
	return longest;
}

/* --------------------------------------------------------
	강화된 요약 함수
-------------------------------------------------------- */
async function summarize(text) {
	const base = cleanText(text);
	if (!base) return "요약을 생성할 수 없습니다.";

	const sentences = splitSentences(base);

	const keySentence = extractKeySentence(sentences);
	const keyLine = forcePeriod(keySentence);

	const body = sentences.slice(0, 3).map(forcePeriod).join("\n");

	return `${keyLine}\n${body}`;
}

/* --------------------------------------------------------
	본문 추출 함수
-------------------------------------------------------- */
function extractArticle(html) {
	try {
		const cleaned = html
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

		const match = cleaned.match(
			/<div[^>]*id=["']dic_area["'][^>]*>([\s\S]*?)<\/div>/
		);

		if (match) {
			let text = match[1]
				.replace(/<[^>]+>/g, " ")
				.replace(/\s+/g, " ")
				.trim();

			text = text.replace(/^\[[^\]]+\]\s*/, "");

			return text;
		}

		return "";
	} catch {
		return "";
	}
}

/* --------------------------------------------------------
	네이버 뉴스 검색
-------------------------------------------------------- */
async function getNaverNews(query) {
	const ID = process.env.NAVER_CLIENT_ID;
	const SECRET = process.env.NAVER_CLIENT_SECRET;

	if (!ID || !SECRET) return [];

	const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(
		query
	)}&display=10&sort=sim`;

	const res = await fetch(url, {
		headers: {
			"X-Naver-Client-Id": ID,
			"X-Naver-Client-Secret": SECRET,
		},
	});

	const data = await res.json();
	if (!data.items) return [];

	return data.items.map((item) => ({
		title: item.title.replace(/<[^>]+>/g, "").trim(),
		url: item.link,
		snippet: item.description.replace(/<[^>]+>/g, "").trim()
	}));
}

/* --------------------------------------------------------
	PC → 모바일 네이버 URL 변환
-------------------------------------------------------- */
function normalizeNaverUrl(url) {
	try {
		if (url.includes("n.news.naver.com")) {
			return url.replace("n.news.naver.com", "m.news.naver.com");
		}

		const oidMatch = url.match(/oid=(\d+)/);
		const aidMatch = url.match(/aid=(\d+)/);

		if (oidMatch && aidMatch) {
			return `https://m.news.naver.com/article/${oidMatch[1]}/${aidMatch[1]}`;
		}
	} catch {}

	return url;
}

/* --------------------------------------------------------
	Vercel API Handler (필수)
-------------------------------------------------------- */
export default async function handler(req, res) {
	const { query } = req.query;

	if (!query) {
		return res.status(400).json({ error: "query 파라미터가 필요합니다." });
	}

	const articles = await getNaverNews(query);
	const result = [];

	for (const article of articles) {
		const mobile = normalizeNaverUrl(article.url);

		let bodyText = "";

		try {
			const html = await fetch(mobile).then(r => r.text());
			bodyText = extractArticle(html);
		} catch {
			bodyText = "";
		}

		if (!bodyText && article.snippet) {
			bodyText = article.snippet;
		}

		if (bodyText && article.title) {
			bodyText = bodyText.replace(article.title, "").trim();
		}

		const summary = await summarize(bodyText);

		result.push({
			title: article.title,
			url: article.url,
			summary
		});
	}

	return res.status(200).json({ articles: result });
}
