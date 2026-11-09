"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  formatDate,
  getJson,
  type ListDocumentsResult,
} from "@/lib/api";
import { Badge, ErrorMsg, Loading, PageHeader } from "@/components/ui";

const LIMIT = 25;

export default function DocumentsPage() {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<ListDocumentsResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    getJson<ListDocumentsResult>(
      `/documents?limit=${LIMIT}&offset=${page * LIMIT}`,
    )
      .then(setResult)
      .catch(setError);
  }, [page]);

  const pageCount = result ? Math.ceil(result.total / LIMIT) : 0;

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle={result ? `${result.total} ingested` : undefined}
        actions={
          result && result.total > 0 ? (
            <div className="flex items-center gap-2 text-sm">
              <button
                className="rounded border border-neutral-300 bg-white px-2.5 py-1 hover:bg-neutral-100 disabled:opacity-40"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
              >
                Newer
              </button>
              <span className="text-neutral-500">
                page {page + 1} of {pageCount || 1}
              </span>
              <button
                className="rounded border border-neutral-300 bg-white px-2.5 py-1 hover:bg-neutral-100 disabled:opacity-40"
                onClick={() => setPage((p) => p + 1)}
                disabled={page + 1 >= pageCount}
              >
                Older
              </button>
            </div>
          ) : null
        }
      />
      {error ? <ErrorMsg error={error} /> : null}
      {!result && !error ? <Loading /> : null}
      {result && result.total === 0 ? (
        <p className="text-sm text-neutral-500">No documents yet.</p>
      ) : null}
      {result && result.items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2.5 font-medium">Document</th>
                <th className="px-4 py-2.5 font-medium">Scope</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Active facts
                </th>
                <th className="px-4 py-2.5 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((doc) => (
                <tr
                  key={doc.id}
                  className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                >
                  <td className="max-w-md px-4 py-2.5">
                    <Link
                      href={`/documents/${doc.id}`}
                      className="font-medium text-neutral-900 hover:underline"
                    >
                      {doc.title ?? "<untitled>"}
                    </Link>
                    <p className="truncate text-xs text-neutral-400">
                      {doc.path}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={doc.scope === "work" ? "blue" : "neutral"}>
                      {doc.scope}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {doc.activeFactCount}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-neutral-500">
                    {formatDate(doc.updatedAt)}
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
