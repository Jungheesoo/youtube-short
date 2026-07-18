import { useEffect, useRef, useState } from "react";
import { api, toOutputUrl } from "../api/client.js";

const VOICE_OPTIONS = [
  "ko-KR-Wavenet-A",
  "ko-KR-Wavenet-B",
  "ko-KR-Wavenet-C",
  "ko-KR-Wavenet-D",
  "ko-KR-Neural2-A",
  "ko-KR-Neural2-B",
  "ko-KR-Neural2-C",
  "ko-KR-Chirp3-HD-Charon",
];

const SPEAKERS = [
  { key: "narrator", label: "나레이터" },
  { key: "characterA", label: "캐릭터 A" },
  { key: "characterB", label: "캐릭터 B" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewingSpeaker, setPreviewingSpeaker] = useState(null);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    api
      .getVoiceSettings()
      .then(setSettings)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  function handleChange(speakerKey, value) {
    setSettings((prev) => ({ ...prev, [speakerKey]: value }));
  }

  async function handlePreview(speakerKey) {
    const voiceName = settings[speakerKey];
    if (!voiceName) return;

    setError(null);
    setPreviewingSpeaker(speakerKey);
    try {
      const { audioPath } = await api.previewVoice(voiceName);
      const url = toOutputUrl(audioPath);
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPreviewingSpeaker(null);
      await audio.play();
    } catch (e) {
      setError(e.message);
      setPreviewingSpeaker(null);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateVoiceSettings(settings);
      setSettings(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="page">불러오는 중...</div>;

  return (
    <div className="page">
      <h1>보이스 설정</h1>
      <p className="tip">화자별로 사용할 TTS 보이스를 지정합니다. 미리듣기로 목소리를 확인한 뒤 저장하세요.</p>

      {error && <p className="error">{error}</p>}

      <div className="settings-form">
        {SPEAKERS.map((speaker) => (
          <div key={speaker.key} className="settings-row">
            <label>{speaker.label}</label>
            <div className="settings-row-controls">
              <select
                value={settings[speaker.key] || ""}
                onChange={(e) => handleChange(speaker.key, e.target.value)}
              >
                {VOICE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <button onClick={() => handlePreview(speaker.key)} disabled={previewingSpeaker === speaker.key}>
                {previewingSpeaker === speaker.key ? "재생 중..." : "▶ 미리듣기"}
              </button>
            </div>
          </div>
        ))}

        <button onClick={handleSave} disabled={saving}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
