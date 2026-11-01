"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import Workspace from "../components/workspace";
import { FormValidation } from "../components/form-validation";
export default function Page() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30000, refetchInterval: 60000, refetchOnWindowFocus: "always", retry: 1 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <FormValidation />
      <Workspace />
    </QueryClientProvider>
  );
}
