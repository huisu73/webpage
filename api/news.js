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
	// 가장 길고 정보량 많은 문장 1개 선정
	let longest = sentList[0];
	for (const s of sentList) {
		if (s.length > longest.length) longest = s;
	}
	return longest;
}

async function summarize(text) {
	const base = cleanText(text);
	if (!base) return "요약을 생성할 수 없습니다.";

	const sentences = splitSentences(base);

	// 핵심 문장(첫 줄 요약)
	const keySentence = extractKeySentence(sentences);
	const keyLine = forcePeriod(keySentence);

	// 본문 요약 문장: 앞에서 의미 있는 문장 2~3개만
	const body = sentences.slice(0, 3).map(forcePeriod).join("\n");

	// 최종 요약
	return `${keyLine}\n${body}`;
}
