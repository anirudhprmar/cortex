"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getJson, type EntitiesResult } from "@/lib/api";
import { Badge, ErrorMsg, Loading, PageHeader } from "@/components/ui";

const TYPES = [
  "",
  "person",
  "tool",
  "concept",
  "project",
  "organization",
  "place",
  "event",
  "other",
] as const;

const LIMIT = 50;

export default function EntitiesPage() {
  const [type, setType] = useState<string>("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<EntitiesResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    const typeParam = type ? `&type=${encodeURIComponent(type)}` : "";
    getJson<EntitiesResult>(
      `/entities?limit=${LIMIT}&offset=${page * LIMIT}${typeParam}`,
    )
      .then(setResult)
      .catch(setError);
  }, [type, page]);

  const pageCount = result ? Math.ceil(result.total / LIMIT) : 0;

  return (
    <div>
      <PageHeader
        title="Entities"
        subtitle={result ? `${result.total} matching` : undefined}
        actions={
          result && result.total > LIMIT ? (
            <div className="flex items-center gap-2 text-sm">
              <button
                className="rounded border border-neutral-300 bg-white px-2.5 py-1 hover:bg-neutral-100 disabled:opacity-40"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
              >
                Prev
              </button>
              <span className="text-neutral-500">
                page {page + 1} of {pageCount || 1}
              </span>
              <button
                className="rounded border border-neutral-300 bg-white px-2.5 py-1 hover:bg-neutral-100 disabled:opacity-40"
                onClick={() => setPage((p) => p + 1)}
                disabled={page + 1 >= pageCount}
              >
                Next
              </button>
            </div>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TYPES.map((value) => (
          <button
            key={value || "all"}
            onClick={() => {
              setType(value);
              setPage(0);
            }}
            className={`rounded-full border px-3 py-1 text-xs ${
              type === value
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            {value || "All"}
          </button>
        ))}
      </div>
      {error ? <ErrorMsg error={error} /> : null}
      {!result && !error ? <Loading /> : null}
      {result && result.items.length === 0 ? (
        <p className="text-sm text-neutral-500">No entities of this type.</p>
      ) : null}
      {result && result.items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Active facts
                </th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((entity) => (
                <tr
                  key={entity.id}
                  className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/entities/${encodeURIComponent(entity.name)}`}
                      className="font-medium text-neutral-900 hover:underline"
                    >
                      {entity.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={entity.type === "person" ? "blue" : "neutral"}>
                      {entity.type}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {entity.factCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
