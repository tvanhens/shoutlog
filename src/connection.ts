import axios, { Axios } from "axios";
import { aws4Interceptor } from "aws4-axios";
import { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";

export class ConnectionClient {
  private httpClient: Axios;

  constructor(public readonly url: string) {
    this.httpClient = axios.create({});

    this.httpClient.interceptors.request.use(
      aws4Interceptor({
        region: "us-east-1",
        service: "execute-api",
      })
    );
  }

  async sendMessage(message: string) {
    await this.httpClient.post(this.url, message);
  }

  static fromRequest(event: APIGatewayProxyWebsocketEventV2) {
    const baseUrl = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
    const url = `${baseUrl}/@connections/${event.requestContext.connectionId}`;
    return new ConnectionClient(url);
  }
}
