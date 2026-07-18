import React from "react";
import ReactDOM from "react-dom/client";
import { ChakraProvider, extendTheme } from "@chakra-ui/react";
import { App } from "@/app/App";
import "@/styles/globals.css";

// Modern Slate Dark Theme Config
const theme = extendTheme({
  config: {
    initialColorMode: "dark",
    useSystemColorMode: false,
  },
  fonts: {
    heading: "'Geist', -apple-system, sans-serif",
    body: "'Geist', -apple-system, sans-serif",
    mono: "'JetBrains Mono', monospace",
  },
  colors: {
    brand: {
      50: "#dbfcff",
      100: "#dbfcff",
      200: "#7df4ff",
      300: "#00f0ff", // Electric Cyan
      400: "#00dbe9",
      500: "#006970",
      600: "#004f54",
      700: "#00363a",
      800: "#002022",
      900: "#001011",
    },
    obsidian: {
      bg: "#0A0A0C",
      surface: "#121214",
      surfaceHigh: "#18181B",
      border: "#1F1F23",
      borderHigh: "#2D2D33",
      cyan: "#00F0FF",
      green: "#39FF14",
      red: "#FF3131",
      onSurface: "#e5e1e4",
      onSurfaceVariant: "#b9cacb",
    },
  },
  radii: {
    sm: "2px",
    md: "4px",
    lg: "4px",
    xl: "8px",
  },
  styles: {
    global: {
      "html, body, #root": {
        maxWidth: "100%",
        overflowX: "hidden",
      },
      body: {
        bg: "#0A0A0C",
        color: "#e5e1e4",
        fontFamily: "'Geist', -apple-system, sans-serif",
      },
      "::-webkit-scrollbar": {
        width: "8px",
        height: "8px",
      },
      "::-webkit-scrollbar-track": {
        background: "#0A0A0C",
      },
      "::-webkit-scrollbar-thumb": {
        background: "#1F1F23",
        borderRadius: "4px",
      },
      "::-webkit-scrollbar-thumb:hover": {
        background: "#2D2D33",
      },
    },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root element in index.html");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ChakraProvider theme={theme}>
      <App />
    </ChakraProvider>
  </React.StrictMode>,
);

