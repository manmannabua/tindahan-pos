// Real IndexedDB semantics in jsdom, so Dexie code can be tested without a browser.
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
