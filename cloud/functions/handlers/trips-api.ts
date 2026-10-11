import { lambdaHandler } from "../app/http";
import { tripRoutes } from "../app/trips";
import { contextFromEnv } from "./factory";

export const handler = lambdaHandler(tripRoutes, () => contextFromEnv());
