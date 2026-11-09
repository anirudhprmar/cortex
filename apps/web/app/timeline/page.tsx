"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDate, getJson, type TimelineResult } from "@/lib/api";
import { Badge, ErrorMsg, Loading, PageHeader } from "@/components/ui";

const LIMIT = 25;

const eventBadge = {
  "document.created": "new",
  "document.updated": "edited",
  "fact.extracted": "fact",
} as const;

const eventTone = {
  "document.created": "green",
  "document.updated": "blue",
  "fact.extracted": "neutral",
} as const;

export default function TimelinePage() {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<TimelineResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    getJson<TimelineResult>(`/timeline?limit=${LIMIT}&offset=${page * LIMIT}`)
      .then(setResult)
      .catch(setError);
  }, [page]);

  const hasMore = result ? result.events.length === LIMIT : false;

  return (
    <div>
      <PageHeader
        title="Timeline"
        subtitle="Documents added or edited, and facts extracted"
        actions={
          result && result.events.length > 0 ? (
            <div className="flex items-center gap-2 text-sm">
              <button
                className="rounded border border-neutral-300 bg-white px-2.5 py-1 hover:bg-neutral-100 disabled:opacity-40"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
              >
                Newer
              </button>
              <span className="text-neutral-500">page {page + 1}</span>
              <button
                className="rounded border border-neutral-300 bg-white px-2.5 py-1 hover:bg-neutral-100 disabled:opacity-40"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore}
              >
                Older
              </button>
            </div>
          ) : null
        }
      />
      {error ? <ErrorMsg error={error} /> : null}
      {!result && !error ? <Loading /> : null}
      {result && result.events.length === 0 ? (
        <p className="text-sm text-neutral-500">No events.</p>
      ) : null}
      {result && result.events.length > 0 ? (
        <ol className="flex max-w-3xl flex-col">
          {result.events.map((event, i) => (
            <li
              key={`${event.type}-${event.at}-${i}`}
              className="flex gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3"
            >
              <Badge tone={eventTone[event.type]}>
                {eventBadge[event.type]}
              </Badge>
              <div className="min-w-0 flex-1">
                {event.type === "fact.extracted" ? (
                  <p className="text-sm text-neutral-800">{event.claim}</p>
                ) : (
                  <p className="text-sm text-neutral-800">
                    <Link
                      href={`/documents/${event.documentId}`}
                      className="font-medium hover:underline"
                    >
                      {event.title ?? event.path}
                    </Link>
                  </p>
                )}
                <p className="truncate text-xs text-neutral-400">{event.path}</p>
              </div>
              <time
                dateTime={event.at}
                className="whitespace-nowrap text-xs text-neutral-500"
              >
                {formatDate(event.at)}
              </time>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
