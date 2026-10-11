/**
 * Stateful resources: Cognito (users, app clients, watch-pairing triggers) and
 * the DynamoDB tables. Everything here is retained if the stack is deleted and
 * tables have deletion protection, so user data survives any redeploy.
 */
import { Duration, RemovalPolicy, Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";
import type { StageConfig } from "./config";
import { makeFunction } from "./function";

export interface DataStackProps extends StackProps {
  config: StageConfig;
}

export class DataStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly webClient: cognito.UserPoolClient;
  readonly iosClient: cognito.UserPoolClient;
  readonly watchClient: cognito.UserPoolClient;
  readonly trips: dynamodb.Table;
  readonly alerts: dynamodb.Table;
  readonly users: dynamodb.Table;
  readonly idempotency: dynamodb.Table;
  readonly pairing: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config } = props;
    const name = (s: string) => `aeroscope-${config.stage}-${s}`;
    const namespace = `AEROSCOPE/${config.stage}`;

    const table = (id: string, partitionKey: string, sortKey: string | null, pitr: boolean) =>
      new dynamodb.Table(this, id, {
        tableName: name(id.toLowerCase()),
        partitionKey: { name: partitionKey, type: dynamodb.AttributeType.STRING },
        ...(sortKey ? { sortKey: { name: sortKey, type: dynamodb.AttributeType.STRING } } : {}),
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        timeToLiveAttribute: "expiresAt",
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: pitr },
        deletionProtection: true,
        removalPolicy: RemovalPolicy.RETAIN,
      });

    // Canonical trip state + zone transitions (see functions/repo/dynamo.ts for item layouts).
    this.trips = table("Trips", "userId", "sk", true);
    this.alerts = table("Alerts", "userId", "sk", true);
    this.alerts.addGlobalSecondaryIndex({
      indexName: "byCreated",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.users = table("Users", "userId", "sk", true);
    this.idempotency = table("Idempotency", "id", null, false);
    this.pairing = table("Pairing", "id", null, false);

    // ---------------------------------------------------------------- Cognito
    const fn = (id: string, handler: string, description: string, environment: Record<string, string> = {}) =>
      makeFunction(this, id, {
        entry: "auth-challenge",
        handler,
        description,
        environment,
        memorySize: 256,
        timeout: Duration.seconds(5),
        logRetentionDays: config.logRetentionDays,
        namespace,
        serviceName: "aeroscope-auth",
      });
    const define = fn("DefineAuthChallenge", "defineAuthChallenge", "Watch pairing: CUSTOM_AUTH state machine");
    const create = fn("CreateAuthChallenge", "createAuthChallenge", "Watch pairing: issues the challenge");
    const verify = fn("VerifyAuthChallenge", "verifyAuthChallenge", "Watch pairing: checks and consumes the pairing", { PAIRING_TABLE: this.pairing.tableName });
    this.pairing.grantReadWriteData(verify);

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: name("users"),
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: { minLength: 10, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lambdaTriggers: { defineAuthChallenge: define, createAuthChallenge: create, verifyAuthChallengeResponse: verify },
    });

    const client = (id: string, flows: cognito.AuthFlow, refreshDays: number) =>
      this.userPool.addClient(id, {
        userPoolClientName: name(id.toLowerCase()),
        generateSecret: false,
        authFlows: flows,
        preventUserExistenceErrors: true,
        enableTokenRevocation: true,
        accessTokenValidity: Duration.minutes(60),
        idTokenValidity: Duration.minutes(60),
        refreshTokenValidity: Duration.days(refreshDays),
      });
    // Dashboard and iPhone: email + password (USER_PASSWORD_AUTH over TLS, or SRP).
    this.webClient = client("Web", { userPassword: true, userSrp: true }, 30);
    this.iosClient = client("Ios", { userPassword: true, userSrp: true }, 30);
    // Watch: only the pairing custom challenge; its refresh token lives a week.
    this.watchClient = client("Watch", { custom: true }, 7);

    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "WebClientId", { value: this.webClient.userPoolClientId });
    new CfnOutput(this, "IosClientId", { value: this.iosClient.userPoolClientId });
    new CfnOutput(this, "WatchClientId", { value: this.watchClient.userPoolClientId });
  }
}
