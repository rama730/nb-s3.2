import { trace, context, SpanStatusCode } from "@opentelemetry/api";
import { logger } from "@/lib/logger";

const tracer = trace.getTracer("nb-application-tracer");

/**
 * Wraps a block of code with an OpenTelemetry span for deep observability.
 * Captures execution time, errors, and custom attributes.
 *
 * @param name The name of the operation being traced
 * @param attributes Custom attributes (e.g. userId, projectId)
 * @param fn The function to execute within the span
 */
export async function withTracing<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => Promise<T>
): Promise<T> {
    return tracer.startActiveSpan(name, async (span) => {
        try {
            span.setAttributes(attributes);
            
            // Execute the wrapped function
            const result = await fn();
            
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error: any) {
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error.message || "Unknown error",
            });
            span.recordException(error);
            
            logger.error(`telemetry.span_error:${name}`, {
                error: error.message,
                ...attributes
            });
            
            throw error;
        } finally {
            span.end();
        }
    });
}
