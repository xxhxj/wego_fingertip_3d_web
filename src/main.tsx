import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { boot } from "./state/editor";
import * as editor from "./state/editor";
import "./styles.css";

declare global {
  interface Window {
    __wego?: typeof editor;
  }
}

window.__wego = editor;
boot();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
