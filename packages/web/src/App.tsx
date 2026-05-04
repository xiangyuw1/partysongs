import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Guest from './pages/Guest';
import Admin from './pages/Admin';
import Player from './pages/Player';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <nav className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-purple-400">
            🎵 PartySongs
          </Link>
          <div className="flex gap-4 text-sm">
            <Link to="/guest" className="text-slate-300 hover:text-white">点歌</Link>
          </div>
        </nav>
        <Routes>
          <Route path="/" element={<Guest />} />
          <Route path="/guest" element={<Guest />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/player" element={<Player />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
