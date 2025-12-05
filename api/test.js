// api/test.js
export default function handler(req, res) {
	const hasKey = !!process.env.OPENAI_API_KEY;

	return res.status(200).json({
		openaiKey: hasKey ? "OK" : "MISSING",
		// 디버깅용으로 현재 NODE_ENV도 같이 보여주면 좋음
		env: process.env.NODE_ENV || "unknown",
	});
}
