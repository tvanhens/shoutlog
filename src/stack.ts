import { $AWS, ExpressStepFunction, Function, Table } from "functionless";
import { App, Stack, aws_apigateway, aws_dynamodb } from "aws-cdk-lib";
import { WebSocketApi, WebSocketStage } from "@aws-cdk/aws-apigatewayv2-alpha";
import { WebSocketLambdaIntegration } from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { StepFunctionsIntegration } from "aws-cdk-lib/aws-apigateway";
import { ConnectionClient } from "./connection";
import { BillingMode } from "aws-cdk-lib/aws-dynamodb";
import { InvokeApi } from "./aws";

interface Connection {
  pk: "connection";
  sk: string;
  version: "1";
  type: "connection";
  connectionId: string;
  connectionUrl: string;
}

export class ShoutLogTenantStack extends Stack {
  constructor(scope: App, id: string) {
    super(scope, id);

    const table = new Table<Connection, "pk", "sk">(this, "Data", {
      partitionKey: {
        name: "pk",
        type: aws_dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "sk",
        type: aws_dynamodb.AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    const sendToConnection = new Function(
      this,
      "SendToConnection",
      async (event: { url: string; message: any }) => {
        console.log(event);
        const client = new ConnectionClient(event.url);
        await client.sendMessage(event.message);
      }
    );

    const socketApi = new WebSocketApi(this, "WebSocketApi", {
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          "OnConnect",
          new Function(
            this,
            "OnConnectHandler",
            async (event: APIGatewayProxyWebsocketEventV2) => {
              const client = ConnectionClient.fromRequest(event);
              const url = client.url;
              const id = event.requestContext.connectionId;
              await $AWS.DynamoDB.PutItem({
                Table: table,
                Item: {
                  pk: { S: "connection" },
                  sk: { S: id },
                  type: { S: "connection" },
                  version: { S: "1" },
                  connectionId: { S: id },
                  connectionUrl: { S: url },
                },
              });
              return {
                statusCode: 200,
              };
            }
          ).resource
        ),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          "OnDisconnect",
          new Function(
            this,
            "OnDisconnectHandler",
            async (event: APIGatewayProxyWebsocketEventV2) => {
              await $AWS.DynamoDB.DeleteItem({
                Table: table,
                Key: {
                  pk: { S: "connection" },
                  sk: { S: event.requestContext.connectionId },
                },
              });
              return {
                statusCode: 200,
              };
            }
          ).resource
        ),
      },
    });

    socketApi.grantManageConnections(sendToConnection.resource);

    new WebSocketStage(this, "WebSocketApiStage", {
      stageName: "prod",
      webSocketApi: socketApi,
      autoDeploy: true,
    });

    const api = new aws_apigateway.RestApi(this, "Api");

    const logResource = api.root.addResource("log");

    const handlePostLog = new ExpressStepFunction(
      this,
      "HandlePostLog",
      async (event: { body: { message: string } }) => {
        const connections = await $AWS.DynamoDB.Query({
          Table: table,
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeNames: {
            "#pk": "pk",
          },
          ExpressionAttributeValues: {
            ":pk": { S: "connection" },
          },
        });

        if (connections.Items == null) {
          return;
        }

        for (const item of connections.Items) {
          await InvokeApi({
            ApiEndpoint: `${socketApi.apiId}.execute-api.us-east-1.amazonaws.com`,
            Stage: "prod",
            AuthType: "IAM_ROLE",
            Method: "POST",
            Path: `@connections/${item.connectionId.S}`,
            RequestBody: event.body.message,
          });
        }
      }
    );

    socketApi.grantManageConnections(handlePostLog.resource);

    logResource.addMethod(
      "POST",
      StepFunctionsIntegration.startExecution(handlePostLog.resource)
    );
  }
}
