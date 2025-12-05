import fetch from "node-fetch";

// ----------------------------------------------
// simpleSummary: HF 실패 시 항상 동작하는 안전 요약
// ----------------------------------------------
function simpleSummary(text, maxSentences = 3) {
	if (!text) return "요약할 내용이 없습니다.";

	const clean = text.replace(/\s+/g, " ");
	const sentences = clean
		.split(/(?<=[\.!?])\s+/)
		.map((s) => s.trim())
		.filter(Boolean);

	return sentences.slice(0, maxSentences).join(" ");
}

// ----------------------------------------------
// 긴 기사 요약 (HF chunk summarization + fallback)
// ----------------------------------------------
async function summarize(text, title) {
	const HF_TOKEN = process.env.HF_TOKEN;

	if (!HF_TOKEN) return simpleSummary(text || title, 3);

	const cleanText = (text || title || "")
		.replace(/\s+/g, " ")
		.replace(/<[^>]+>/g, "")
		.trim();

	if (!cleanText) return simpleSummary(title, 3);

	// chunk 나누기 (900자 단위)
	const chunkSize = 900;
	const chunks = [];
	for (let i = 0; i < cleanText.length; i += chunkSize) {
		chunks.push(cleanText.slice(i, i + chunkSize));
	}

	const HF_URL = "https://api-inference.huggingface.co/models/sshleifer/distilbart-cnn-12-6";

	// 부분 요약
	async function summarizeChunk(chunk) {
		const payload = {
			inputs: chunk,
			parameters: { max_length: 120, min_length: 40, do_sample: false },
		};

		try {
			const res = await fetch(HF_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${HF_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			});

			const data = await res.json();
			return data?.[0]?.summary_text || "";
		} catch {
			return "";
		}
	}

	const partialSummaries = [];
	for (const chunk of chunks) {
		const part = await summarizeChunk(chunk);
		if (part) partialSummaries.push(part);
	}

	// HF 완전 실패 → simpleSummary
	if (partialSummaries.length === 0) {
		return simpleSummary(cleanText, 3);
	}

	const combined = partialSummaries.join(" ");

	// 최종 요약
	const finalPayload = {
		inputs: combined,
		parameters: { max_length: 150, min_length: 60, do_sample: false },
	};

	try {
		const finalRes = await fetch(HF_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${HF_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(finalPayload),
		});
		const finalData = await finalRes.json();
		let finalText = finalData?.[0]?.summary_text || "";

		let sentences = finalText
			.replace(/\n+/g, " ")
			.split(/\.|\?|!/g)
			.map((s) => s.trim())
			.filter(Boolean);

		sentences = sentences.slice(0, 3).map((s) => s + ".");
		return sentences.join("\n");
	} catch {
		return simpleSummary(cleanText, 3);
	}
}

// ----------------------------------------------
// PC 뉴스 URL → 모바일 뉴스 URL로 변환
// ----------------------------------------------
function normalizeNaverUrl(url) {
	try {
		const oidMatch = url.match(/oid=(\d+)/);
		const aidMatch = url.match(/aid=(\d+)/);

		if (oidMatch && aidMatch) {
			const oid = oidMatch[1];
			const aid = aidMatch[1];
			return `https://m.news.naver.com/article/${oid}/${aid}`;
		}
	} catch {}

	return url;
}

// ----------------------------------------------
// HTML → 기사 본문(#dic_area) 추출
// ----------------------------------------------
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

			// 기자명, 날짜 제거
			text = text.replace(/^\[[^\]]+\]/, "");
			text = text.replace(/\d{4}\.\d{2}\.\d{2}\s*\d{2}:\d{2}/, "");

			return text;
		}

		return "";
	} catch {
		return "";
	}
}

// ----------------------------------------------
// 네이버 뉴스 검색 API
// ----------------------------------------------
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
		title: item.title
			.replace(/<[^>]+>/g, "")
			.replace(/&quot;/g, '"')
			.replace(/&amp;/g, "&"),
		url: item.originallink || item.link,
	}));
}

// ----------------------------------------------
// API Handler
// ----------------------------------------------
export default async function handler(req, res) {
	const { query } = req.query;

	if (!query) {
		return res.status(400).json({ error: "query 파라미터가 필요합니다." });
	}

	const articles = await getNaverNews(query);
	const result = [];

	for (const article of articles) {
		const mobile = normalizeNaverUrl(article.url);

		let finalText = "";
		try {
			const html = await fetch(mobile).then((r) => r.text());
			finalText = extractArticle(html);
		} catch {}

		const summary = await summarize(finalText, article.title);

		result.push({
			title: article.title,
			url: article.url,
			summary,
		});
	}

	return res.status(200).json({ articles: result });
}
