import type { paths } from "@sops/shared";
import createClient from "openapi-fetch";

export const API_BASE = "http://127.0.0.1:8787";

export const client = createClient<paths>({ baseUrl: API_BASE });

export const screenshotUrl = (id: string) => `${API_BASE}/api/screenshots/${id}`;

export const markdownExportUrl = (guideId: string) =>
  `${API_BASE}/api/guides/${guideId}/export/markdown`;
