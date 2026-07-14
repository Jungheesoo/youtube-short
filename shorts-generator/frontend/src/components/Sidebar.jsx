import { NavLink, useParams } from "react-router-dom";

const STEPS = [
  { key: "topic", label: "1. 주제 입력", path: "/" },
  { key: "images", label: "2. 이미지 생성", path: (id) => `/projects/${id}/images` },
  { key: "narration", label: "3. 나레이션", path: (id) => `/projects/${id}/narration` },
  { key: "render", label: "4. 합성/미리보기", path: (id) => `/projects/${id}/render` },
];

export default function Sidebar() {
  const { id } = useParams();

  return (
    <aside className="sidebar">
      <h2>마음온도</h2>
      <nav>
        {STEPS.map((step) => {
          const path = typeof step.path === "function" ? (id ? step.path(id) : "#") : step.path;
          const disabled = typeof step.path === "function" && !id;
          return (
            <NavLink
              key={step.key}
              to={path}
              className={({ isActive }) => `step ${isActive ? "active" : ""} ${disabled ? "disabled" : ""}`}
              onClick={(e) => disabled && e.preventDefault()}
            >
              {step.label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
