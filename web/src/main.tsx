import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installFocusModality } from "./lib/focusModality";
import "./index.css";

installFocusModality();

const root = document.getElementById("root");
if (!root) throw new Error("Archer: #root element missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
