/**
 * Types of the public (anonymous) online catalog API, from the generated OpenAPI schema.
 * Kept apart from the admin types: the public page must only ever depend on these.
 */
import type { components } from "./openapi";

type S = components["schemas"];

export type PublicStore = S["PublicStore"];
export type PublicBranch = S["PublicBranch"];
export type PublicCategory = S["PublicCategory"];
export type PublicProduct = S["PublicProduct"];
export type PublicProductDetail = S["PublicProductDetail"];
export type PublicVariant = S["PublicVariant"];
export type PublicProductPage = S["PublicProductPage"];
export type Availability = S["Availability"];
