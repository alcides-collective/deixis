import { useEffect, useState } from "react";

export type Layout = "feed" | "masonry";

function initial(): Layout {
  const saved = localStorage.getItem("deixis-layout");
  return saved === "masonry" || saved === "feed" ? saved : "feed";
}

export function useLayout(): { layout: Layout; setLayout: (l: Layout) => void } {
  const [layout, setLayout] = useState<Layout>(initial);
  useEffect(() => {
    localStorage.setItem("deixis-layout", layout);
  }, [layout]);
  return { layout, setLayout };
}
