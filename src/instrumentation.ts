export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-grpc");
    const { resourceFromAttributes } = await import("@opentelemetry/resources");

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        "service.name": "nb-s3-workspace",
      }),
      traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4317",
      }),
    });

    sdk.start();
  }
}
