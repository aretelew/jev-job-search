import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { App } from "./App";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSystemTheme } from "@/lib/theme";

function Root() {
  const theme = useSystemTheme();
  return (
    <TooltipProvider>
      <App />
      <Toaster theme={theme} position="bottom-right" />
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
