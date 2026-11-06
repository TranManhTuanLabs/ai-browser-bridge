import { Schema } from "effect";

// Which browser the bridge drives. bridge-profile launches a separate Chrome
// on the shared bridge profile; my-chrome / my-edge attach to the user's own
// running Chrome / Edge via its chrome://inspect or edge://inspect toggle.
export const BrowserChoiceSchema = Schema.Literal("bridge-profile", "my-chrome", "my-edge");
export type BrowserChoice = typeof BrowserChoiceSchema.Type;

const ChromeCacheEntrySchema = Schema.Struct({
  label: Schema.String,
  path: Schema.String,
  relativePath: Schema.String,
  exists: Schema.Boolean,
  bytes: Schema.Number,
  safeToPrune: Schema.Boolean,
});
export type ChromeCacheEntry = typeof ChromeCacheEntrySchema.Type;

const CacheInventorySchema = Schema.Struct({
  profileRoot: Schema.String,
  entries: Schema.Array(ChromeCacheEntrySchema),
  reclaimableBytes: Schema.Number,
});
export type CacheInventory = typeof CacheInventorySchema.Type;

const PruneCacheInputSchema = Schema.Struct({
  profileRoot: Schema.String,
  dryRun: Schema.optional(Schema.Boolean),
  confirm: Schema.optional(Schema.Boolean),
});
export type PruneCacheInput = typeof PruneCacheInputSchema.Type;

const PruneCacheResultSchema = Schema.Struct({
  profileRoot: Schema.String,
  dryRun: Schema.Boolean,
  deletedBytes: Schema.Number,
  entries: Schema.Array(ChromeCacheEntrySchema),
});
export type PruneCacheResult = typeof PruneCacheResultSchema.Type;

const BrowserStatusSchema = Schema.Struct({
  port: Schema.Number,
  debugPortListening: Schema.Boolean,
  chromeRunning: Schema.Boolean,
  userDataDir: Schema.NullOr(Schema.String),
  bridgeProfileRoot: Schema.String,
  canAttach: Schema.Boolean,
  browserChoice: BrowserChoiceSchema,
  browserLabel: Schema.String,
  inspectUrl: Schema.NullOr(Schema.String),
  // Own-browser attach asks the user to click Allow on every new connection;
  // a ready status still means one Allow click is ahead.
  allowRequired: Schema.Boolean,
  endpoint: Schema.NullOr(Schema.String),
  state: Schema.Literal(
    "ready",
    "chrome-not-running",
    "chrome-running-without-debug",
    "debug-port-unverified",
  ),
  message: Schema.String,
});
export type BrowserStatus = typeof BrowserStatusSchema.Type;
