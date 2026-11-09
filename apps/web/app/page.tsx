"use client";

import { useEffect, useState } from "react";
import { getJson, type DashboardStatus } from "@/lib/api";
import { Badge, Empty, ErrorMsg, Loading, PageHeader } from "@/components/ui";

type Panel = {
  label: string;
  total: number;
  rows: { label: string; count: number; tone: BadgeProps }[];
};
type BadgeProps = "neutral" | "green" | "amber" | "blue" | "red";

export default function StatusPage() {
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    getJson<DashboardStatus>("/status")
      .then(setStatus)
      .catch(setError);
  }, []);

  let panels: Panel[] = [];
  if (status) {
    const scopeRows = Object.entries(status.documents.byScope).map(
      ([scope, count]) => ({ label: scope, count, tone: "blue" as BadgeProps }),
    );
    const entityRows = Object.entries(status.entities.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ label: type, count, tone: "neutral" as BadgeProps }));

    panels = [
      {
        label: "Documents",
        total: status.documents.total,
        rows: scopeRows.length > 0 ? scopeRows : [{ label: "no scopes", count: 0, tone: "neutral" }],
      },
      {
        label: "Facts",
        total: status.facts.total,
        rows: [
          { label: "active", count: status.facts.active, tone: "green" },
          { label: "superseded", count: status.facts.superseded, tone: "amber" },
        ],
      },
      {
        label: "Entities",
        total: status.entities.total,
        rows: entityRows.slice(0, 4),
      },
      {
        label: "Proposals",
        total:
          status.proposals.pending +
          status.proposals.approved +
          status.proposals.rejected,
        rows: [
          { label: "pending", count: status.proposals.pending, tone: "amber" },
          { label: "approved", count: status.proposals.approved, tone: "green" },
          { label: "rejected", count: status.proposals.rejected, tone: "red" },
        ],
      },
    ];
  }

  return (
    <div>
      <PageHeader
        title="Status"
        subtitle="Counts across documents, facts, entities and proposals"
      />
      {error ? <ErrorMsg error={error} /> : null}
      {!status && !error ? <Loading /> : null}
      {status ? (
        status.facts.total === 0 && status.documents.total === 0 ? (
          <Empty label="Nothing ingested yet" />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {panels.map((panel) => (
              <div
                key={panel.label}
                className="rounded-lg border border-neutral-200 bg-white p-5"
              >
                <p className="text-sm text-neutral-500">{panel.label}</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight">
                  {panel.total}
                </p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {panel.rows.map((row) => (
                    <li
                      className="flex items-center gap-1 text-xs text-neutral-600"
                      key={`${row.label}-${row.count}`}
                    >
                      <Badge tone={row.tone}>{row.label}</Badge>
                      {row.count}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
