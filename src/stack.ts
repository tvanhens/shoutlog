import { $AWS, ExpressStepFunction, Function, Table } from "functionless";
import { App, Stack, aws_apigateway, aws_dynamodb } from "aws-cdk-lib";
import { WebSocketApi, WebSocketStage } from "@aws-cdk/aws-apigatewayv2-alpha";
import { WebSocketLambdaIntegration } from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { StepFunctionsIntegration } from "aws-cdk-lib/aws-apigateway";
import { ConnectionClient } from "./connection";
import { BillingMode } from "aws-cdk-lib/aws-dynamodb";

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

    logResource.addMethod(
      "POST",
      StepFunctionsIntegration.startExecution(
        new ExpressStepFunction(
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
              sendToConnection({
                url: item.connectionUrl.S,
                message: event.body.message,
              });
              // Not working:
              // Resource handler returned message: "Invalid State Machine Definition: 'SCHEMA_VALIDATION_FAILED: The resource provided arn:aws:states:::aws-sdk:apigatewaymanagementapi:postToConnection is not recognized. The value is not a va
              // lid resource ARN, or the resource is not available in this region. at /States/1__$AWS.SDK.ApiGatewayManagementApi.postToConnection({ConnectionId: item.co/Resource' (Service: AWSStepFunctions; Status Code: 400; Error Code: Inv
              // alidDefinition; Request ID: 82f4c85c-9448-421c-bca4-a953d97413cf; Proxy: null)" (RequestToken: fef30460-838b-8321-a869-ebadee0ff2ab, HandlerErrorCode: InvalidRequest)
              // $AWS.SDK.ApiGatewayManagementApi.postToConnection(
              //   {
              //     ConnectionId: item.connectionId.S,
              //     Data: event.body.message,
              //   },
              //   {
              //     iam: {
              //       actions: ["execute-api:ManageConnections"],
              //       resources: ["*"],
              //     },
              //   }
              // );
            }
          }
        ).resource
      )
    );
  }
}
