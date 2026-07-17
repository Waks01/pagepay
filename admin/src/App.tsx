import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/shared/components/Layout";
import { LoginPage } from "@/features/auth/LoginPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { UsersPage } from "@/features/users/UsersPage";
import { FinancePage } from "@/features/finance/FinancePage";
import { ContentPage } from "@/features/content/ContentPage";
import { FraudPage } from "@/features/fraud/FraudPage";
import { ConfigPage } from "@/features/config/ConfigPage";
import { LogsPage } from "@/features/logs/LogsPage";
import { TasksPage } from "@/features/tasks/TasksPage";
import { AnalyticsPage } from "@/features/analytics/AnalyticsPage";
import { AiHealthPage } from "@/features/ai/AiHealthPage";
import { AdminsPage } from "@/features/admins/AdminsPage";
import { CommunityPage } from "@/features/community/CommunityPage";
import { AdDashboardPage } from "@/features/ads";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="admins" element={<AdminsPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="content" element={<ContentPage />} />
        <Route path="community" element={<CommunityPage />} />
        <Route path="fraud" element={<FraudPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="ads" element={<AdDashboardPage />} />
        <Route path="ai-health" element={<AiHealthPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="logs" element={<LogsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
