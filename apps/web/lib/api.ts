export type DashboardStatus = {
  documents: { total: number; byScope: Record<string, number> };
  facts: { total: number; active: number; superseded: number };
  entities: { total: number; byType: Record<string, number> };
  proposals: { pending: number; approved: number; rejected: number };
};

export type DocumentListItem = {
  id: string;
  path: string;
  title: string | null;
  modality: string;
  scope: string;
  projectKey: string | null;
  activeFactCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ListDocumentsResult = {
  total: number;
  items: DocumentListItem[];
};

export type DocumentDetail = {
  id: string;
  path: string;
  title: string | null;
  content: string;
  modality: string;
  scope: string;
  projectKey: string | null;
  createdAt: string;
  updatedAt: string;
  chunks: {
    id: string;
    ordinal: number;
    headingPath: string[];
    startLine: number;
    endLine: number;
    content: string;
    facts: {
      id: string;
      claim: string;
      observedAt: string | null;
      createdAt: string;
    }[];
  }[];
};

export type EntitiesResult = {
  total: number;
  items: { id: string; name: string; type: string; factCount: number }[];
};

export type ProfileResult =
  | { status: "notFound" }
  | { status: "ambiguous"; entities: { id: string; name: string; type: string }[] }
  | {
      status: "found";
      entity: { id: string; name: string; type: string };
      facts: {
        factId: string;
        claim: string;
        docPath: string;
        startLine: number;
        endLine: number;
        headingPath: string[];
        scope: string;
        projectKey: string | null;
      }[];
    };

export type TimelineEvent =
  | {
      type: "document.created" | "document.updated";
      at: string;
      documentId: string;
      path: string;
      title: string | null;
      scope: string;
    }
  | {
      type: "fact.extracted";
      at: string;
      factId: string;
      claim: string;
      documentId: string;
      path: string;
      scope: string;
    };

export type TimelineResult = {
  events: TimelineEvent[];
};

export type GraphResult =
  | { status: "notFound" }
  | { status: "ambiguous"; entities: { id: string; name: string; type: string }[] }
  | {
      status: "found";
      center: { id: string; name: string; type: string };
      nodes: (
        | { kind: "entity"; id: string; name: string; type: string; depth: number }
        | { kind: "fact"; id: string; claim: string; docPath: string; depth: number }
      )[];
      edges: { source: string; target: string; relation: string }[];
      truncated: boolean;
    };

export class ApiError extends Error {
  status: number;
  body: unknown;

  private constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }

  static async from(response: Response): Promise<ApiError> {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch (err) {
      body = null;
    }
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `API request failed with status ${response.status}`;
    return new ApiError(response.status, body, message);
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`, { cache: "no-store" });
  if (!response.ok) throw await ApiError.from(response);
  return response.json() as Promise<T>;
}

export async function getApiResult<
  T extends { status: string },
>(path: string): Promise<T> {
  try {
    return await getJson<T>(path);
  } catch (err) {
    if (
      err instanceof ApiError &&
      err.body &&
      typeof err.body === "object" &&
      "status" in err.body
    ) {
      return err.body as T;
    }
    throw err;
  }
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
