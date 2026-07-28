import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FlagStudio } from "./FlagStudio";
import "./styles.css";
import "./root.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("No se encontró el contenedor principal.");
}

createRoot(root).render(
  <StrictMode>
    <FlagStudio />
  </StrictMode>,
);
