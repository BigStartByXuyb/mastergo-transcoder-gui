import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "@/App"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import "@/index.css"

const container = document.getElementById("root")
if (!container) throw new Error("找不到 #root 挂载点")

createRoot(container).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster position="top-center" />
    </TooltipProvider>
  </StrictMode>
)
