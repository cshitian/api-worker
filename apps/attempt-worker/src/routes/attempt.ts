import { Hono } from "hono";
import type { AppEnv } from "../env";

const ATTEMPT_RESPONSE_PATH_HEADER = "x-ha-attempt-response-path";
const ATTEMPT_LATENCY_HEADER = "x-ha-attempt-latency-ms";
const ATTEMPT_UPSTREAM_REQUEST_ID_HEADER = "x-ha-attempt-upstream-request-id";
const ATTEMPT_ERROR_CODE_HEADER = "x-ha-attempt-error-code";

type AttemptRequest = {
	method: string;
	target: string;
	fallbackTarget?: string | null;
	headers?: Array<[string, string]>;
	bodyText?: string | null;
	timeoutMs?: number;
	responsePath?: string | null;
	fallbackPath?: string | null;
};

const attempt = new Hono<AppEnv>();

function normalizeRequestId(headers: Headers): string | null {
	const candidates = [
		"x-request-id",
		"request-id",
		"x-correlation-id",
		"cf-ray",
		"openai-request-id",
	];
	for (const key of candidates) {
		const value = headers.get(key);
		if (value && value.trim()) {
			return value.trim();
		}
	}
	return null;
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	if (timeoutMs <= 0) {
		return fetch(url, init);
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, {
			...init,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
}

attempt.post("/", async (c) => {
	const start = Date.now();
	const body = await c.req.json<AttemptRequest>().catch(() => null);
	if (!body?.target || !body?.method) {
		return c.json({ error: "invalid_attempt_payload" }, 400);
	}
	const timeoutMs = Math.max(0, Math.floor(Number(body.timeoutMs ?? 0)));
	const headers = new Headers();
	for (const [key, value] of body.headers ?? []) {
		headers.set(key, value);
	}
	headers.delete("host");
	headers.delete("content-length");

	const requestInit: RequestInit = {
		method: body.method,
		headers,
		body: body.bodyText ?? undefined,
	};
	let responsePath = body.responsePath?.trim() || body.target;
	try {
		let response = await fetchWithTimeout(body.target, requestInit, timeoutMs);
		if (
			(response.status === 400 || response.status === 404) &&
			body.fallbackTarget
		) {
			response = await fetchWithTimeout(body.fallbackTarget, requestInit, timeoutMs);
			responsePath = body.fallbackPath?.trim() || body.fallbackTarget;
		}
		const outHeaders = new Headers(response.headers);
		outHeaders.set(ATTEMPT_RESPONSE_PATH_HEADER, responsePath);
		outHeaders.set(ATTEMPT_LATENCY_HEADER, String(Date.now() - start));
		const upstreamRequestId = normalizeRequestId(response.headers);
		if (upstreamRequestId) {
			outHeaders.set(ATTEMPT_UPSTREAM_REQUEST_ID_HEADER, upstreamRequestId);
		}
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: outHeaders,
		});
	} catch (error) {
		const isTimeout =
			error instanceof Error &&
			(error.name === "AbortError" || error.message.includes("upstream_timeout"));
		const errorCode = isTimeout
			? "proxy_upstream_timeout"
			: "proxy_upstream_fetch_exception";
		const outHeaders = new Headers({
			"content-type": "application/json",
		});
		outHeaders.set(ATTEMPT_RESPONSE_PATH_HEADER, responsePath);
		outHeaders.set(ATTEMPT_LATENCY_HEADER, String(Date.now() - start));
		outHeaders.set(ATTEMPT_ERROR_CODE_HEADER, errorCode);
		return new Response(
			JSON.stringify({
				error: {
					code: errorCode,
					message:
						error instanceof Error && error.message
							? error.message
							: errorCode,
				},
			}),
			{
				status: 599,
				headers: outHeaders,
			},
		);
	}
});

export default attempt;

