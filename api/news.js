// 긴 텍스트도 안정적으로 요약하는 함수 (옵션 A)
async function summarize(text, title) {
    const HF_TOKEN = process.env.HF_TOKEN;
    if (!HF_TOKEN) return "요약 생성 실패(HF_TOKEN 없음)";

  // ---------------------------
  // 1) 텍스트 정제
  // ---------------------------
    const cleanText = (text || title || "")
        .replace(/\s+/g, " ")
        .replace(/<[^>]+>/g, "")
        .trim();

    if (!cleanText) return "요약 생성 실패(본문 없음)";

  // ---------------------------
  // 2) 청크(부분) 나누기 (각 900자)
  // ---------------------------
    const chunkSize = 900;
    const chunks = [];

    for (let i = 0; i < cleanText.length; i += chunkSize) {
        chunks.push(cleanText.slice(i, i + chunkSize));
    }

  // 요약 모델 URL
    const HF_URL = "https://api-inference.huggingface.co/models/sshleifer/distilbart-cnn-12-6";

  // ---------------------------
  // 3) 각 청크별 부분 요약
  // ---------------------------
    async function summarizeChunk(chunk) {
        const payload = {
            inputs: chunk,
            parameters: {
                max_length: 120,
                min_length: 40,
                do_sample: false
            }
        };

        try {
            const res = await fetch(HF_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${HF_TOKEN}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            return data?.[0]?.summary_text || "";
        } catch (e) {
        console.error("Chunk summary error:", e);
        return "";
        }
    }

  // 모든 부분 요약 실행
    const partialSummaries = [];
    for (const chunk of chunks) {
        const part = await summarizeChunk(chunk);
        if (part) partialSummaries.push(part);
    }

    if (partialSummaries.length === 0) {
        return "요약 생성 실패(부분 요약 실패)";
    }

  // ---------------------------
  // 4) 부분 요약들을 합쳐서 하나의 텍스트로 결합
  // ---------------------------
    const combinedSummary = partialSummaries.join(" ");

  // ---------------------------
  // 5) 최종 요약 → 3줄 요약
  // ---------------------------
    const finalPayload = {
        inputs: combinedSummary,
        parameters: {
        max_length: 130,
        min_length: 60,
        do_sample: false
        }
    };

    try {
        const finalRes = await fetch(HF_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(finalPayload)
        });

    const finalData = await finalRes.json();
    const finalText = finalData?.[0]?.summary_text || "";

    // 3줄로 정제
    const lines = finalText
        .replace(/\n+/g, " ")
        .split(/\.|\?|\!/g)
        .filter(Boolean)
        .slice(0, 3)
        .map((s) => s.trim() + ".");

    return lines.join("\n");
    } catch (e) {
    console.error("Final summary error:", e);
    return "요약 생성 실패(최종 단계 오류)";
    }
}
