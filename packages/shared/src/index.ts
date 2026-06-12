// Generated API types (source of truth: backend/app/schemas.py via OpenAPI).
export type { components, operations, paths } from "./api-types.gen";

/** Convenience aliases for the schemas the web app touches most. */
import type { components } from "./api-types.gen";
export type GuideOut = components["schemas"]["GuideOut"];
export type GuideSummary = components["schemas"]["GuideSummary"];
export type StepOut = components["schemas"]["StepOut"];
export type ClickPoint = components["schemas"]["ClickPoint"];
export type Annotation = components["schemas"]["Annotation"];
export type RedactionRect = components["schemas"]["RedactionRect"];
export type CropRect = components["schemas"]["CropRect"];
export type SettingsOut = components["schemas"]["SettingsOut"];
