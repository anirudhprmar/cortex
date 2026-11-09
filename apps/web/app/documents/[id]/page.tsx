"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import {
  formatDate,
  getJson,
  type DocumentDetail,
} from "@/lib/api";
import { Badge, ErrorMsg, Loading, PageHeader } from "@/components/ui";

export default function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    getJson<DocumentDetail>(`/documents/${id}`)
      .then(setDoc)
      .catch(setError);
  }, [id]);

  if (error) return <ErrorMsg error={error} />;
  if (!doc) return <Loading />;

  return (
    <div>
      <PageHeader
        title={doc.title ?? "<untitled>"}
        subtitle={`${doc.path} · updated ${formatDate(doc.updatedAt)}`}
        actions={
          <Link
            href="/documents"
            className="text-sm text-neutral-600 hover:text-neutral-900"
          >
            ← Back to documents
          </Link>
        }
      />
      <div className="mb-6 flex gap-2">
        <Badge tone={doc.scope === "work" ? "blue" : "neutral"}>
          scope: {doc.scope}
        </Badge>
        <Badge>{doc.modality}</Badge>
      </div>

      {doc.chunks.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Not extracted yet — no chunks or facts for this document.
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          {doc.chunks.map((chunk) => (
            <li
              key={chunk.id}
              className="rounded-lg border border-neutral-200 bg-white p-5"
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="font-mono text-xs text-neutral-500">
                  {chunk.headingPath.join(" / ") ||
                    `(chunk ${chunk.ordinal})`}
                </p>
                <p className="text-xs text-neutral-400">
                  lines {chunk.startLine}–{chunk.endLine}
                </p>
              </div>
              <pre className="mb-4 overflow-x-auto rounded bg-neutral-50 p-3 text-xs text-neutral-700 whitespace-pre-wrap">
                {chunk.content}
              </pre>
              {chunk.facts.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {chunk.facts.map((fact) => (
                    <li key={fact.id} className="text-sm text-neutral-700">
                      <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-sky-500 align-middle" />
                      {fact.claim}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-neutral-400">No facts in this chunk</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
