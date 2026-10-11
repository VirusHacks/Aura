/**
 * App route integration points. The landing page links to the full-screen
 * simulation through this constant only, so moving the simulation means
 * changing one value.
 */
export const ROUTES = {
  home: "/",
  simulation: "/simulation",
} as const;
