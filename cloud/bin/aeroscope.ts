/**
 * AEROSCOPE CDK app. Synthesizes CloudFormation templates only; deployment
 * goes through AWS CLI change sets (scripts/deploy.sh) so every change is
 * reviewed before it is applied. No CDK bootstrap: assets go to the stage's
 * existing bucket via the CLI-credentials synthesizer.
 */
import { App, CliCredentialsStackSynthesizer, Tags } from "aws-cdk-lib";
import { AppStack } from "../lib/app-stack";
import { stageConfig } from "../lib/config";
import { DataStack } from "../lib/data-stack";

const app = new App();
const config = stageConfig(app);
const synthesizer = () =>
  new CliCredentialsStackSynthesizer({ fileAssetsBucketName: config.assetsBucket, bucketPrefix: `aeroscope-cdk/${config.stage}/` });
const env = { region: config.region };

const data = new DataStack(app, `Aeroscope-${config.stage}-Data`, {
  env,
  synthesizer: synthesizer(),
  description: "AEROSCOPE stateful resources: Cognito users and DynamoDB tables (retained).",
  config,
});
const appStack = new AppStack(app, `Aeroscope-${config.stage}-App`, {
  env,
  synthesizer: synthesizer(),
  description: "AEROSCOPE API, functions, events, real-time, routing and monitoring.",
  config,
  data,
});
appStack.addStackDependency(data);

Tags.of(app).add("Project", "AEROSCOPE");
Tags.of(app).add("Environment", config.stage);
Tags.of(app).add("ManagedBy", "AWS-CDK");

app.synth();
