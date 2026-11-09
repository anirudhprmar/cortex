"use client";

import { useEffect, useState } from "react";
import { getApiResult, getJson, type EntitiesResult, type GraphResult } from "@/lib/api";
import { Badge, ErrorMsg, Loading, PageHeader } from "@/components/ui";
import GraphCanvas from "@/components/GraphCanvas";

const DEPTHS = [
  { value: 1, label: "1 — neighborhood" },
  { value: 2, label: "2 — friends of friends" },
  { value: 3, label: "3 — wide" },
  { value: 4, label: "4 — max" },
];

export default function GraphPage() {
  const [entity, setEntity] = useState("");
  const [depth, setDepth] = useState(1);
  const [submitted, setSubmitted] = useState({ entity: "", depth: 1 });
  const [graph, setGraph] = useState<Extract<GraphResult, { status: "found" }> | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  const [selectedFact, setSelectedFact] = useState<{
    claim: string;
    docPath: string;
  } | null>(null);

  useEffect(() => {
    getJson<EntitiesResult>("/entities?limit=1")
      .then((result) => {
        const first = result.items[0];
        if (first && !submitted.entity) {
          setEntity(first.name);
          setSubmitted({ entity: first.name, depth: 1 });
        }
      })
      .catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!submitted.entity) return;
    setGraph(null);
    setError(null);
    const params = new URLSearchParams({
      entity: submitted.entity,
      depth: String(submitted.depth),
    });
    getApiResult<GraphResult>(`/graph?${params.toString()}`)
      .then((result) => {
        if (result.status === "found") {
          setGraph(result);
        } else if (result.status === "ambiguous") {
          setGraph(null);
          setError(
            new Error(
              `Ambiguous name — matches multiple types: ${result.entities
                .map((e) => e.type)
                .join(", ")}`,
            ),
          );
        } else {
          setGraph(null);
          setError(new Error("Entity not found"));
        }
      })
      .catch(setError);
  }, [submitted]);

  const load = (name: string, nextDepth = depth) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSelectedFact(null);
    setEntity(trimmed);
    setDepth(nextDepth);
    setSubmitted({ entity: trimmed, depth: nextDepth });
  };

  return (
    <div>
      <PageHeader
        title="Graph"
        subtitle="Entities and the facts that mention them. Click an entity node to re-center."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            load(entity, depth);
          }}
        >
          <input
            value={entity}
            onChange={(event) => setEntity(event.target.value)}
            placeholder="Entity name, e.g. Anirudh"
            className="w-64 rounded border border-neutral-300 px-3 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
          <select
            value={depth}
            onChange={(event) => load(entity, Number(event.target.value))}
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          >
            {DEPTHS.map((option) => (
              <option key={option.value} value={option.value}>
                depth {option.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded bg-neutral-900 px-4 py-1.5 text-sm text-white hover:bg-neutral-700"
          >
            Load
          </button>
        </form>
        {graph ? (
          <span className="text-xs text-neutral-500">
            {graph.nodes.filter((n) => n.kind === "entity").length} entities ·{" "}
            {graph.nodes.filter((n) => n.kind === "fact").length} facts ·{" "}
            {graph.edges.length} links
            {graph.truncated ? " · capped" : ""}
          </span>
        ) : null}
      </div>

      {error ? <ErrorMsg error={error} /> : null}
      {!graph && !error ? <Loading label="Loading graph" /> : null}

      {graph ? (
        <>
          <GraphCanvas
            graph={graph}
            onEntityClick={(name) => load(name, depth)}
            onFactClick={setSelectedFact}
          />
          {selectedFact ? (
            <div className="mt-3 rounded-lg border border-neutral-200 bg-white px-4 py-3">
              <Badge>fact</Badge>
              <p className="mt-1.5 text-sm text-neutral-800">
                {selectedFact.claim}
              </p>
              <p className="font-mono text-xs text-neutral-400">
                {selectedFact.docPath}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
