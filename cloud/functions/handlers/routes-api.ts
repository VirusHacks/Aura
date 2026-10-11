import { lambdaHandler } from "../app/http";
import { routeRoutes } from "../app/routes";
import { contextFromEnv } from "./factory";

export const handler = lambdaHandler(routeRoutes, () => contextFromEnv());
