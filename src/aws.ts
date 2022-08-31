import {
  ASLGraph,
  ErrorCodes,
  isObjectLiteralExpr,
  SynthError,
} from "functionless";
import { makeIntegration } from "functionless/lib/integration";

export const Task = makeIntegration<
  "$AWS.Sfn.Task",
  (input: {
    Resource: string;
    Parameters: Record<string, unknown>;
  }) => Promise<any>
>({
  kind: "$AWS.Sfn.Task",
  asl(call, context) {
    const input = call.args[0].expr.as(isObjectLiteralExpr);
    if (!input) throw new Error("Invalid input");

    return context.evalExpr(input, (output) => {
      if (
        !ASLGraph.isLiteralValue(output) ||
        typeof output.value !== "object" ||
        !output.value
      ) {
        throw new SynthError(ErrorCodes.Unexpected_Error, "Unexpected Error");
      }

      return context.stateWithHeapOutput({
        Type: "Task",
        Next: ASLGraph.DeferNext,
        ...(output.value as any),
      });
    });
  },
});

// Usage:

Task({
  Resource: "arn:aws:states:::apigateway:invoke",
  Parameters: {
    ApiEndpoint: "example.execute-api.us-east-1.amazonaws.com",
    Method: "GET",
    Headers: {
      key: ["value1", "value2"],
    },
    Stage: "prod",
    Path: "bills",
    QueryParameters: {
      billId: ["123456"],
    },
    RequestBody: {},
    AuthType: "NO_AUTH",
  },
});

export const deploymentOnlyModule = true;
