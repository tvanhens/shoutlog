import { App, Stack } from "aws-cdk-lib";
import { ShoutLogTenantStack } from "./stack";

const app = new App();

new ShoutLogTenantStack(app, "ShoutLogTenantStack");
