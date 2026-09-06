import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "@/components/dashboard";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <main className="min-h-dvh bg-bg">
        <Dashboard />
      </main>
    </QueryClientProvider>
  );
}
