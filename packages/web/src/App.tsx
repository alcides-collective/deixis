import { useSessions } from "./lib/useSessions.js";
import { Grid } from "./components/Grid.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { AggregateBar } from "./components/AggregateBar.js";

export default function App() {
  const sessions = useSessions();
  return (
    <main>
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-[13px] font-medium tracking-[0.05em] uppercase">Deixis</span>
        <ThemeToggle />
      </header>
      <AggregateBar sessions={sessions} />
      <Grid sessions={sessions} />
    </main>
  );
}
