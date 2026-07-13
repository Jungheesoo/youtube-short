import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar.jsx";
import TopicPage from "./pages/TopicPage.jsx";
import ImagePage from "./pages/ImagePage.jsx";
import NarrationPage from "./pages/NarrationPage.jsx";
import RenderPage from "./pages/RenderPage.jsx";

export default function App() {
  return (
    <div className="layout">
      <Sidebar />
      <main className="content">
        <Routes>
          <Route path="/" element={<TopicPage />} />
          <Route path="/projects/:id/images" element={<ImagePage />} />
          <Route path="/projects/:id/narration" element={<NarrationPage />} />
          <Route path="/projects/:id/render" element={<RenderPage />} />
        </Routes>
      </main>
    </div>
  );
}
