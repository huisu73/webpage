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

	// 전체 문장을 분리
	const sentences = splitSentences(base);
	if (sentences.length === 0) return "요약을 생성할 수 없습니다.";

	// 불용어(Stopwords) – 중요도 계산 보정용
	const stopwords = ["그리고", "하지만", "그러나", "또한", "이어서", "이에 따르면"];

	// 문장 중요도 점수 계산
	const scored = sentences.map((s, idx) => {
		let score = 0;

		// 1) 길이가 너무 짧은 문장은 제외
		if (s.length < 20) score -= 5;

		// 2) 중복되는 접두 불용어가 있으면 감점
		stopwords.forEach(sw => {
			if (s.startsWith(sw)) score -= 2;
		});

		// 3) 본문 전체에서 중요한 단어가 포함되면 가산점
		const keywords = ["수사", "요구", "혐의", "논란", "입장", "사과", "공식", "경찰"];
		keywords.forEach(kw => {
			if (s.includes(kw)) score += 3;
		});

		// 4) 본문 중간부의 문장도 골고루 선택되도록 가중치 부여
		const normalizedIndex = idx / sentences.length;
		if (normalizedIndex > 0.2 && normalizedIndex < 0.8) {
			score += 1.5;
		}

		return { sentence: s, score };
	});

	// 점수 TOP 3 문장 선택 (중복 없이)
	const topSentences = scored
		.sort((a, b) => b.score - a.score)
		.slice(0, 3)
		.map(item => forcePeriod(item.sentence));

	// 한 줄 요약 (가장 점수 높은 문장을 선택)
	const headline = forcePeriod(scored.sort((a, b) => b.score - a.score)[0].sentence);

	return `${headline}\n${topSentences.join("\n")}`;
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
