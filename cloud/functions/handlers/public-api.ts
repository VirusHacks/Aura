import { lambdaHandler } from "../app/http";
import { publicRoutes } from "../app/public";
import { contextFromEnv } from "./factory";

export const handler = lambdaHandler(publicRoutes, () => contextFromEnv());
