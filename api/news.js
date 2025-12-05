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

	// HF 토큰 없으면 simpleSummary 강제 사용
	if (!HF_TOKEN) {
		return simpleSummary(text || title, 3);
	}

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

	// 부분 요약 함수
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

	// partial summarize
	const partialSummaries = [];
	for (const chunk of chunks) {
		const part = await summarizeChunk(chunk);
		if (part) partialSummaries.push(part);
	}

	// HF 요약 완전 실패 → simpleSummary
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

		// 문장 분할 후 2~3문장 선택
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
// 네이버 PC 뉴스 → 모바일 뉴스 변환
// ----------------------------------------------
function toMobileUrl(url) {
	try {
		if (url.includes("news.naver.com")) {
			return url.replace("news.naver.com", "m.news.naver.com");
		}
	} catch {}
	return url;
}

// ----------------------------------------------
// HTML → 텍스트 추출 (#dic_area)
// ----------------------------------------------
function extractText(html) {
	try {
		const cleaned = html
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

		// 네이버 모바일 기사 본문
		const dicMatch = cleaned.match(
			/<div[^>]*id=["']dic_area["'][^>]*>([\s\S]*?)<\/div>/
		);

		if (dicMatch) {
			return dicMatch[1]
				.replace(/<[^>]+>/g, " ")
				.replace(/\s+/g, " ")
				.trim();
		}

		// fallback
		return cleaned
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	} catch {
		return "";
	}
}

// ----------------------------------------------
// 네이버 뉴스 검색 API 호출
// ----------------------------------------------
async function getNaverNews(query) {
	const NAVER_ID = process.env.NAVER_CLIENT_ID;
	const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;

	if (!NAVER_ID || !NAVER_SECRET) {
		console.error("네이버 API 키 없음");
		return [];
	}

	const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(
		query
	)}&display=10&sort=sim`;

	try {
		const res = await fetch(url, {
			headers: {
				"X-Naver-Client-Id": NAVER_ID,
				"X-Naver-Client-Secret": NAVER_SECRET,
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
	} catch {
		return [];
	}
}

// ----------------------------------------------
// API Handler (Vercel Serverless)
// ----------------------------------------------
export default async function handler(req, res) {
	const { query } = req.query;

	if (!query) {
		return res.status(400).json({ error: "query 파라미터가 필요합니다." });
	}

	try {
		const articles = await getNaverNews(query);
		const result = [];

		for (const article of articles) {
			const mobileUrl = toMobileUrl(article.url);
			let summary = "";

			try {
				const html = await fetch(mobileUrl).then((r) => r.text());
				const text = extractText(html);
				summary = await summarize(text, article.title);
			} catch {
				summary = simpleSummary(article.title, 3);
			}

			result.push({
				title: article.title,
				url: article.url,
				summary,
			});
		}

		return res.status(200).json({ articles: result });
	} catch (e) {
		console.error(e);
		return res.status(500).json({ error: "서버 내부 오류" });
	}
}
