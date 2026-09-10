import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { HeatmapPage } from "./pages/HeatmapPage";

// The backend's SPA fallback serves index.html for any non-/api path, so
// deep links to /map work in production.
export function App() {
	return (
		<BrowserRouter>
			<Routes>
				<Route path="/" element={<Dashboard />} />
				<Route path="/map" element={<HeatmapPage />} />
			</Routes>
		</BrowserRouter>
	);
}
