import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";

import "./styles/globals.css";

import { AppShell } from "./layout/AppShell";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { ReposPage } from "./pages/Repos";
import { AddRepoPage } from "./pages/AddRepo";
import { RepoDetailPage } from "./pages/RepoDetail";
import { JobsPage } from "./pages/Jobs";
import { ReviewDetailPage } from "./pages/ReviewDetail";
import { SettingsPage } from "./pages/Settings";
import { TicketsPage } from "./pages/Tickets";
import { TicketDetailPage } from "./pages/TicketDetail";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

if ("serviceWorker" in navigator) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    if ("caches" in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  } else {
    registerSW({ immediate: true });
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<Navigate to="/login" replace />} />
          <Route path="/app" element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="repos" element={<ReposPage />} />
            <Route path="repos/new" element={<AddRepoPage />} />
            <Route path="repos/:id" element={<RepoDetailPage />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="tickets/:id" element={<TicketDetailPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="reviews/:jobId" element={<ReviewDetailPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
