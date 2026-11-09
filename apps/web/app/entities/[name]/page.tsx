"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { getApiResult, type ProfileResult } from "@/lib/api";
import { Badge, Empty, ErrorMsg, Loading, PageHeader } from "@/components/ui";

export default function EntityProfilePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setProfile(null);
    setError(null);
    getApiResult<ProfileResult>(`/entity-profile?name=${encodeURIComponent(decodedName)}`)
      .then(setProfile)
      .catch(setError);
  }, [decodedName]);

  if (error) return <ErrorMsg error={error} />;
  if (!profile) return <Loading />;
  if (profile.status === "notFound") {
    return (
      <div>
        <PageHeader title={decodedName} />
        <Empty label="No entity with this name in the knowledge base." />
      </div>
    );
  }
  if (profile.status === "ambiguous") {
    return (
      <div>
        <PageHeader
          title={decodedName}
          subtitle="Name is ambiguous — multiple entity types carry it. Pick one:"
        />
        <ul className="flex max-w-md flex-col gap-2">
          {profile.entities.map((entity) => (
            <li key={entity.id} className="rounded border border-neutral-200 bg-white p-4">
              <Badge tone="amber">{entity.type}</Badge>
              <p className="mt-2 text-sm text-neutral-700">{entity.name}</p>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const foundProfile = profile as Extract<ProfileResult, { status: "found" }>;
  const groups = new Map<string, typeof foundProfile.facts>();
  for (const fact of foundProfile.facts) {
    (groups.get(fact.docPath) ?? groups.set(fact.docPath, []).get(fact.docPath)!).push(
      fact,
    );
  }

  return (
    <div>
      <PageHeader
        title={foundProfile.entity.name}
        subtitle={`${foundProfile.facts.length} facts, grouped by source note`}
        actions={
          <Link
            href="/entities"
            className="text-sm text-neutral-600 hover:text-neutral-900"
          >
            ← Back to entities
          </Link>
        }
      />
      <Badge tone="blue">{foundProfile.entity.type}</Badge>

      <div className="mt-4 flex flex-col gap-5">
        {[...groups.entries()].map(([docPath, facts]) => (
          <div
            key={docPath}
            className="rounded-lg border border-neutral-200 bg-white p-4"
          >
            <p className="font-mono text-xs text-neutral-400">{docPath}</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {facts.map((fact) => (
                <li key={fact.factId} className="text-sm text-neutral-700">
                  {fact.claim}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {foundProfile.facts.length === 0 ? (
          <Empty label="This entity has no active facts." />
        ) : null}
      </div>
    </div>
  );
}
