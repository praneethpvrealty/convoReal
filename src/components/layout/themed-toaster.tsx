"use client";

import { Toaster } from "sonner";

import { useTheme } from "@/hooks/use-theme";

/**
 * Sonner toaster that follows the light/dark mode toggle. The old
 * root-layout Toaster hardcoded dark slate — fine when the app had
 * one look, unreadable floating over a light page.
 */
export function ThemedToaster() {
  const { mode } = useTheme();
  const dark = mode === "dark";
  return (
    <Toaster
      theme={dark ? "dark" : "light"}
      position="top-right"
      toastOptions={{
        style: dark
          ? {
              background: "rgb(30 41 59)",
              border: "1px solid rgb(51 65 85)",
              color: "white",
            }
          : {
              background: "#ffffff",
              border: "1px solid rgb(203 213 225)",
              color: "rgb(15 23 42)",
            },
      }}
    />
  );
}
