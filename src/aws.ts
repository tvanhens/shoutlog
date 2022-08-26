import { WebSocketApi } from "@aws-cdk/aws-apigatewayv2-alpha";
import {
  ASLGraph,
  ErrorCodes,
  isObjectLiteralExpr,
  isPropAssignExpr,
  SynthError,
} from "functionless";
import { makeIntegration } from "functionless/lib/integration";

export const InvokeApi = makeIntegration<
  "$AWS.API.Invoke",
  (input: {
    ApiEndpoint: string;
    Method: string;
    Stage: string;
    Path: string;
    AuthType: string;
    RequestBody: any;
  }) => Promise<any>
>({
  kind: "$AWS.API.Invoke",
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
        Resource: "arn:aws:states:::apigateway:invoke",
        Parameters: {
          ...output.value,
        },
        Next: ASLGraph.DeferNext,
      });
    });
  },
});

export const deploymentOnlyModule = true;
