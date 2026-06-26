import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from "react-router-dom";
import { AuthProvider, RequireAuth } from "@/app/auth";
import { AppShell } from "@/app/AppShell";
import { OverviewPage } from "@/pages/OverviewPage";
import { LoginPage, SetupPage } from "@/pages/AuthPages";
import { NotFoundPage, RouteErrorPage } from "@/pages/ErrorPages";
import { HostsListPage } from "@/pages/HostsListPage";
import { HostDetailPage } from "@/pages/HostsDetailPage";
import { HostFormPage } from "@/pages/HostFormPage";
import { JobsListPage } from "@/pages/JobsListPage";
import { JobDetailPage } from "@/pages/JobDetailPage";
import { RecipesListPage } from "@/pages/RecipesListPage";
import { RecipeDetailPage } from "@/pages/RecipeDetailPage";
import { HostTopology } from "@/pages/HostTopology";
import { CredentialsListPage, CredentialCreatePage } from "@/pages/CredentialsPage";
import { LogsPage } from "@/pages/LogsPage";
import { AuditPage } from "@/pages/AuditPage";
import { TerminalPage } from "@/pages/TerminalPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { AgentBridgePage } from "@/pages/AgentBridgePage";

const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
    errorElement: <RouteErrorPage />,
  },
  {
    path: "/setup",
    element: <SetupPage />,
    errorElement: <RouteErrorPage />,
  },
  {
    path: "/",
    element: <RequireAuth />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: "hosts", element: <HostsListPage /> },
          { path: "hosts/new", element: <HostFormPage mode="create" /> },
          { path: "hosts/:hostId", element: <HostDetailPage /> },
          { path: "hosts/:hostId/edit", element: <HostFormPage mode="edit" /> },
          { path: "topology", element: <HostTopology /> },
          { path: "credentials", element: <CredentialsListPage /> },
          { path: "credentials/new", element: <CredentialCreatePage /> },
          { path: "jobs", element: <JobsListPage /> },
          { path: "jobs/:jobId", element: <JobDetailPage /> },
          { path: "recipes", element: <RecipesListPage /> },
          { path: "recipes/:name", element: <RecipeDetailPage /> },
          { path: "logs", element: <LogsPage /> },
          { path: "audit", element: <AuditPage /> },
          { path: "terminal", element: <TerminalPage /> },
          { path: "agents", element: <AgentBridgePage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
