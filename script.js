const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const loadingEl = document.getElementById("loading");
const resultContainer = document.getElementById("resultCard");

function showLoading(isLoading) {
	if (isLoading) {
		loadingEl.classList.remove("hidden");
		searchBtn.disabled = true;
		searchBtn.textContent = "검색 중...";
	} else {
		loadingEl.classList.add("hidden");
		searchBtn.disabled = false;
		searchBtn.textContent = "검색";
	}
}

function handleError(error) {
	console.error(error);
	showLoading(false);
	resultContainer.innerHTML = `
		<div class="news-card">
			<p class="news-summary">
				죄송합니다. 뉴스를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
			</p>
		</div>
	`;
}

// 핵심 함수: 뉴스 검색 + 요약 결과 가져오기
async function getNews(keyword) {
	if (!keyword || !keyword.trim()) return;

	showLoading(true);
	resultContainer.innerHTML = "";

	try {
		const res = await fetch(`/api/news?query=${encodeURIComponent(keyword.trim())}`);
		if (!res.ok) {
			throw new Error(`API error: ${res.status}`);
		}

		const data = await res.json();
		const articles = data.articles || [];

		if (articles.length === 0) {
			showLoading(false);
			resultContainer.innerHTML = `
				<div class="news-card">
					<p class="news-summary">
						"${keyword}"(으)로 검색된 뉴스가 없습니다. 다른 키워드로 검색해보세요.
					</p>
				</div>
			`;
			return;
		}

		// 카드 리스트 렌더링
		resultContainer.innerHTML = "";
		articles.forEach((article) => {
			const card = document.createElement("article");
			card.className = "news-card";

			card.innerHTML = `
				<div class="news-header">
					<h3 class="news-title">${article.title}</h3>
				</div>
				<p class="news-summary">${article.summary}</p>
				<div class="news-footer">
					<a href="${article.url}" target="_blank" class="news-link">원문 보기 →</a>
				</div>
			`;

			resultContainer.appendChild(card);
		});

		showLoading(false);
	} catch (error) {
		handleError(error);
	}
}

// 이벤트 바인딩
searchBtn.addEventListener("click", () => {
	const keyword = searchInput.value;
	getNews(keyword);
});

searchInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		const keyword = searchInput.value;
		getNews(keyword);
	}
});
