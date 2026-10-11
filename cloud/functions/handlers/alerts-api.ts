import { lambdaHandler } from "../app/http";
import { alertRoutes } from "../app/alerts";
import { contextFromEnv } from "./factory";

export const handler = lambdaHandler(alertRoutes, () => contextFromEnv());
