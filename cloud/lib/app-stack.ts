/**
 * Stateless application resources: Lambda functions, the HTTP API (Cognito JWT
 * authorizer), the EventBridge bus and rules (with dead-letter queues), the
 * AppSync Events real-time API, Amazon Location permissions, and CloudWatch
 * dashboards and alarms. Safe to redeploy at any time; data lives in DataStack.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import { AccessLogFormat } from "aws-cdk-lib/aws-apigateway";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import type { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import { DOMAIN_EVENTS } from "../../types/api";
import type { StageConfig } from "./config";
import type { DataStack } from "./data-stack";
import { CLOUD_ROOT, makeFunction } from "./function";

export interface AppStackProps extends StackProps {
  config: StageConfig;
  data: DataStack;
}

type Method = "GET" | "POST" | "PUT";

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { config, data } = props;
    const name = (s: string) => `aeroscope-${config.stage}-${s}`;
    const namespace = `AEROSCOPE/${config.stage}`;
    const origins = [config.webUrl, ...config.devOrigins];

    // Existing /infra tables (read only).
    const zones = config.zonesTableName ? dynamodb.Table.fromTableName(this, "ZoneBaselines", config.zonesTableName) : null;
    const scenarios = config.scenariosTableName ? dynamodb.Table.fromTableName(this, "ScenarioSnapshots", config.scenariosTableName) : null;

    // ---------------------------------------------------------------- Events
    const bus = new events.EventBus(this, "Bus", { eventBusName: name("bus") });

    // ---------------------------------------------------------------- Real-time (AppSync Events)
    const realtime = new appsync.EventApi(this, "Realtime", {
      apiName: name("realtime"),
      authorizationConfig: {
        authProviders: [
          { authorizationType: appsync.AppSyncAuthorizationType.IAM },
          { authorizationType: appsync.AppSyncAuthorizationType.USER_POOL, cognitoConfig: { userPool: data.userPool } },
        ],
        connectionAuthModeTypes: [appsync.AppSyncAuthorizationType.USER_POOL, appsync.AppSyncAuthorizationType.IAM],
        defaultPublishAuthModeTypes: [appsync.AppSyncAuthorizationType.IAM],
        defaultSubscribeAuthModeTypes: [appsync.AppSyncAuthorizationType.USER_POOL],
      },
      logConfig: { fieldLogLevel: appsync.AppSyncFieldLogLevel.ERROR, retention: logs.RetentionDays.TWO_WEEKS },
    });
    realtime.addChannelNamespace("UserChannels", {
      channelNamespaceName: "aeroscope",
      code: appsync.Code.fromInline(fs.readFileSync(path.join(CLOUD_ROOT, "appsync", "user-channel.js"), "utf8")),
      authorizationConfig: {
        publishAuthModeTypes: [appsync.AppSyncAuthorizationType.IAM],
        subscribeAuthModeTypes: [appsync.AppSyncAuthorizationType.USER_POOL],
      },
    });

    // ---------------------------------------------------------------- Functions
    const common: Record<string, string> = {
      STAGE: config.stage,
      APP_VERSION: "1.0.0",
      ROUTING_PROVIDER: config.routing,
      BASELINE_PROVENANCE: config.baselineProvenance,
      LOCATION_RETENTION_DAYS: String(config.locationRetentionDays),
      ALERT_RETENTION_DAYS: "30",
      COGNITO_USER_POOL_ID: data.userPool.userPoolId,
      COGNITO_WEB_CLIENT_ID: data.webClient.userPoolClientId,
      COGNITO_IOS_CLIENT_ID: data.iosClient.userPoolClientId,
      COGNITO_WATCH_CLIENT_ID: data.watchClient.userPoolClientId,
      APPSYNC_HTTP_DOMAIN: realtime.httpDns,
      APPSYNC_REALTIME_DOMAIN: realtime.realtimeDns,
      APPSYNC_NAMESPACE: "aeroscope",
      APNS_PLATFORM_ARN_SANDBOX: config.apnsPlatformArnSandbox,
      APNS_PLATFORM_ARN_PRODUCTION: config.apnsPlatformArnProduction,
      WEB_URL: config.webUrl,
      ZONES_TABLE: config.zonesTableName,
      SCENARIOS_TABLE: config.scenariosTableName,
    };
    const fn = (id: string, entry: string, description: string, env: Record<string, string>, memorySize = 512) =>
      makeFunction(this, id, {
        entry,
        description,
        environment: { ...common, ...env },
        memorySize,
        logRetentionDays: config.logRetentionDays,
        namespace,
        serviceName: `aeroscope-${entry}`,
      });
    const readCity = (f: NodejsFunction) => {
      zones?.grantReadData(f);
      scenarios?.grantReadData(f);
    };
    const locationRoutes = new iam.PolicyStatement({
      actions: ["geo-routes:CalculateRoutes"],
      resources: [`arn:${this.partition}:geo-routes:${this.region}::provider/default`],
    });

    const publicFn = fn("PublicApi", "public-api", "Public air-quality reads, client config, watch pairing start", {
      PAIRING_TABLE: data.pairing.tableName,
    });
    readCity(publicFn);
    data.pairing.grantReadWriteData(publicFn);

    const tripsFn = fn("TripsApi", "trips-api", "Trips: lifecycle, positions, alert evaluation, route selection", {
      TRIPS_TABLE: data.trips.tableName,
      ALERTS_TABLE: data.alerts.tableName,
      USERS_TABLE: data.users.tableName,
      IDEMPOTENCY_TABLE: data.idempotency.tableName,
      EVENT_BUS_NAME: bus.eventBusName,
    });
    readCity(tripsFn);
    data.trips.grantReadWriteData(tripsFn);
    data.alerts.grantReadWriteData(tripsFn);
    data.users.grantReadData(tripsFn);
    data.idempotency.grantReadWriteData(tripsFn);
    bus.grantPutEventsTo(tripsFn);

    const alertsFn = fn("AlertsApi", "alerts-api", "Alerts: history, actions, dry-run evaluation", {
      ALERTS_TABLE: data.alerts.tableName,
      TRIPS_TABLE: data.trips.tableName,
      USERS_TABLE: data.users.tableName,
      IDEMPOTENCY_TABLE: data.idempotency.tableName,
      EVENT_BUS_NAME: bus.eventBusName,
    });
    readCity(alertsFn);
    data.alerts.grantReadWriteData(alertsFn);
    data.trips.grantReadData(alertsFn);
    data.users.grantReadWriteData(alertsFn); // preferences + route rate-limit counters
    data.idempotency.grantReadWriteData(alertsFn);
    bus.grantPutEventsTo(alertsFn);

    const routesFn = fn("RoutesApi", "routes-api", "Route alternatives with AQI scoring", {
      TRIPS_TABLE: data.trips.tableName,
      USERS_TABLE: data.users.tableName,
      EVENT_BUS_NAME: bus.eventBusName,
    });
    readCity(routesFn);
    data.trips.grantReadData(routesFn);
    data.users.grantReadWriteData(routesFn); // preferences + rate-limit counters
    bus.grantPutEventsTo(routesFn);

    if (config.routing === "amazon-location") {
      alertsFn.addToRolePolicy(locationRoutes);
      routesFn.addToRolePolicy(locationRoutes);
    }

    const settingsFn = fn("SettingsApi", "settings-api", "Preferences, push devices, watch pairing approval", {
      USERS_TABLE: data.users.tableName,
      PAIRING_TABLE: data.pairing.tableName,
      IDEMPOTENCY_TABLE: data.idempotency.tableName,
    }, 256);
    data.users.grantReadWriteData(settingsFn);
    data.pairing.grantReadWriteData(settingsFn);
    data.idempotency.grantReadWriteData(settingsFn);

    const notifierFn = fn("Notifier", "notifier", "AlertCreated → APNs via SNS (idempotent per alert/device)", {
      USERS_TABLE: data.users.tableName,
      ALERTS_TABLE: data.alerts.tableName,
    }, 256);
    data.users.grantReadWriteData(notifierFn);
    data.alerts.grantReadWriteData(notifierFn);

    const platformApps = [config.apnsPlatformArnSandbox, config.apnsPlatformArnProduction].filter(Boolean);
    if (platformApps.length) {
      settingsFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["sns:CreatePlatformEndpoint"], resources: platformApps }));
      const endpoints = platformApps.map((arn) => arn.replace(":app/", ":endpoint/") + "/*");
      settingsFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["sns:SetEndpointAttributes", "sns:GetEndpointAttributes"], resources: endpoints }));
      notifierFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["sns:Publish"], resources: endpoints }));
    }

    const realtimeFn = fn("RealtimePublisher", "realtime-publisher", "Domain events → AppSync Events user channels", {}, 256);
    realtime.grantPublish(realtimeFn);

    // ---------------------------------------------------------------- Event routing
    const dlq = (id: string) =>
      new sqs.Queue(this, id, { queueName: name(id.toLowerCase()), retentionPeriod: Duration.days(14), encryption: sqs.QueueEncryption.SQS_MANAGED, enforceSSL: true });
    const realtimeDlq = dlq("RealtimeDlq");
    const notifierDlq = dlq("NotifierDlq");
    const source = ["aeroscope.api"];

    // Every domain event is mirrored to the owner's real-time channel.
    const realtimeRule = new events.Rule(this, "ToRealtime", {
      eventBus: bus,
      ruleName: name("to-realtime"),
      eventPattern: { source, detailType: Object.values(DOMAIN_EVENTS) },
      targets: [new targets.LambdaFunction(realtimeFn, { retryAttempts: 4, maxEventAge: Duration.minutes(5), deadLetterQueue: realtimeDlq })],
    });
    // New alerts go to the notifier. The notifier emits nothing, so rules cannot loop.
    const alertRule = new events.Rule(this, "AlertToNotifier", {
      eventBus: bus,
      ruleName: name("alert-to-notifier"),
      eventPattern: { source, detailType: [DOMAIN_EVENTS.AlertCreated] },
      targets: [new targets.LambdaFunction(notifierFn, { retryAttempts: 2, maxEventAge: Duration.hours(1), deadLetterQueue: notifierDlq })],
    });

    // ---------------------------------------------------------------- HTTP API
    const accessLogs = new logs.LogGroup(this, "ApiAccessLogs", { retention: logs.RetentionDays.TWO_WEEKS });
    const api = new apigw.HttpApi(this, "Api", {
      apiName: name("api"),
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: origins,
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.PUT, apigw.CorsHttpMethod.OPTIONS],
        allowHeaders: ["authorization", "content-type", "idempotency-key", "x-correlation-id", "x-aeroscope-client", "x-pairing-secret"],
        exposeHeaders: ["x-correlation-id"],
        maxAge: Duration.hours(1),
      },
    });
    const stage = new apigw.HttpStage(this, "DefaultStage", {
      httpApi: api,
      stageName: "$default",
      autoDeploy: true,
      throttle: { rateLimit: 25, burstLimit: 50 },
      detailedMetricsEnabled: true,
      accessLogSettings: {
        destination: new apigw.LogGroupLogDestination(accessLogs),
        format: AccessLogFormat.custom(
          JSON.stringify({
            requestId: "$context.requestId",
            routeKey: "$context.routeKey",
            status: "$context.status",
            latencyMs: "$context.responseLatency",
            integrationError: "$context.integrationErrorMessage",
            authorizerError: "$context.authorizer.error",
          }),
        ),
      },
    });
    // Unauthenticated pairing creation gets its own tighter limit.
    (stage.node.defaultChild as apigw.CfnStage).addPropertyOverride("RouteSettings", {
      "POST /v1/pairing": { ThrottlingRateLimit: 1, ThrottlingBurstLimit: 5 },
      "GET /v1/pairing/{pairingId}": { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 },
    });

    const jwt = new HttpJwtAuthorizer("Cognito", `https://cognito-idp.${this.region}.amazonaws.com/${data.userPool.userPoolId}`, {
      authorizerName: "cognito",
      jwtAudience: [data.webClient.userPoolClientId, data.iosClient.userPoolClientId, data.watchClient.userPoolClientId],
    });
    const route = (method: Method, p: string, target: NodejsFunction, authenticated: boolean) =>
      api.addRoutes({
        path: p,
        methods: [apigw.HttpMethod[method]],
        integration: new HttpLambdaIntegration(`${target.node.id}${method}${p.replace(/[^A-Za-z]/g, "")}`, target),
        ...(authenticated ? { authorizer: jwt } : {}),
      });

    for (const p of ["/v1/health", "/v1/client-config", "/v1/city", "/v1/air-quality/zones", "/v1/air-quality/zones/{zoneId}", "/v1/air-quality/current", "/v1/scenario", "/v1/pairing/{pairingId}"]) {
      route("GET", p, publicFn, false);
    }
    route("POST", "/v1/pairing", publicFn, false);
    route("POST", "/v1/trips", tripsFn, true);
    route("GET", "/v1/trips/active", tripsFn, true);
    route("GET", "/v1/trips/{tripId}", tripsFn, true);
    route("POST", "/v1/trips/{tripId}/events", tripsFn, true);
    route("POST", "/v1/trips/{tripId}/route", tripsFn, true);
    route("GET", "/v1/alerts", alertsFn, true);
    route("POST", "/v1/alerts/evaluate", alertsFn, true);
    route("POST", "/v1/alerts/{alertId}/actions", alertsFn, true);
    route("POST", "/v1/routes/compare", routesFn, true);
    route("GET", "/v1/preferences", settingsFn, true);
    route("PUT", "/v1/preferences", settingsFn, true);
    route("PUT", "/v1/devices/{deviceId}", settingsFn, true);
    route("POST", "/v1/pairing/claim", settingsFn, true);

    // ---------------------------------------------------------------- Observability
    const alarmTopic = new sns.Topic(this, "Alarms", { topicName: name("alarms"), enforceSSL: true });
    if (config.alarmEmail) alarmTopic.addSubscription(new subs.EmailSubscription(config.alarmEmail));
    const alarm = (id: string, metric: cloudwatch.IMetric, threshold: number, description: string) => {
      const a = new cloudwatch.Alarm(this, id, {
        alarmName: name(id),
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      a.addAlarmAction(new cwActions.SnsAction(alarmTopic));
      return a;
    };
    const fiveMin = Duration.minutes(5);
    const apiMetric = (metricName: string, statistic = "Sum") =>
      new cloudwatch.Metric({ namespace: "AWS/ApiGateway", metricName, dimensionsMap: { ApiId: api.apiId, Stage: "$default" }, statistic, period: fiveMin });
    const custom = (metricName: string, service: string, dims: Record<string, string> = {}) =>
      new cloudwatch.Metric({ namespace, metricName, dimensionsMap: { Service: service, ...dims }, statistic: "Sum", period: fiveMin });
    const apiFns = [publicFn, tripsFn, alertsFn, routesFn, settingsFn];
    const allFns = [...apiFns, notifierFn, realtimeFn];

    alarm("Api5xx", apiMetric("5xx"), 5, "HTTP API returned 5xx responses");
    for (const f of allFns) alarm(`${f.node.id}Errors`, f.metricErrors({ period: fiveMin }), 1, `${f.node.id} Lambda errors`);
    alarm("RealtimeDlqMessages", realtimeDlq.metricApproximateNumberOfMessagesVisible({ period: fiveMin }), 1, "Real-time events failed after retries");
    alarm("NotifierDlqMessages", notifierDlq.metricApproximateNumberOfMessagesVisible({ period: fiveMin }), 1, "Alert notifications failed after retries");
    alarm("PushFailures", custom("PushFailures", "aeroscope-notifier"), 5, "APNs deliveries through SNS are failing");
    alarm("RealtimeRuleFailures", new cloudwatch.Metric({ namespace: "AWS/Events", metricName: "FailedInvocations", dimensionsMap: { EventBusName: bus.eventBusName, RuleName: realtimeRule.ruleName }, statistic: "Sum", period: fiveMin }), 1, "EventBridge could not invoke the real-time publisher");
    alarm("AlertRuleFailures", new cloudwatch.Metric({ namespace: "AWS/Events", metricName: "FailedInvocations", dimensionsMap: { EventBusName: bus.eventBusName, RuleName: alertRule.ruleName }, statistic: "Sum", period: fiveMin }), 1, "EventBridge could not invoke the notifier");

    const dashboard = new cloudwatch.Dashboard(this, "Dashboard", { dashboardName: name("operations"), defaultInterval: Duration.hours(3) });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({ title: "API requests / errors", left: [apiMetric("Count"), apiMetric("4xx"), apiMetric("5xx")], width: 12 }),
      new cloudwatch.GraphWidget({ title: "API latency (p90, ms)", left: [apiMetric("Latency", "p90")], width: 12 }),
      new cloudwatch.GraphWidget({ title: "Lambda errors", left: allFns.map((f) => f.metricErrors({ period: fiveMin, label: f.node.id })), width: 12 }),
      new cloudwatch.GraphWidget({ title: "Lambda duration (p90, ms)", left: allFns.map((f) => f.metricDuration({ period: fiveMin, statistic: "p90", label: f.node.id })), width: 12 }),
      new cloudwatch.GraphWidget({
        title: "Alerts: evaluated / raised / de-duplicated",
        left: [custom("AlertEvaluations", "aeroscope-trips-api", { Source: "dashboard" }), custom("AlertEvaluations", "aeroscope-trips-api", { Source: "device" })],
        right: [custom("AlertsDeduplicated", "aeroscope-trips-api")],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "Notifications",
        left: [custom("PushAttempts", "aeroscope-notifier", { Platform: "watchOS" }), custom("PushesSent", "aeroscope-notifier", { Platform: "watchOS" }), custom("PushSkipped", "aeroscope-notifier")],
        right: [custom("PushFailures", "aeroscope-notifier", { Platform: "watchOS", Reason: "Error" })],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "Routing (Amazon Location / demo)",
        left: [custom("RouteRequests", "aeroscope-routes-api", { Provider: "amazon-location" }), custom("RouteRequests", "aeroscope-alerts-api", { Provider: "amazon-location" })],
        right: [custom("RouteFailures", "aeroscope-routes-api", { Provider: "amazon-location" }), custom("RouteRateLimited", "aeroscope-routes-api")],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "Real-time & event delivery",
        left: [custom("RealtimePublished", "aeroscope-realtime-publisher", { Type: "trip.location.updated" }), custom("RealtimePublished", "aeroscope-realtime-publisher", { Type: "alert.created" })],
        right: [realtimeDlq.metricApproximateNumberOfMessagesVisible({ label: "real-time DLQ" }), notifierDlq.metricApproximateNumberOfMessagesVisible({ label: "notifier DLQ" })],
        width: 12,
      }),
      new cloudwatch.LogQueryWidget({
        title: "Trace one request (replace the correlation id)",
        logGroupNames: apiFns.map((f) => f.logGroup.logGroupName),
        queryLines: ["fields @timestamp, service, level, message, route, status", "filter correlationId = 'PASTE-CORRELATION-ID'", "sort @timestamp asc", "limit 100"],
        width: 24,
      }),
    );

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "RealtimeHttpDomain", { value: realtime.httpDns });
    new CfnOutput(this, "RealtimeDomain", { value: realtime.realtimeDns });
    new CfnOutput(this, "EventBusName", { value: bus.eventBusName });
    new CfnOutput(this, "DashboardName", { value: dashboard.dashboardName });
    new CfnOutput(this, "AlarmTopicArn", { value: alarmTopic.topicArn });
  }
}
