import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";

export default function TopicPage() {
  const [topic, setTopic] = useState("");
  const [recommendations, setRecommendations] = useState([]);
  const [loadingRec, setLoadingRec] = useState(false);
  const [hasRequestedRec, setHasRequestedRec] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  async function handleRecommend() {
    setLoadingRec(true);
    setError(null);
    setHasRequestedRec(true);
    try {
      const data = await api.recommendTopics();
      setRecommendations(data.topics);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingRec(false);
    }
  }

  async function handleCreate(selectedTopic, category) {
    setCreating(true);
    setError(null);
    try {
      const { projectId } = await api.createProject(selectedTopic, category);
      navigate(`/projects/${projectId}/images`);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page">
      <h1>오늘의 "만약에" 주제</h1>

      <div className="topic-input">
        <input
          type="text"
          placeholder='예: 만약 고려시대에 클럽에서 춤을 췄다면?'
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <button disabled={!topic || creating} onClick={() => handleCreate(topic, "직접입력")}>
          {creating ? "대본 생성 중..." : "대본 생성 시작"}
        </button>
      </div>

      <h2>Claude 추천 주제</h2>
      <p className="tip">버튼을 누르면 그때 Claude API를 호출해서 추천을 받아옵니다 (페이지 진입만으로는 호출되지 않음).</p>
      <button onClick={handleRecommend} disabled={loadingRec}>
        {loadingRec ? "추천 받는 중..." : hasRequestedRec ? "다시 추천받기" : "주제 추천받기"}
      </button>
      {error && <p className="error">{error}</p>}

      {hasRequestedRec && !loadingRec && recommendations.length === 0 && !error && (
        <p>추천할 주제가 없습니다.</p>
      )}

      <div className="recommend-grid">
        {recommendations.map((rec, i) => (
          <div key={i} className="recommend-card">
            <h3>{rec.topic}</h3>
            <span className="category-badge">{rec.category}</span>
            <p>{rec.reason}</p>
            <button disabled={creating} onClick={() => handleCreate(rec.topic, rec.category)}>
              이 주제로 시작
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
