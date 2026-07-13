import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";

export default function TopicPage() {
  const [topic, setTopic] = useState("");
  const [recommendations, setRecommendations] = useState([]);
  const [loadingRec, setLoadingRec] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .recommendTopics()
      .then((data) => setRecommendations(data.topics))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingRec(false));
  }, []);

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
      {loadingRec && <p>추천 주제 불러오는 중...</p>}
      {error && <p className="error">{error}</p>}

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
