"use client";

import { useEffect, useRef, useState } from "react";
import type { Core, ElementDefinition } from "cytoscape";
import type { GraphResult } from "@/lib/api";

export type GraphData = Extract<GraphResult, { status: "found" }>;

const truncate = (text: string, max = 60) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export default function GraphCanvas({
  graph,
  onEntityClick,
  onFactClick,
}: {
  graph: GraphData;
  onEntityClick: (name: string) => void;
  onFactClick: (fact: { claim: string; docPath: string }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [ready, setReady] = useState(false);
  const onEntityClickRef = useRef(onEntityClick);
  const onFactClickRef = useRef(onFactClick);
  onEntityClickRef.current = onEntityClick;
  onFactClickRef.current = onFactClick;

  useEffect(() => {
    let cancelled = false;
    let cy: Core | null = null;
    setReady(false);

    (async () => {
      const cytoscape = (await import("cytoscape")).default;
      const container = containerRef.current;
      if (cancelled || !container || cyRef.current) return;

      const elements: ElementDefinition[] = graph.nodes.map((node) =>
        node.kind === "entity"
          ? {
              data: {
                id: node.id,
                label: node.name,
                kind: "entity",
                type: node.type,
                depth: node.depth,
                center: node.id === graph.center.id ? "true" : "false",
              },
            }
          : {
              data: {
                id: node.id,
                label: truncate(node.claim),
                kind: "fact",
                depth: node.depth,
                claim: node.claim,
                docPath: node.docPath,
              },
            },
      );
      for (const edge of graph.edges) {
        elements.push({
          data: {
            source: edge.source,
            target: edge.target,
            relation: edge.relation,
          },
        });
      }

      cy = cytoscape({
        container,
        elements,
        style: [
          {
            selector: "node[kind='entity']",
            style: {
              shape: "ellipse",
              width: 34,
              height: 34,
              "background-color": "#0284c7",
              label: "data(label)",
              color: "#0c4a6e",
              "font-size": 10,
              "text-valign": "bottom",
              "text-margin-y": 4,
            },
          },
          {
            selector: "node[center = 'true']",
            style: {
              "border-width": 3,
              "border-color": "#0f172a",
            },
          },
          {
            selector: "node[kind='fact']",
            style: {
              shape: "round-rectangle",
              width: "label",
              height: "label",
              "padding-left": "8px",
              "padding-right": "8px",
              "padding-top": "4px",
              "padding-bottom": "4px",
              "background-color": "#fafafa",
              "border-width": 1,
              "border-color": "#d4d4d4",
              label: "data(label)",
              color: "#525252",
              "font-size": 9,
              "text-valign": "center",
              "text-halign": "center",
            },
          },
          {
            selector: "edge",
            style: {
              width: 1.5,
              "line-color": "#cbd5e1",
              "curve-style": "bezier",
              "target-arrow-shape": "none",
              "arrow-scale": 0,
            },
          },
        ],
        layout: {
          name: "breadthfirst",
          roots: `[id = '${graph.center.id}']`,
          directed: false,
          padding: 24,
          spacingFactor: 1.3,
        } as cytoscape.LayoutOptions,
        wheelSensitivity: 0.2,
      });

      cy.on("tap", "node[kind='entity']", (event) => {
        const label = event.target.data("label");
        if (typeof label === "string") onEntityClickRef.current(label);
      });
      cy.on("tap", "node[kind='fact']", (event) => {
        onFactClickRef.current({
          claim: event.target.data("claim"),
          docPath: event.target.data("docPath"),
        });
      });

      cyRef.current = cy;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      if (cyRef.current === cy && cy) {
        cy.destroy();
        cyRef.current = null;
      }
    };
  }, [graph]);

  useEffect(() => {
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="h-[520px] overflow-hidden rounded-lg border border-neutral-200 bg-white"
      />
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-neutral-500">Rendering graph…</p>
        </div>
      ) : null}
    </div>
  );
}
