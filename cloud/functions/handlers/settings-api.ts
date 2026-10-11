import { lambdaHandler } from "../app/http";
import { settingsRoutes } from "../app/settings";
import { contextFromEnv } from "./factory";

export const handler = lambdaHandler(settingsRoutes, () => contextFromEnv());
