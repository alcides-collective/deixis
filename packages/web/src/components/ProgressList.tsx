import type { Step, Status } from "@deixis/shared";

const dot: Record<Status, string> = {
  pending: "bg-status-pending",
  active: "bg-status-active",
  done: "bg-status-done",
  failed: "bg-status-failed",
  blocked: "bg-status-blocked",
};

function StepRow({ step, depth }: { step: Step; depth: number }) {
  return (
    <li>
      <div
        className="flex items-center gap-2 py-1 text-[13px]"
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        <span className={`size-2 rounded-full ${dot[step.status]}`} />
        <span className={step.status === "done" ? "opacity-60 line-through" : ""}>
          {step.name}
        </span>
        {step.note ? (
          <span className="text-[11px] text-muted-foreground">— {step.note}</span>
        ) : null}
      </div>
      {step.substeps?.length ? (
        <ul>{step.substeps.map((s) => <StepRow key={s.id} step={s} depth={depth + 1} />)}</ul>
      ) : null}
    </li>
  );
}

export function ProgressList({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  const flat = steps.flatMap((s) => [s, ...(s.substeps ?? [])]);
  const done = flat.filter((s) => s.status === "done").length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.05em] text-muted-foreground">
        <span>Progress</span>
        <span>{done}/{flat.length}</span>
      </div>
      <div className="mb-2 h-1 w-full rounded-full bg-muted">
        <div
          className="h-1 rounded-full bg-foreground transition-all duration-300"
          style={{ width: `${flat.length ? (done / flat.length) * 100 : 0}%` }}
        />
      </div>
      <ul>{steps.map((s) => <StepRow key={s.id} step={s} depth={0} />)}</ul>
    </div>
  );
}
